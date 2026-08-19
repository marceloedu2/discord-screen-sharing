/**
 * O que o HTML renderizado no servidor deixa no navegador.
 *
 * O Client ID chega por aqui, e não pelo bundle (RN-SES-4): embutir obrigava a
 * rebuildar a cada troca de credencial, e esquecer o build não dava erro — a
 * atividade abria e só quebrava no login, longe da causa. O Client ID é público
 * por natureza, aparece em toda URL de OAuth; o secret nunca sai do servidor.
 */
interface DadosDaSala {
  /** null quando DISCORD_CLIENT_ID não está configurado. */
  clientId: string | null;
}

interface Window {
  /**
   * Ausente só se o HTML não veio deste app — dentro do produto o layout
   * sempre escreve o objeto, mesmo sem credencial configurada.
   */
  __SALA__?: DadosDaSala;
}

/**
 * O que a lib do DOM ainda não declara, e este projeto usa.
 *
 * Não é remendo de tipagem frouxa: são APIs reais, em uso no pipeline de
 * captura, que o TypeScript ainda não acompanhou. Declarar aqui mantém o
 * `strict` valendo no resto do arquivo em vez de espalhar `any` pelo caminho
 * quente.
 */

/** Acesso direto aos quadros, sem cópia intermediária. Só em Chromium. */
declare class MediaStreamTrackProcessor<T = VideoFrame | AudioData> {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<T>;
}

interface MediaTrackConstraintSet {
  /** Pede o som do computador, e não só o da aba. */
  systemAudio?: 'include' | 'exclude';
  /** Tira da captura o que esta própria página está tocando. Experimental. */
  restrictOwnAudio?: boolean;
}

interface MediaTrackSupportedConstraints {
  restrictOwnAudio?: boolean;
}

interface MediaTrackSettings {
  /** 'browser' é aba — a única superfície cujo som não traz o Discord junto. */
  displaySurface?: 'browser' | 'window' | 'monitor';
}

interface HTMLVideoElement {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
}

/** O ramo de configuração do H264, que a lib ainda não descreve. */
interface VideoEncoderConfig {
  avc?: { format: 'annexb' | 'avc' };
}

/** Document Picture-in-Picture (Chromium). Ainda fora da lib do DOM. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}
