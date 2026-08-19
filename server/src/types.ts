/**
 * Os tipos do domínio, num lugar só.
 *
 * A versão em JavaScript deste servidor pendurava o estado do espectador no
 * próprio socket (`ws.__watching`, `ws.__primed`, `ws.__info`). Funcionava, mas
 * não sobrevive a `strict`: nada garante que as três existam, e no caminho
 * quente — o repasse de quadros — cada acesso viraria uma checagem.
 *
 * Aqui o espectador é um objeto que *tem* um socket. O caminho quente lê
 * propriedade direta, e o compilador passa a saber o que existe.
 */
import type { WebSocket } from 'ws';

export interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

/** Config de decodificador, opaca para o servidor: ele guarda e repassa. */
export type CodecConfig = Record<string, unknown>;

export interface Broadcast {
  ws: WebSocket;
  info: Person;
  /** Carimbado no primeiro byte de todo quadro pelo próprio transmissor. */
  slot: number;
  streaming: boolean;
  config: CodecConfig | null;
  audioConfig: CodecConfig | null;
}

export interface Viewer {
  ws: WebSocket;
  info: Person;
  /** Slots que esta pessoa pediu para ver. Assistir é opt-in. */
  watching: Set<number>;
  /** Slots de que já recebeu keyframe — delta em decoder frio só dá erro. */
  primed: Set<number>;
}

export interface PasswordHash {
  salt: Buffer;
  hash: Buffer;
}

export interface Room {
  id: string;
  instance: string;
  name: string;
  /** A sala fixa de uma call: sem dono, sem senha, fora da lista pública. */
  isCall: boolean;
  ownerId: string | null;
  ownerName: string;
  password: PasswordHash | null;
  attempts: number[];
  lockedUntil: number;
  createdAt: number;
  /** null enquanto há gente; carimbo do momento em que esvaziou. */
  emptySince: number | null;
  broadcasters: Map<string, Broadcast>;
  slots: Map<number, Broadcast>;
  viewers: Map<WebSocket, Viewer>;
  droppedChunks: number;
}

/**
 * O que vai dentro de um token assinado.
 *
 * Dois escopos, e a diferença é de propósito: `identity` prova quem a pessoa é
 * e não abre sala nenhuma; os de sala carregam `room`, e é isso que a porta do
 * WebSocket exige. Um token de identidade não abre socket.
 */
export interface Claims {
  uid: string;
  name: string;
  av: string | null;
  scope?: 'identity';
  instance?: string;
  /** Canal de voz confirmado pelo Discord, quando houve confirmação. */
  call?: string;
  room?: string;
  role?: 'viewer' | 'broadcaster';
  exp?: number;
}
