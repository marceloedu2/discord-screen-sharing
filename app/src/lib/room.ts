import { createAudio, type AudioPlayer, type RawAudioConfig } from './audio';
import { createPlayer, type Player, type RawVideoConfig } from './player';
import { read, store } from './storage';
import type { Person, RoomState, RoomTokens, ServerMessage, StreamState } from './types';

/**
 * Sem quadro há mais tempo que isto, com descarte em andamento, é travamento
 * (RF-AST-18a) — não uma rajada passageira. O servidor já avisa a cada 2 s
 * (`DROP_NOTICE_MS`, em server/src/rooms.ts); dar uma folga curta em cima
 * evita pedir de novo por causa de uma única perda isolada que o próximo
 * delta já resolveria sozinho.
 */
const STALL_MS = 1200;

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
  withSound: number[];
  /**
   * A qualidade de cada transmissão assistida (RF-AST-17), amostrada a cada
   * segundo pela própria conexão — não pelo painel, que pode nem estar aberto.
   */
  quality: Record<number, 'good' | 'unstable' | 'bad'>;
  /**
   * Volume geral, de 0 a 1. Mora aqui, e não em `useState`, porque é o mesmo
   * número que os nós de ganho usam — duas cópias sairiam de sincronia — e
   * porque ele sobrevive a trocar de sala (RN-AUD-13).
   */
  volume: number;
  /** Quem não transmite aparece na grade? (RF-AST-14, "sem vídeo"). */
  showPeople: boolean;
  /** 'grid' mostra todo mundo em células iguais; 'focus' dá o palco a uma tela. */
  mode: 'grid' | 'focus';
  /** 'connecting' até o primeiro open; 'down' enquanto o backoff espera. */
  phase: 'idle' | 'connecting' | 'open' | 'down';
}

const EMPTY: RoomSnapshot = {
  room: null,
  participants: [],
  streams: [],
  watching: [],
  drawing: [],
  withSound: [],
  quality: {},
  volume: 1,
  showPeople: true,
  mode: 'grid',
  phase: 'idle',
};

/** Um decodificador vivo: o canvas é um nó só, e sobrevive fora do documento. */
interface Stream {
  userId: string;
  canvas: HTMLCanvasElement;
  player: Player;
  audio: AudioPlayer | null;
  /** A transmissão anunciou áudio? Sem isto não dá para distinguir "não tem
   *  som" de "o som ainda não chegou" — e os dois parecem mudo (RN-AST-24). */
  announcedSound: boolean;
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
  #snapshot: RoomSnapshot = EMPTY;
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
  #drops = new Map<number, number>();
  #sampler: ReturnType<typeof setInterval> | null = null;
  #mode: 'grid' | 'focus' = 'grid';

  // ------------------------------------------------------------- assinatura

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RoomSnapshot => this.#snapshot;

  /** Snapshot do servidor: estável, senão o React reclama de laço infinito. */
  getServerSnapshot = (): RoomSnapshot => EMPTY;

  #publish(changes: Partial<RoomSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...changes };
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
    this.#open();
  }

  #open(): void {
    const tokens = this.#tokens;
    const wsUrl = this.#wsUrl;
    if (!tokens || !wsUrl) return;

    this.#publish({ phase: 'connecting' });

    const ws = new WebSocket(wsUrl(`/ws?t=${encodeURIComponent(tokens.viewerToken)}`));
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;

    let opened = false;

    ws.addEventListener('open', () => {
      opened = true;
      this.#sampler ??= setInterval(() => this.#sample(), 1000);
      this.#delay = 1000;
      this.#publish({ phase: 'open' });

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
        this.#publish({ ...EMPTY, volume: this.#volume, showPeople: this.#showPeople, mode: this.#mode });
        return;
      }

      if (!opened) {
        this.#tokens = null;
        this.#publish({ ...EMPTY, volume: this.#volume, showPeople: this.#showPeople, mode: this.#mode });
        this.#handlers.onRejected?.();
        return;
      }

      this.#publish({ phase: 'down', participants: [], streams: [] });
      // Backoff exponencial: 1 s, dobrando, teto de 15 s (RF-AST-10).
      this.#timer = setTimeout(() => this.#open(), this.#delay);
      this.#delay = Math.min(this.#delay * 2, 15_000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  #message(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state': {
        const alive = new Set((msg.streams ?? []).map((s) => s.slot));
        for (const s of msg.streams ?? []) {
          const info = this.#available.get(s.slot) ?? { userId: s.userId, config: null };
          this.#available.set(s.slot, info);
        }
        // Limpa o que sumiu sem `stream-stop` — queda abrupta (RN-AST-27).
        for (const slot of [...this.#available.keys()]) {
          if (!alive.has(slot)) this.#available.delete(slot);
        }
        for (const slot of [...this.#streams.keys()]) {
          if (!alive.has(slot)) this.#closeStream(slot);
        }
        for (const slot of [...this.#watching]) if (!alive.has(slot)) this.#watching.delete(slot);

        this.#publish({
          room: msg.room,
          participants: msg.participants ?? [],
          streams: msg.streams ?? [],
          watching: [...this.#watching],
          drawing: [...this.#drawing],
          withSound: this.#slotsWithSound(),
        });
        break;
      }
      case 'stream-start':
        // Só anuncia; ninguém assiste até pedir. Transmissão nova zera todo
        // mundo (RN-AST-6).
        this.#available.set(msg.slot, { userId: msg.userId, config: null });
        this.#watching.delete(msg.slot);
        this.#closeStream(msg.slot);
        this.#publishSets();
        this.#handlers.onStreamStart?.(msg.slot, msg.userId);
        break;

      case 'config': {
        const info = this.#available.get(msg.slot);
        if (info) info.config = msg.config as unknown as RawVideoConfig;
        if (this.#watching.has(msg.slot)) {
          this.#openStream(msg.slot, info?.userId ?? String(msg.slot));
          this.#streams.get(msg.slot)?.player.start(msg.config as unknown as RawVideoConfig);
        }
        break;
      }

      case 'audio-config':
        // Pode chegar antes de eu pedir para assistir; aí não há o que ligar, e
        // o servidor reenvia assim que o pedido chegar (RN-AUD-9).
        if (this.#watching.has(msg.slot)) {
          this.#startAudio(msg.slot, msg.config as unknown as RawAudioConfig);
        }
        break;

      case 'stream-stop':
        this.#available.delete(msg.slot);
        this.#watching.delete(msg.slot);
        this.#closeStream(msg.slot);
        this.#publishSets();
        break;

      case 'dropped': {
        // O servidor está descartando quadros nossos: o gargalo é a nossa rede,
        // não a de quem transmite (RF-AST-18).
        this.#drops.set(msg.slot, Date.now());

        // Faz tempo que não desenha um quadro — ou nunca desenhou nenhum — e o
        // servidor continua descartando: é o sinal de que o keyframe que
        // destravaria a imagem também está se perdendo no caminho (RF-AST-18a).
        // Sem isto, quem cai nesse buraco ficava preso em "Conectando…" para
        // sempre, ou vendo a imagem congelada até o próximo keyframe
        // periódico — até 3 s depois — em vez de pedir um agora.
        const lastFrame = this.#lastFrameAt.get(msg.slot) ?? 0;
        if (this.#watching.has(msg.slot) && Date.now() - lastFrame > STALL_MS) {
          this.#send({ type: 'rewatch', slot: msg.slot });
        }
        break;
      }

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
  #sample(): void {
    const target = 30;
    const quality: RoomSnapshot['quality'] = {};

    for (const slot of this.#watching) {
      const stream = this.#streams.get(slot);
      if (!stream || !this.#drawing.has(slot)) continue;

      const lag = stream.player.getLag();
      const fps = stream.player.takeFrameCount();
      const dropping = Date.now() - (this.#drops.get(slot) ?? 0) < 3000;

      quality[slot] =
        dropping || lag > 800 || fps < target * 0.5
          ? 'bad'
          : lag > 300 || fps < target * 0.8
            ? 'unstable'
            : 'good';
      this.#lastFps.set(slot, fps);
    }

    this.#publish({ quality });
  }

  /** O último fps amostrado, para o painel não brigar pelo contador. */
  #lastFps = new Map<number, number>();

  /**
   * Quando o slot desenhou um quadro pela última vez (RF-AST-18a).
   *
   * Ausente = nunca desenhou. É o que diferencia "travou" de "não abriu
   * ainda": os dois pedem `rewatch`, mas por sinais diferentes — ver `dropped`
   * em `#message`.
   */
  #lastFrameAt = new Map<number, number>();

  #publishSets(): void {
    this.#publish({
      watching: [...this.#watching],
      drawing: [...this.#drawing],
      withSound: this.#slotsWithSound(),
    });
  }

  #slotsWithSound(): number[] {
    return [...this.#streams.entries()].filter(([, s]) => s.audio?.hasSound()).map(([slot]) => slot);
  }

  /** O que sai no alto-falante é o produto dos dois volumes (RF-AUD-1). */
  #volumeFor(userId: string): number {
    return this.#volume * (this.#volumePerPerson.get(userId) ?? 1);
  }

  #openStream(slot: number, userId: string): Stream {
    const existing = this.#streams.get(slot);
    if (existing) return existing;

    // O canvas nasce fora do documento e assim continua entre renderizações.
    const canvas = document.createElement('canvas');
    // O enquadramento sai daqui, e é justo por construção: o buffer fica no
    // tamanho nativo do vídeo (RN-AST-18), o que dá ao canvas a **proporção
    // intrínseca** da tela transmitida, como uma imagem tem. Com os dois
    // máximos ele encolhe até caber — sem tarja e sem corte, em tile de
    // qualquer formato. Medido em 16/9, 4/3 e 9/16, dentro de pais largos e
    // altos.
    //
    // `min-h-0 min-w-0` não é enfeite: item de grade nasce com `min-height:
    // auto`, que é o tamanho mínimo do conteúdo e **vence o `max-height`**.
    // Sem isso o canvas escala pela largura e transborda — era daí que vinha o
    // rodapé cortado da tela compartilhada, junto da barra de tarefas.
    canvas.className = 'block min-h-0 min-w-0 max-h-full max-w-full';

    const player = createPlayer(canvas, {
      onError: (m) => this.#handlers.onError?.(m),
      onFrame: () => this.#lastFrameAt.set(slot, Date.now()),
      onSize: () => {
        // Primeiro quadro desenhado: o tile pode tirar o "Conectando…".
        if (!this.#drawing.has(slot)) {
          this.#drawing.add(slot);
          this.#publishSets();
        }
      },
    });

    const stream: Stream = { userId, canvas, player, audio: null, announcedSound: false };
    this.#streams.set(slot, stream);
    return stream;
  }

  #startAudio(slot: number, config: RawAudioConfig): void {
    const stream = this.#streams.get(slot);
    if (!stream) return;

    stream.announcedSound = true;

    stream.audio?.stop();
    const audio = createAudio({
      onError: (m) => this.#handlers.onError?.(m),
      volume: this.#volumeFor(stream.userId),
    });
    if (audio.start(config)) {
      stream.audio = audio;
      this.#publishSets();
    }
  }

  #closeStream(slot: number): void {
    const stream = this.#streams.get(slot);
    if (!stream) return;
    stream.player.stop();
    stream.audio?.stop();
    stream.canvas.remove();
    this.#streams.delete(slot);
    this.#drawing.delete(slot);
    // Slot é reciclado entre transmissores (RN-PRO-*, no máximo 4 ao mesmo
    // tempo): sem isto, um carimbo velho da transmissão anterior podia
    // convencer o vigia de travamento de que a nova já desenhou algo.
    this.#lastFrameAt.delete(slot);
  }

  /**
   * Os números de uma transmissão, para o painel de detalhes (RF-AST-9).
   *
   * De **um stream por vez** (RN-AST-23): somar latências de fontes diferentes
   * não significaria nada. O `fps` é lido-e-zerado, então quem chama precisa
   * chamar uma vez por segundo — é a contagem do último segundo, não um total.
   */
  diagnostics(slot: number): {
    lag: number;
    fps: number;
    video: string;
    box: string;
    sound: 'sem' | 'aguardando' | 'mudo' | 'tocando';
    volume: number;
  } | null {
    const stream = this.#streams.get(slot);
    if (!stream) return null;

    const volume = this.#volumeFor(stream.userId);
    // Quatro estados que, sem esta distinção, parecem todos "sem som"
    // (RN-AST-24).
    const sound = !stream.announcedSound
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
    const drawn = this.#drawing.has(slot);
    const sizes = stream.player.getSizes();

    return {
      lag: drawn ? stream.player.getLag() : 0,
      fps: this.#lastFps.get(slot) ?? 0,
      video: drawn ? sizes.video : '—',
      box: sizes.box,
      sound,
      volume,
    };
  }

  /** O canvas de um slot, para o tile anexá-lo. Um nó só, sempre (RN-AST-17). */
  canvasFor(slot: number): HTMLCanvasElement | null {
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
    this.#openStream(slot, info.userId);
    // A config guardada serve de partida enquanto o keyframe novo não chega.
    if (info.config) this.#streams.get(slot)?.player.start(info.config);
    this.#send({ type: 'watch', slot });
    this.#publishSets();
  }

  unwatch(slot: number): void {
    if (!this.#watching.delete(slot)) return;
    this.#closeStream(slot);
    this.#send({ type: 'unwatch', slot });
    this.#publishSets();
  }

  /** Volume geral, de 0 a 1. Zero é o mudo — um número só (RN-AUD-12). */
  setVolume(value: number): void {
    this.#volume = Math.min(1, Math.max(0, value));
    for (const [, stream] of this.#streams) {
      stream.audio?.setVolume(this.#volumeFor(stream.userId));
    }
    this.#publish({ volume: this.#volume });
  }

  /** O volume guardado de uma pessoa. 1 é o padrão e não é registrado (RN-AUD-11). */
  volumeFor(userId: string): number {
    return this.#volumePerPerson.get(userId) ?? 1;
  }

  /** Volume de uma pessoa, de 0 a 2. Guardado por pessoa, não por sessão. */
  setVolumeFor(userId: string, value: number): void {
    this.#volumePerPerson.set(userId, Math.min(2, Math.max(0, value)));
    for (const [, stream] of this.#streams) {
      if (stream.userId === userId) stream.audio?.setVolume(this.#volumeFor(userId));
    }
  }

  /**
   * Alterna grade e foco (RF-AST-13).
   *
   * A escolha vive no armazenamento, como as outras preferências de quem
   * assiste (RN-AST-29): é dela a decisão, não do sistema.
   */
  setMode(mode: 'grid' | 'focus'): void {
    this.#mode = mode;
    // A chave e os valores no disco seguem em português (RN-UI-*: dado já
    // gravado de quem usa não se renomeia) — só o código ao redor virou
    // inglês. Por isso a tradução na borda, os dois sentidos.
    store('modo', mode === 'focus' ? 'foco' : 'grade');
    this.#publish({ mode });
  }

  /** Recolhe ou mostra as pessoas sem vídeo, e guarda a escolha (RF-AST-14). */
  setShowPeople(visible: boolean): void {
    this.#showPeople = visible;
    store('pessoas', visible ? '1' : '0');
    this.#publish({ showPeople: visible });
  }

  /** Restaura os volumes guardados antes de qualquer som começar. */
  loadVolumes(overall: number, perPerson: Map<string, number>): void {
    this.#volume = overall;
    this.#volumePerPerson = perPerson;
    this.#showPeople = read('pessoas') !== '0';
    this.#mode = read('modo') === 'foco' ? 'focus' : 'grid';
    this.#publish({
      volume: overall,
      showPeople: this.#showPeople,
      mode: this.#mode,
    });
  }

  /**
   * Pede ao servidor que encerre a **própria** transmissão (RF-TRX-9).
   *
   * A aba externa tem conexão própria, então só o servidor consegue mandá-la
   * parar (RN-TRX-31). Ele resolve por `uid` e encerra só a de quem pediu —
   * ninguém derruba a tela de outra pessoa (RN-PRO-16).
   */
  requestStop(): void {
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
    if (this.#sampler) clearInterval(this.#sampler);
    this.#sampler = null;
    for (const slot of [...this.#streams.keys()]) this.#closeStream(slot);
    this.#available.clear();
    this.#watching.clear();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#ws?.close();
    this.#ws = null;
    this.#publish({ ...EMPTY, volume: this.#volume, showPeople: this.#showPeople, mode: this.#mode });
  }
}
