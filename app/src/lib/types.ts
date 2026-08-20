/**
 * As formas que atravessam a rede, do lado do cliente.
 *
 * Espelham o que `server/src/api.ts` e `server/src/relay.ts` devolvem. O
 * contrato é herdado e não muda de nome (specs/09), então os campos ficam como
 * o servidor os escreve — inclusive `av`, `owner` e `locked`.
 */

export interface Person {
  id: string;
  name: string;
  avatar: string | null;
  broadcasting?: boolean;
}

/** O que /api/session, /api/session-guest e /api/session-dev devolvem. */
export interface Session {
  user: Person;
  instance: string;
  identity: string;
  /** O canal de voz, quando o servidor confirmou a presença (RF-SES-2). */
  call?: string | null;
}

/** Um item da lista do lobby. Nunca traz o hash da senha (RN-SAL-11). */
export interface RoomSummary {
  id: string;
  name: string;
  owner: string;
  isCall: boolean;
  locked: boolean;
  people: number;
  streams: number;
}

/** O que create/join/call devolvem. */
export interface RoomTokens {
  roomId: string;
  viewerToken: string;
  shareUrl: string;
  /**
   * Como a pessoa se chama naquele servidor, quando o Discord soube dizer.
   * Só a entrada por `/<id do servidor>` devolve isto.
   */
  user?: Person;
  /** O nome da sala — "Categoria / Canal" — para a tela de entrada mostrar. */
  roomName?: string;
}

/** O bloco `room` de cada `state` do WebSocket. */
export interface RoomState {
  id: string;
  name: string;
  ownerId: string | null;
  locked: boolean;
}

export interface StreamState {
  slot: number;
  userId: string;
  watchers: Person[];
}

/** O teto por transmissão que o servidor aplica (RF-AST-11). */
export const MAX_VIEWERS_PER_STREAM = 12;

/** A mensagem `state`: sala, participantes e transmissões vivas. */
export interface StateMessage {
  type: 'state';
  room: RoomState | null;
  broadcasting: boolean;
  viewers: number;
  participants: Person[];
  streams: StreamState[];
}

export type ServerMessage =
  | StateMessage
  | { type: 'slot'; slot: number }
  | { type: 'stream-start'; slot: number; userId: string }
  | { type: 'config'; slot: number; config: Record<string, unknown> }
  | { type: 'audio-config'; slot: number; config: Record<string, unknown> }
  | { type: 'stream-stop'; slot: number }
  | { type: 'need-keyframe' }
  | { type: 'stop-request' }
  | { type: 'room-gone' }
  | { type: 'dropped'; slot: number }
  | { type: 'error'; message: string };
