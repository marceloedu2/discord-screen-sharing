/**
 * Player WebCodecs. Porte de client/src/player.js — tipagem por cima, lógica
 * intacta (specs/01, "vem sem reescrita").
 *
 * Dentro da Activity não existe WebRTC, mas WebCodecs não é bloqueado por
 * Permissions Policy — então dá para decodificar quadro a quadro e desenhar num
 * canvas, sem passar por container nem por MediaSource.
 *
 * O canvas mantém SEMPRE o tamanho nativo do vídeo no buffer interno
 * (RN-AST-18). Isso dá a ele uma proporção intrínseca, e o CSS apenas o limita
 * com max-width/max-height — o navegador então reduz preservando a proporção,
 * por construção. Dimensionar o buffer pelo tamanho de exibição faz a proporção
 * depender do formato do container e distorce a imagem no redimensionamento.
 */

/** A config de decodificador como o servidor a repassa: `description` em base64. */
export interface RawVideoConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: string;
}

export interface Player {
  start: (raw: RawVideoConfig) => boolean;
  push: (buffer: ArrayBuffer) => void;
  stop: () => void;
  getLag: () => number;
  takeFrameCount: () => number;
  getSizes: () => { video: string; box: string };
}

export function createPlayer(
  canvas: HTMLCanvasElement,
  {
    onError,
    onSize,
    onFrame,
  }: { onError?: (m: string) => void; onSize?: () => void; onFrame?: () => void } = {}
): Player {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  let decoder: VideoDecoder | null = null;
  let needKeyframe = true;
  let lastLagMs = 0;
  let framesDrawn = 0;
  // Quem espera precisa saber quando a espera acabou: entre pedir para assistir
  // e o primeiro quadro cabe um keyframe inteiro de atraso, e o canvas preto
  // desse intervalo é idêntico a um travamento (RF-AST-5).
  let pristine = true;

  function draw(frame: VideoFrame): void {
    // Buffer no tamanho nativo do vídeo: é isso que define a proporção
    // intrínseca do elemento, e é o que impede o CSS de distorcer.
    let changed = false;
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      changed = true;
    }

    ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);

    // VideoFrame segura memória de GPU; sem close() a aba trava em segundos.
    frame.close();
    framesDrawn++;
    // Todo quadro que chega a desenhar, não só o primeiro: é o pulso que o
    // vigia de travamento (RoomConnection) usa para saber que ainda está vivo.
    onFrame?.();

    // Avisa no primeiro quadro e sempre que a resolução muda: quem desenha o
    // palco precisa das duas coisas — tirar o "Conectando…" e refazer a forma.
    if (pristine || changed) {
      pristine = false;
      onSize?.();
    }
  }

  function stop(): void {
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        // Fechar um decoder que já morreu não é erro que interesse a ninguém.
      }
    }
    decoder = null;
    needKeyframe = true;
    lastLagMs = 0;
    if (ctx && canvas.width && canvas.height) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function start(rawConfig: RawVideoConfig): boolean {
    stop();

    if (!('VideoDecoder' in window)) {
      onError?.('Este navegador não tem WebCodecs — não é possível assistir.');
      return false;
    }

    const config = deserialize(rawConfig);

    decoder = new VideoDecoder({
      output: draw,
      error: (err) => {
        // Erro de decodificação normalmente é fluxo fora de sincronia: pedir um
        // keyframe recupera sem derrubar a sessão.
        console.warn('[decoder]', err.message);
        needKeyframe = true;
      },
    });

    try {
      decoder.configure(config);
    } catch {
      onError?.(`Codec não suportado por este navegador: ${config.codec}`);
      decoder = null;
      return false;
    }

    needKeyframe = true;
    return true;
  }

  /** Quadro empacotado: [1B slot][1B tipo][8B timestamp][8B envio][payload] */
  function push(buffer: ArrayBuffer): void {
    if (!decoder || decoder.state !== 'configured') return;

    const view = new DataView(buffer);
    const isKeyframe = view.getUint8(1) === 1;

    // Decoder frio só aceita keyframe; deltas antes disso viram erro (RN-AST-4).
    if (needKeyframe && !isKeyframe) return;

    const timestamp = view.getFloat64(2);
    const sentAt = view.getFloat64(10);
    lastLagMs = Date.now() - sentAt;

    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: isKeyframe ? "key" : "delta",
          timestamp,
          data: new Uint8Array(buffer, 18),
        })
      );
      needKeyframe = false;
    } catch (err) {
      console.warn('[decode]', err instanceof Error ? err.message : err);
      needKeyframe = true;
    }
  }

  /**
   * Atraso aproximado em ms (RN-AST-25). Exato na mesma máquina; entre máquinas
   * diferentes, sujeito a desvio de relógio.
   */
  const getLag = () => lastLagMs;

  /** Resolução nativa do vídeo e tamanho de exibição — para diagnóstico. */
  function getSizes() {
    const rect = canvas.getBoundingClientRect();
    return {
      video: `${canvas.width}×${canvas.height}`,
      box: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
    };
  }

  function takeFrameCount(): number {
    const n = framesDrawn;
    framesDrawn = 0;
    return n;
  }

  return { start, push, stop, getLag, takeFrameCount, getSizes };
}

function deserialize(c: RawVideoConfig): VideoDecoderConfig {
  const out: VideoDecoderConfig = {
    codec: c.codec,
    codedWidth: c.codedWidth,
    codedHeight: c.codedHeight,
    // Reduz o buffering interno do decoder — sem isso ele acumula alguns
    // quadros antes de emitir o primeiro.
    optimizeForLatency: true,
  };

  if (c.description) {
    const bin = atob(c.description);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    out.description = bytes;
  }

  return out;
}
