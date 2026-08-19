/**
 * Reprodução do áudio que vem junto com a tela. Porte de client/src/audio.js —
 * tipagem por cima, lógica intacta.
 *
 * Cada pacote Opus chega, é decodificado e agendado no AudioContext logo depois
 * do anterior. Áudio não perdoa buraco: ao contrário do vídeo, onde um quadro
 * perdido passa despercebido, um intervalo sem amostra é um estalo audível
 * (RN-AUD-2). Por isso existe um colchão — o som toca alguns milissegundos
 * atrás do vivo, e é essa folga que absorve o solavanco da rede.
 *
 * Sem AudioWorklet de propósito (RN-AUD-5). Ele daria precisão por amostra, mas
 * exige um arquivo carregado por URL, e dentro do iframe da Activity toda URL
 * passa pelo proxy do Discord — um caminho a mais para dar errado, em troca de
 * uma precisão que pacotes de 20 ms não pedem. Se aparecer estalo com rede
 * ruim, o passo seguinte é um AudioWorklet com ring buffer.
 */

/** Colchão contra o solavanco da rede (RN-AUD-2). */
const COLCHAO = 0.08;

/** Teto do atraso acumulado: passando disso, corta e volta ao vivo (RN-AUD-3). */
const ATRASO_MAXIMO = COLCHAO * 4;

export interface RawAudioConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
}

export interface AudioPlayer {
  start: (config: RawAudioConfig) => boolean;
  push: (buffer: ArrayBuffer) => void;
  stop: () => void;
  setVolume: (value: number) => void;
  hasSound: () => boolean;
}

export function createAudio(
  { onError, volume = 1 }: { onError?: (m: string) => void; volume?: number } = {}
): AudioPlayer {
  let ctx: AudioContext | null = null;
  let decoder: AudioDecoder | null = null;
  let ganho: GainNode | null = null;
  let proximo = 0;
  let nivel = volume;
  let tocou = false;

  function agendar(data: AudioData): void {
    if (!ctx || !ganho) {
      data.close();
      return;
    }

    const canais = data.numberOfChannels;
    const buffer = ctx.createBuffer(canais, data.numberOfFrames, data.sampleRate);
    for (let c = 0; c < canais; c++) {
      data.copyTo(buffer.getChannelData(c), { planeIndex: c, format: 'f32-planar' });
    }
    data.close();

    const agora = ctx.currentTime;

    // Fila secou (a rede engasgou): recomeça do presente. Agendar no passado não
    // atrasa a reprodução — o navegador simplesmente descarta o trecho.
    if (proximo < agora + 0.005) proximo = agora + COLCHAO;
    // Fila cresceu demais: atraso acumulado não se recupera sozinho, e arrastar
    // o som cada vez mais para trás da imagem é pior que um corte.
    else if (proximo - agora > ATRASO_MAXIMO) proximo = agora + COLCHAO;

    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ganho);
    fonte.start(proximo);
    proximo += buffer.duration;
    tocou = true;

    // O navegador pode ter criado o contexto suspenso; assistir foi um clique,
    // então retomar aqui é legítimo e não esbarra na política de autoplay.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  function stop(): void {
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        // Fechar o que já morreu não interessa a ninguém.
      }
    }
    decoder = null;

    void ctx?.close().catch(() => {});
    ctx = null;
    ganho = null;
    proximo = 0;
    tocou = false;
  }

  function start(config: RawAudioConfig): boolean {
    stop();

    if (!('AudioDecoder' in window) || !('AudioContext' in window)) {
      onError?.('Este navegador não toca o áudio da transmissão.');
      return false;
    }

    // sampleRate igual ao da origem (RN-AUD-6): deixar o navegador reamostrar
    // acrescenta latência e artefato sem ganho nenhum.
    ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: config.sampleRate });
    ganho = ctx.createGain();
    ganho.gain.value = nivel;
    ganho.connect(ctx.destination);

    decoder = new AudioDecoder({
      output: agendar,
      // Pacote corrompido é um estalo, não o fim da transmissão: o próximo se
      // decodifica sozinho, então não há o que reiniciar (RN-AUD-7).
      error: (err) => console.warn('[audio]', err.message),
    });

    try {
      decoder.configure({
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.numberOfChannels,
      });
    } catch {
      onError?.(`Áudio em formato não suportado: ${config.codec}`);
      decoder = null;
      return false;
    }

    proximo = 0;
    tocou = false;
    return true;
  }

  /** Pacote empacotado: [1B slot][1B tipo][8B timestamp][8B envio][payload] */
  function push(buffer: ArrayBuffer): void {
    if (!decoder || decoder.state !== 'configured') return;

    const view = new DataView(buffer);
    try {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key', // Todo pacote Opus se decodifica sozinho (RN-AUD-1).
          timestamp: view.getFloat64(2),
          data: new Uint8Array(buffer, 18),
        })
      );
    } catch (err) {
      console.warn('[audio decode]', err instanceof Error ? err.message : err);
    }
  }

  /**
   * @param valor 0 a 2. Zero é o mudo — não existe estado separado (RN-AUD-12) —
   * e acima de 1 amplifica, para socorrer quem capturou o som muito baixo.
   */
  function setVolume(value: number): void {
    nivel = Math.min(2, Math.max(0, value));
    // Rampa curta em vez de salto: mudar o ganho de um instante para o outro
    // produz um clique audível, que é justamente o que se quer evitar.
    if (ganho) ganho.gain.setTargetAtTime(nivel, ganho.context.currentTime, 0.02);
  }

  return { start, push, stop, setVolume, hasSound: () => tocou };
}
