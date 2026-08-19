import { createAudio, type AudioPlayer, type RawAudioConfig } from './audio';
import { createPlayer, type Player, type RawVideoConfig } from './player';
import { read, store } from './storage';
import type { Person, RoomState, RoomTokens, ServerMessage, StreamState } from './types';

/**
 * A conexão com a sala, fora do React.
 *
 * O estado da sala muda a cada `state` do servidor, e a grade é reconstruída
 * junto. Guardar isso em `useState` transformaria cada mensagem numa cascata de
 * re-render pela árvore inteira — o risco que specs/11 registra para esta fase.
 * Aqui o estado vive num objeto simples, os componentes assinam o que
 * interessa, e o React só é avisado quando algo que ele desenha mudou.
 *
 * O mesmo objeto vai segurar os decodificadores na fase 3: os canvas precisam
 * sobreviver a remontagem de componente (RN-AST-17), e já nascem fora daqui.
 */

export interface RoomSnapshot {
  /** null antes da primeira mensagem `state`. */
  room: RoomState | null;
  participants: Person[];
  streams: StreamState[];
  /** Slots que esta pessoa pediu para assistir. Assistir é opt-in (RN-AST-2). */
  watching: number[];
  /** Slots que já desenharam um quadro — até lá o tile diz "Conectando…". */
  drawing: number[];
  /** Slots cujo áudio está tocando, para o dock saber se há som a controlar. */
  comSom: number[];
  /**
   * A qualidade de cada transmissão assistida (RF-AST-17), amostrada a cada
   * segundo pela própria conexão — não pelo painel, que pode nem estar aberto.
   */
  quality: Record<number, 'boa' | 'instavel' | 'ruim'>;
  /**
   * Volume geral, de 0 a 1. Mora aqui, e não em `useState`, porque é o mesmo
   * número que os nós de ganho usam — duas cópias sairiam de sincronia — e
   * porque ele sobrevive a trocar de sala (RN-AUD-13).
   */
  volume: number;
  /** Quem não transmite aparece na grade? (RF-AST-14, "sem vídeo"). */
  showPeople: boolean;
  /** 'grade' mostra todo mundo em células iguais; 'foco' dá o palco a uma tela. */
  modo: 'grade' | 'foco';
  /** 'conectando' até o primeiro open; 'caiu' enquanto o backoff espera. */
  phase: 'parado' | 'conectando' | 'aberto' | 'caiu';
}

const VAZIO: RoomSnapshot = {
  room: null,
  participants: [],
  streams: [],
  watching: [],
  drawing: [],
  comSom: [],
  quality: {},
  volume: 1,
  showPeople: true,
  modo: 'grade',
  phase: 'parado',
};

/** Um decodificador vivo: o canvas é um nó só, e sobrevive fora do documento. */
interface Stream {
  userId: string;
  canvas: HTMLCanvasElement;
  player: Player;
  audio: AudioPlayer | null;
  /** A transmissão anunciou áudio? Sem isto não dá para distinguir "não tem
   *  som" de "o som ainda não chegou" — e os dois parecem mudo (RN-AST-24). */
  anunciouSom: boolean;
}

export interface RoomHandlers {
  /** Recusa vinda do servidor (limite de slots, já transmitindo). */
  onError?: (message: string) => void;
  /**
   * Alguém **começou** a transmitir com a gente já na sala (RF-AST-15).
   *
   * Só para quem começa: entrar numa sala com três telas no ar não dispara três
   * avisos — a grade já mostra as três (RN-AST-32).
   */
  onStreamStart?: (slot: number, userId: string) => void;
  /**
   * A sala fechou entre o token e a conexão, ou enquanto estávamos nela
   * (RF-SAL-7). Na Activity o cliente recria e volta para a sala da call; no
   * site avisa e volta ao lobby — quem decide é quem chama.
   */
  onRoomGone?: () => void;
  /**
   * O socket fechou sem nunca ter aberto: o token da sala foi recusado
   * (RF-SES-6). Reconectar com o mesmo token repetiria o 401 para sempre.
   */
  onRejected?: () => void;
  /** Quadro binário. A fase 3 liga os decodificadores aqui. */
  onFrame?: (data: ArrayBuffer) => void;
}

export class RoomConnection {
  #ws: WebSocket | null = null;
  #tokens: RoomTokens | null = null;
  #delay = 1000;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #snapshot: RoomSnapshot = VAZIO;
  #listeners = new Set<() => void>();
  #handlers: RoomHandlers = {};
  #wsUrl: ((path: string) => string) | null = null;
  /** O apelido é do cliente e é reenviado a cada conexão (RN-SES-13). */
  #name: string | null = null;

  /**
   * Um decodificador e um canvas por transmissor, indexados pelo slot.
   *
   * Os canvas vivem **fora do documento** entre renderizações e são movidos
   * para dentro do tile (RN-AST-17): detachar não apaga o conteúdo nem invalida
   * o contexto 2D, então os decodificadores seguem desenhando sem saber de
   * nada. É o que permite trocar o palco sem a imagem piscar.
   */
  #streams = new Map<number, Stream>();

  /** Transmissões anunciadas, assistidas ou não. Assistir é opt-in (RN-AST-2). */
  #available = new Map<number, { userId: string; config: RawVideoConfig | null }>();
  #watching = new Set<number>();
  #drawing = new Set<number>();

  /** Volume geral (0–1) e por pessoa (0–2). O que sai é o produto (RF-AUD-1). */
  #volume = 1;
  #volumePerPerson = new Map<string, number>();
  #showPeople = true;
  /** Quando o servidor avisou descarte por backpressure, por slot (RF-AST-18). */
  #descartes = new Map<number, number>();
  #amostrador: ReturnType<typeof setInterval> | null = null;
  #modo: 'grade' | 'foco' = 'grade';

  // ------------------------------------------------------------- assinatura

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RoomSnapshot => this.#snapshot;

  /** Snapshot do servidor: estável, senão o React reclama de laço infinito. */
  getServerSnapshot = (): RoomSnapshot => VAZIO;

  #publicar(mudanca: Partial<RoomSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...mudanca };
    for (const listener of this.#listeners) listener();
  }

  // ----------------------------------------------------------------- ciclo

  connect(
    wsUrl: (path: string) => string,
    tokens: RoomTokens,
    name: string | null,
    handlers: RoomHandlers = {}
  ): void {
    this.#wsUrl = wsUrl;
    this.#tokens = tokens;
    this.#name = name;
    this.#handlers = handlers;
    this.#delay = 1000;
    this.#abrir();
  }

  #abrir(): void {
    const tokens = this.#tokens;
    const wsUrl = this.#wsUrl;
    if (!tokens || !wsUrl) return;

    this.#publicar({ phase: 'conectando' });

    const ws = new WebSocket(wsUrl(`/ws?t=${encodeURIComponent(tokens.viewerToken)}`));
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;

    let abriu = false;

    ws.addEventListener('open', () => {
      abriu = true;
      this.#amostrador ??= setInterval(() => this.#amostrar(), 1000);
      this.#delay = 1000;
      this.#publicar({ phase: 'aberto' });

      // Sem reenviar, o nome volta ao do Discord sozinho depois de reconectar.
      if (this.#name) ws.send(JSON.stringify({ type: 'rename', name: this.#name }));
    });

    ws.addEventListener('message', (e) => {
      // Primeiro byte é o slot, segundo é o tipo: um diz de quem, o outro diz
      // para qual decodificador — som e imagem dividem o mesmo canal.
      if (typeof e.data !== 'string') {
        // Primeiro byte é o slot, segundo é o tipo: um diz de quem, o outro diz
        // para qual decodificador. Som e imagem dividem o mesmo canal e o mesmo
        // cabeçalho (RN-PRO-18).
        const buffer = e.data as ArrayBuffer;
        const view = new DataView(buffer);
        const stream = this.#streams.get(view.getUint8(0));
        if (!stream) return;
        if (view.getUint8(1) === 3) stream.audio?.push(buffer);
        else stream.player.push(buffer);
        return;
      }
      this.#message(JSON.parse(e.data) as ServerMessage);
    });

    ws.addEventListener('close', () => {
      // Saímos da sala de propósito: nada a reconectar (RN-AST-26). A diferença
      // é `#tokens` ainda existir ou não.
      if (!this.#tokens) {
        this.#publicar({ ...VAZIO, volume: this.#volume, showPeople: this.#showPeople, modo: this.#modo });
        return;
      }

      if (!abriu) {
        this.#tokens = null;
        this.#publicar({ ...VAZIO, volume: this.#volume, showPeople: this.#showPeople, modo: this.#modo });
        this.#handlers.onRejected?.();
        return;
      }

      this.#publicar({ phase: 'caiu', participants: [], streams: [] });
      // Backoff exponencial: 1 s, dobrando, teto de 15 s (RF-AST-10).
      this.#timer = setTimeout(() => this.#abrir(), this.#delay);
      this.#delay = Math.min(this.#delay * 2, 15_000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  #message(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state': {
        const vivos = new Set((msg.streams ?? []).map((s) => s.slot));
        for (const s of msg.streams ?? []) {
          const info = this.#available.get(s.slot) ?? { userId: s.userId, config: null };
          this.#available.set(s.slot, info);
        }
        // Limpa o que sumiu sem `stream-stop` — queda abrupta (RN-AST-27).
        for (const slot of [...this.#available.keys()]) {
          if (!vivos.has(slot)) this.#available.delete(slot);
        }
        for (const slot of [...this.#streams.keys()]) {
          if (!vivos.has(slot)) this.#fecharStream(slot);
        }
        for (const slot of [...this.#watching]) if (!vivos.has(slot)) this.#watching.delete(slot);

        this.#publicar({
          room: msg.room,
          participants: msg.participants ?? [],
          streams: msg.streams ?? [],
          watching: [...this.#watching],
          drawing: [...this.#drawing],
          comSom: this.#slotsComSom(),
        });
        break;
      }
      case 'stream-start':
        // Só anuncia; ninguém assiste até pedir. Transmissão nova zera todo
        // mundo (RN-AST-6).
        this.#available.set(msg.slot, { userId: msg.userId, config: null });
        this.#watching.delete(msg.slot);
        this.#fecharStream(msg.slot);
        this.#publicarSets();
        this.#handlers.onStreamStart?.(msg.slot, msg.userId);
        break;

      case 'config': {
        const info = this.#available.get(msg.slot);
        if (info) info.config = msg.config as unknown as RawVideoConfig;
        if (this.#watching.has(msg.slot)) {
          this.#abrirStream(msg.slot, info?.userId ?? String(msg.slot));
          this.#streams.get(msg.slot)?.player.start(msg.config as unknown as RawVideoConfig);
        }
        break;
      }

      case 'audio-config':
        // Pode chegar antes de eu pedir para assistir; aí não há o que ligar, e
        // o servidor reenvia assim que o pedido chegar (RN-AUD-9).
        if (this.#watching.has(msg.slot)) {
          this.#ligarSom(msg.slot, msg.config as unknown as RawAudioConfig);
        }
        break;

      case 'stream-stop':
        this.#available.delete(msg.slot);
        this.#watching.delete(msg.slot);
        this.#fecharStream(msg.slot);
        this.#publicarSets();
        break;

      case 'dropped':
        // O servidor está descartando quadros nossos: o gargalo é a nossa rede,
        // não a de quem transmite (RF-AST-18).
        this.#descartes.set(msg.slot, Date.now());
        break;

      case 'room-gone':
        this.#tokens = null;
        this.#handlers.onRoomGone?.();
        break;
      case 'error':
        this.#handlers.onError?.(msg.message);
        break;
      default:
        // slot, stream-start, config, audio-config, stream-stop, need-keyframe
        // e stop-request entram na fase 3, junto dos decodificadores.
        break;
    }
  }

  // --------------------------------------------------------- transmissões

  /**
   * Classifica a qualidade de cada transmissão assistida (RF-AST-17).
   *
   * Roda uma vez por segundo porque `takeFrameCount` é lido-e-zerado: dois
   * leitores brigariam pelo mesmo contador, e o painel de detalhes passaria a
   * ver zero sempre.
   */
  #amostrar(): void {
    const target = 30;
    const quality: RoomSnapshot['quality'] = {};

    for (const slot of this.#watching) {
      const stream = this.#streams.get(slot);
      if (!stream || !this.#drawing.has(slot)) continue;

      const lag = stream.player.getLag();
      const fps = stream.player.takeFrameCount();
      const descartando = Date.now() - (this.#descartes.get(slot) ?? 0) < 3000;

      quality[slot] =
        descartando || lag > 800 || fps < target * 0.5
          ? 'ruim'
          : lag > 300 || fps < target * 0.8
            ? 'instavel'
            : 'boa';
      this.#ultimoFps.set(slot, fps);
    }

    this.#publicar({ quality });
  }

  /** O último fps amostrado, para o painel não brigar pelo contador. */
  #ultimoFps = new Map<number, number>();

  #publicarSets(): void {
    this.#publicar({
      watching: [...this.#watching],
      drawing: [...this.#drawing],
      comSom: this.#slotsComSom(),
    });
  }

  #slotsComSom(): number[] {
    return [...this.#streams.entries()].filter(([, s]) => s.audio?.hasSound()).map(([slot]) => slot);
  }

  /** O que sai no alto-falante é o produto dos dois volumes (RF-AUD-1). */
  #volumeDe(userId: string): number {
    return this.#volume * (this.#volumePerPerson.get(userId) ?? 1);
  }

  #abrirStream(slot: number, userId: string): Stream {
    const existente = this.#streams.get(slot);
    if (existente) return existente;

    // O canvas nasce fora do documento e assim continua entre renderizações.
    const canvas = document.createElement('canvas');
    canvas.className = 'max-h-full max-w-full';

    const player = createPlayer(canvas, {
      onError: (m) => this.#handlers.onError?.(m),
      onTamanho: () => {
        // Primeiro quadro desenhado: o tile pode tirar o "Conectando…".
        if (!this.#drawing.has(slot)) {
          this.#drawing.add(slot);
          this.#publicarSets();
        }
      },
    });

    const stream: Stream = { userId, canvas, player, audio: null, anunciouSom: false };
    this.#streams.set(slot, stream);
    return stream;
  }

  #ligarSom(slot: number, config: RawAudioConfig): void {
    const stream = this.#streams.get(slot);
    if (!stream) return;

    stream.anunciouSom = true;

    stream.audio?.stop();
    const audio = createAudio({
      onError: (m) => this.#handlers.onError?.(m),
      volume: this.#volumeDe(stream.userId),
    });
    if (audio.start(config)) {
      stream.audio = audio;
      this.#publicarSets();
    }
  }

  #fecharStream(slot: number): void {
    const stream = this.#streams.get(slot);
    if (!stream) return;
    stream.player.stop();
    stream.audio?.stop();
    stream.canvas.remove();
    this.#streams.delete(slot);
    this.#drawing.delete(slot);
  }

  /**
   * Os números de uma transmissão, para o painel de detalhes (RF-AST-9).
   *
   * De **um stream por vez** (RN-AST-23): somar latências de fontes diferentes
   * não significaria nada. O `fps` é lido-e-zerado, então quem chama precisa
   * chamar uma vez por segundo — é a contagem do último segundo, não um total.
   */
  diagnostico(slot: number): {
    lag: number;
    fps: number;
    video: string;
    box: string;
    sound: 'sem' | 'aguardando' | 'mudo' | 'tocando';
    volume: number;
  } | null {
    const stream = this.#streams.get(slot);
    if (!stream) return null;

    const volume = this.#volumeDe(stream.userId);
    // Quatro estados que, sem esta distinção, parecem todos "sem som"
    // (RN-AST-24).
    const sound = !stream.anunciouSom
      ? 'sem'
      : !stream.audio?.hasSound()
        ? 'aguardando'
        : volume === 0
          ? 'mudo'
          : 'tocando';

    // Antes do primeiro quadro o canvas ainda está no tamanho padrão do
    // elemento (300×150), e mostrar isso como resolução do vídeo é dar um
    // número falso justamente enquanto a pessoa espera para saber se algo está
    // acontecendo.
    const desenhou = this.#drawing.has(slot);
    const tamanhos = stream.player.getSizes();

    return {
      lag: desenhou ? stream.player.getLag() : 0,
      fps: this.#ultimoFps.get(slot) ?? 0,
      video: desenhou ? tamanhos.video : '—',
      box: tamanhos.box,
      sound,
      volume,
    };
  }

  /** O canvas de um slot, para o tile anexá-lo. Um nó só, sempre (RN-AST-17). */
  canvasDe(slot: number): HTMLCanvasElement | null {
    return this.#streams.get(slot)?.canvas ?? null;
  }

  /**
   * Pede para assistir (RF-AST-1). O servidor então manda as configs, pede um
   * keyframe novo ao transmissor e reemite o estado da sala.
   */
  watch(slot: number): void {
    // Pedir o que já se assiste não faz nada: sem essa guarda, um cliente em
    // laço faria o servidor inundar a sala de `state` (RN-AST-5).
    if (this.#watching.has(slot)) return;

    const info = this.#available.get(slot);
    if (!info) return;

    this.#watching.add(slot);
    this.#abrirStream(slot, info.userId);
    // A config guardada serve de partida enquanto o keyframe novo não chega.
    if (info.config) this.#streams.get(slot)?.player.start(info.config);
    this.#send({ type: 'watch', slot });
    this.#publicarSets();
  }

  unwatch(slot: number): void {
    if (!this.#watching.delete(slot)) return;
    this.#fecharStream(slot);
    this.#send({ type: 'unwatch', slot });
    this.#publicarSets();
  }

  /** Volume geral, de 0 a 1. Zero é o mudo — um número só (RN-AUD-12). */
  setVolume(value: number): void {
    this.#volume = Math.min(1, Math.max(0, value));
    for (const [, stream] of this.#streams) {
      stream.audio?.setVolume(this.#volumeDe(stream.userId));
    }
    this.#publicar({ volume: this.#volume });
  }

  /** O volume guardado de uma pessoa. 1 é o padrão e não é registrado (RN-AUD-11). */
  volumeDe(userId: string): number {
    return this.#volumePerPerson.get(userId) ?? 1;
  }

  /** Volume de uma pessoa, de 0 a 2. Guardado por pessoa, não por sessão. */
  setVolumeDe(userId: string, value: number): void {
    this.#volumePerPerson.set(userId, Math.min(2, Math.max(0, value)));
    for (const [, stream] of this.#streams) {
      if (stream.userId === userId) stream.audio?.setVolume(this.#volumeDe(userId));
    }
  }

  /**
   * Alterna grade e foco (RF-AST-13).
   *
   * A escolha vive no armazenamento, como as outras preferências de quem
   * assiste (RN-AST-29): é dela a decisão, não do sistema.
   */
  setModo(modo: 'grade' | 'foco'): void {
    this.#modo = modo;
    store('modo', modo);
    this.#publicar({ modo });
  }

  /** Recolhe ou mostra as pessoas sem vídeo, e guarda a escolha (RF-AST-14). */
  mostrarPessoas(visivel: boolean): void {
    this.#showPeople = visivel;
    store('pessoas', visivel ? '1' : '0');
    this.#publicar({ showPeople: visivel });
  }

  /** Restaura os volumes guardados antes de qualquer som começar. */
  carregarVolumes(geral: number, perPerson: Map<string, number>): void {
    this.#volume = geral;
    this.#volumePerPerson = perPerson;
    this.#showPeople = read('pessoas') !== '0';
    this.#modo = read('modo') === 'foco' ? 'foco' : 'grade';
    this.#publicar({
      volume: geral,
      showPeople: this.#showPeople,
      modo: this.#modo,
    });
  }

  /**
   * Pede ao servidor que encerre a **própria** transmissão (RF-TRX-9).
   *
   * A aba externa tem conexão própria, então só o servidor consegue mandá-la
   * parar (RN-TRX-31). Ele resolve por `uid` e encerra só a de quem pediu —
   * ninguém derruba a tela de outra pessoa (RN-PRO-16).
   */
  pedirParada(): void {
    this.#send({ type: 'stop-broadcast' });
  }

  /** Troca o nome exibido, agora e nas reconexões seguintes (RF-SES-7). */
  rename(name: string): void {
    this.#name = name;
    this.#send({ type: 'rename', name });
  }

  #send(msg: Record<string, unknown>): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  /**
   * Sai da sala. Funil único (RF-SAL-10): sair pelo botão, a sala fechar
   * sozinha e o arranque precisam deixar exatamente o mesmo estado para trás.
   */
  disconnect(): void {
    // Avisa **antes** de fechar: é isso que separa "clicou em sair" de "a
    // conexão caiu" do lado do servidor. Quem sai de propósito dissolve a sala
    // se for o último; quem cai ganha a carência de 12 s, que existe para o F5
    // (RN-SAL-20a).
    this.#send({ type: 'leave' });

    this.#tokens = null;
    if (this.#amostrador) clearInterval(this.#amostrador);
    this.#amostrador = null;
    for (const slot of [...this.#streams.keys()]) this.#fecharStream(slot);
    this.#available.clear();
    this.#watching.clear();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#ws?.close();
    this.#ws = null;
    this.#publicar({ ...VAZIO, volume: this.#volume, showPeople: this.#showPeople, modo: this.#modo });
  }
}
