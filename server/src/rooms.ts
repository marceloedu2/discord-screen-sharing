/**
 * Registro e relay de salas.
 *
 * Salas são criadas explicitamente por alguém e vivem em memória. Cada uma
 * pertence a uma instância da Activity (o canal de voz), então canais
 * diferentes não enxergam as salas uns dos outros.
 *
 * Vários transmissores simultâneos por sala; N espectadores. Cada transmissor
 * recebe um "slot" numérico e carimba esse número no primeiro byte de todo
 * quadro, então o servidor repassa o buffer sem tocar nele e o espectador sabe
 * para qual decodificador mandar.
 *
 * O servidor não decodifica nada. Ele guarda o config de cada transmissor e
 * distingue keyframe de delta, porque quem começa a assistir precisa de um
 * keyframe: delta em decodificador frio só dá erro.
 *
 * As mensagens JSON e o cabeçalho binário são contrato herdado — `.claude/.claude/specs/09-protocolo.md`. Nada aqui pode mudar de nome sem quebrar o cliente antigo.
 */
import crypto from 'node:crypto';

import type { WebSocket } from 'ws';
import type { Broadcast, CodecConfig, PasswordHash, Person, Room, Viewer } from './types.ts';

const MAX_BROADCASTERS = 4;

/**
 * Teto de espectadores **por transmissão** (RF-AST-11).
 *
 * A banda de subida cresce linearmente com quem assiste (RN-TRX-34): a 8 Mbps o
 * décimo espectador já pede 80 Mb/s de upload, que ninguém tem. Sem teto o
 * sintoma não é uma recusa clara — é a transmissão de todo mundo degradando
 * junto, com o backpressure descartando quadros sem ninguém entender por quê.
 *
 * É por transmissão, e não por sala (RN-AST-28): quatro telas com doze
 * espectadores cada é banda de quatro transmissores diferentes.
 */
const MAX_VIEWERS_PER_STREAM = Number(process.env.MAX_VIEWERS_PER_STREAM) || 12;
// Sala é objeto em memória criado por qualquer pessoa autenticada: sem teto,
// um laço de "criar sala" consome a RAM do processo.
const MAX_ROOMS_PER_INSTANCE = 20;
// 2 MB (4 para keyframe) era o valor herdado — e a um bitrate de 1 Mbps
// (preset Leve) isso é **16 segundos** de vídeo enfileirado antes de o
// servidor sequer começar a descartar. Enquanto essa fila escoa, tudo que sai
// depois dela também espera — inclusive o `stream-stop` de quem parou de
// transmitir, que chega minutos depois de a transmissão já ter acabado
// (RF-AST-18a). A um bitrate alto (8 Mbps) o mesmo teto vira só 2 s, então o
// valor bom para um preset é ruim demais para outro. 400 KB fica perto de 1 s
// no preset mais pesado e de 3,2 s no mais leve — ainda folgado para uma
// rajada, mas curto o bastante para o descarte (e o resync de RN-AST-3a)
// entrarem enquanto a pessoa ainda está olhando para a tela travada.
const MAX_BUFFERED_BYTES = 400 * 1024;

/**
 * Espaçamento do aviso de descarte ao espectador (RF-AST-18).
 *
 * Sem isto, quem está com rede ruim recebe um aviso por quadro perdido — dezenas
 * por segundo, no mesmo socket que já não dá conta. Um a cada 2 s basta para o
 * indicador de qualidade saber que o problema é do lado de quem assiste, e não
 * de quem transmite — que é justamente a pergunta que se faz nessa hora.
 */
const DROP_NOTICE_MS = 2000;
const MAX_NAME = 32;
const MAX_ROOM_NAME = 40;

// Sala vazia fecha, mas não no mesmo instante: recarregar a atividade
// desconecta e reconecta, e quem estivesse sozinho perderia a sala a cada F5.
// 12s cobre um reload com folga e some rápido o bastante para não deixar sala
// fantasma na lista.
const EMPTY_GRACE_MS = 12_000;
const SWEEP_EVERY_MS = 4_000;

// Freio de força bruta: sem isso uma senha curta cai em segundos, porque o
// endpoint responde tão rápido quanto a rede permite.
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const LOCKOUT_MS = 30_000;

const SLOT_BYTE = 0;
const TYPE_BYTE = 1;
const TYPE_KEYFRAME = 1;
const TYPE_AUDIO = 3;

const rooms = new Map<string, Room>();

// --------------------------------------------------------------------- senha

function hashPassword(password: string, salt: Buffer = crypto.randomBytes(16)): PasswordHash {
  return { salt, hash: crypto.scryptSync(password, salt, 32) };
}

function passwordMatches(room: Room, password: string): boolean {
  if (!room.password) return true;
  const { hash } = hashPassword(password, room.password.salt);
  return crypto.timingSafeEqual(hash, room.password.hash);
}

/** null se pode tentar, ou os segundos que faltam para liberar. */
function lockoutRemaining(room: Room): number | null {
  if (!room.lockedUntil) return null;
  const left = room.lockedUntil - Date.now();
  if (left <= 0) {
    room.lockedUntil = 0;
    room.attempts = [];
    return null;
  }
  return Math.ceil(left / 1000);
}

export type PasswordVerdict =
  | { ok: true }
  | { ok: false; reason: 'password' }
  | { ok: false; reason: 'locked'; seconds: number };

export function checkPassword(room: Room, password: string | undefined): PasswordVerdict {
  const locked = lockoutRemaining(room);
  if (locked !== null) return { ok: false, reason: 'locked', seconds: locked };

  if (passwordMatches(room, password ?? '')) {
    room.attempts = [];
    return { ok: true };
  }

  const now = Date.now();
  room.attempts = room.attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  room.attempts.push(now);

  if (room.attempts.length >= MAX_ATTEMPTS) {
    room.lockedUntil = now + LOCKOUT_MS;
    return { ok: false, reason: 'locked', seconds: Math.ceil(LOCKOUT_MS / 1000) };
  }
  return { ok: false, reason: 'password' };
}

/** Só o dono mexe na senha. Passar vazio remove. @returns erro, ou null. */
export function setPassword(room: Room, uid: string, password: string | null): string | null {
  if (room.ownerId !== uid) return 'Só quem criou a sala pode mudar a senha.';

  room.password = password ? hashPassword(String(password)) : null;
  room.attempts = [];
  room.lockedUntil = 0;
  broadcastState(room);
  return null;
}

// ------------------------------------------------------------------ registro

function blankRoom(id: string, instance: string, name: string): Room {
  return {
    id,
    instance,
    name,
    isCall: false,
    ownerId: null,
    ownerName: '',
    password: null,
    attempts: [],
    lockedUntil: 0,
    createdAt: Date.now(),
    emptySince: Date.now(),
    broadcasters: new Map(),
    slots: new Map(),
    viewers: new Map(),
    droppedChunks: 0,
  };
}

export function createRoom(input: {
  instance: string;
  name?: string | undefined;
  ownerId: string;
  ownerName: string;
  password?: string | null;
}): { room: Room } | { error: string } {
  const open = [...rooms.values()].filter((r) => r.instance === input.instance).length;
  if (open >= MAX_ROOMS_PER_INSTANCE) {
    return { error: 'Limite de salas abertas atingido. Feche uma antes de criar outra.' };
  }

  const chosen = String(input.name ?? '').replace(/\s+/g, ' ').trim();
  // Nome é opcional: sem ele, um baseado em quem criou.
  const name = (chosen || `Sala de ${input.ownerName}`).slice(0, MAX_ROOM_NAME);

  const room = blankRoom(crypto.randomBytes(6).toString('base64url'), input.instance, name);
  room.ownerId = input.ownerId;
  room.ownerName = input.ownerName;
  room.password = input.password ? hashPassword(String(input.password)) : null;

  rooms.set(room.id, room);
  return { room };
}

export const getRoom = (id: unknown): Room | null =>
  typeof id === 'string' ? (rooms.get(id) ?? null) : null;

/**
 * A sala fixa de uma call: id derivado do canal, criada na primeira entrada.
 *
 * Não tem dono nem senha — quem controla o acesso é a própria call, já que só
 * entra quem o Discord confirmou estar conectado ao canal.
 */
export function ensureCallRoom(instance: string, id: string, name?: string | null): Room {
  const existing = rooms.get(id);
  if (existing) {
    // A instância da Activity muda a cada relançamento no mesmo canal; o canal
    // é que é estável. Sem atualizar, a sala sumiria da lista após um relaunch.
    existing.instance = instance;
    // O canal pode ter sido renomeado no Discord desde que a sala nasceu.
    if (name) existing.name = name;
    return existing;
  }

  const room = blankRoom(id, instance, name || 'Sala da call');
  room.isCall = true;
  room.ownerName = 'a call';

  rooms.set(id, room);
  return room;
}

/**
 * Lista pública: nunca vaza hash de senha, só se ela existe.
 *
 * A sala automática da call fica de fora: dentro do Discord a atividade entra
 * nela direto, e no site ela nunca poderia ser aberta. Listá-la seria mostrar
 * uma porta que não abre.
 */
export function listRooms(instance: string) {
  return [...rooms.values()]
    .filter((r) => r.instance === instance && !r.isCall)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({
      id: r.id,
      name: r.name,
      owner: r.ownerName,
      isCall: r.isCall,
      locked: Boolean(r.password),
      people: countPeople(r),
      streams: [...r.broadcasters.values()].filter((b) => b.streaming).length,
    }));
}

function countPeople(room: Room): number {
  const ids = new Set<string>();
  for (const v of room.viewers.values()) ids.add(v.info.id);
  for (const uid of room.broadcasters.keys()) ids.add(uid);
  return ids.size;
}

/**
 * Fecha salas vazias há tempo demais.
 *
 * `unref` para o varredor não segurar o processo de pé sozinho: sem ele um
 * Ctrl+C fica esperando o próximo tique.
 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const empty = room.viewers.size === 0 && room.broadcasters.size === 0;

    if (!empty) {
      room.emptySince = null;
      continue;
    }
    if (room.emptySince === null) {
      room.emptySince = now;
      continue;
    }
    if (now - room.emptySince > EMPTY_GRACE_MS) {
      rooms.delete(room.id);
      console.log(`[room ${room.id}] fechada por inatividade`);
    }
  }
}, SWEEP_EVERY_MS);
sweeper.unref();

// ---------------------------------------------------------------------- envio

function send(ws: WebSocket, data: string | Buffer): boolean {
  if (ws.readyState !== ws.OPEN) return false;
  ws.send(data);
  return true;
}

export const sendJson = (ws: WebSocket, obj: unknown): boolean => send(ws, JSON.stringify(obj));

function toViewers(room: Room, obj: unknown): void {
  const msg = JSON.stringify(obj);
  for (const v of room.viewers.values()) send(v.ws, msg);
}

// --------------------------------------------------------------------- estado

// O avatar vai junto do nome: a lista de quem assiste mostra as fotos, e sem
// isto sobrava só a inicial colorida para quem tem foto no Discord.
/**
 * Avisa o espectador de que estamos descartando quadros dele (RF-AST-18).
 *
 * Antes disto o descarte só incrementava um contador no log, e o indicador de
 * qualidade não distinguia rede de quem assiste de rede de quem transmite.
 */
function warnDropped(viewer: Viewer, slot: number): void {
  const now = Date.now();
  if (now - (viewer.notifiedAt ?? 0) < DROP_NOTICE_MS) return;
  viewer.notifiedAt = now;
  sendJson(viewer.ws, { type: 'dropped', slot });
}

function watchersOf(room: Room, slot: number): Person[] {
  const byId = new Map<string, Person>();
  for (const v of room.viewers.values()) {
    if (v.watching.has(slot)) byId.set(v.info.id, v.info);
  }
  return [...byId.values()];
}

function roomState(room: Room) {
  // Uma pessoa pode ter a sala aberta em mais de uma aba; agrupamos por id
  // para não aparecer duplicada na lista.
  const byId = new Map<string, Person>();
  for (const v of room.viewers.values()) byId.set(v.info.id, v.info);

  const participants = [...byId.values()].map((info) => ({
    ...info,
    broadcasting: room.broadcasters.has(info.id),
  }));

  // Quem transmite pode ter fechado a aba da Activity: continua na lista,
  // senão o vídeo fica sem dono visível.
  for (const [uid, b] of room.broadcasters) {
    if (byId.has(uid)) continue;
    participants.push({ ...b.info, broadcasting: true });
  }

  participants.sort((a, b) => Number(b.broadcasting) - Number(a.broadcasting));

  return {
    type: 'state',
    room: {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      locked: Boolean(room.password),
    },
    broadcasting: room.broadcasters.size > 0,
    viewers: room.viewers.size,
    participants,
    streams: [...room.broadcasters.values()]
      .filter((b) => b.streaming)
      .map((b) => ({ slot: b.slot, userId: b.info.id, watchers: watchersOf(room, b.slot) })),
  };
}

export function broadcastState(room: Room): void {
  const msg = JSON.stringify(roomState(room));
  for (const v of room.viewers.values()) send(v.ws, msg);
  for (const b of room.broadcasters.values()) send(b.ws, msg);
}

export function rename(room: Room, ws: WebSocket, raw: unknown): void {
  const viewer = room.viewers.get(ws);
  if (!viewer || typeof raw !== 'string') return;

  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!name) return;

  viewer.info = { ...viewer.info, name };
  const broadcast = room.broadcasters.get(viewer.info.id);
  if (broadcast) broadcast.info = { ...broadcast.info, name };
  broadcastState(room);
}

// ---------------------------------------------------------------- transmissor

function freeSlot(room: Room): number | null {
  for (let i = 0; i < MAX_BROADCASTERS; i++) {
    if (!room.slots.has(i)) return i;
  }
  return null;
}

/** A transmissão criada, ou uma string com o motivo da recusa. */
export function attachBroadcaster(room: Room, ws: WebSocket, info: Person): Broadcast | string {
  if (room.broadcasters.has(info.id)) return 'Você já está transmitindo nesta sala.';
  if (room.broadcasters.size >= MAX_BROADCASTERS) {
    return `Limite de ${MAX_BROADCASTERS} transmissões simultâneas atingido.`;
  }

  const slot = freeSlot(room);
  if (slot === null) return 'Sem espaço para mais transmissões.';

  const broadcast: Broadcast = {
    ws,
    info,
    slot,
    streaming: false,
    config: null,
    audioConfig: null,
  };
  room.broadcasters.set(info.id, broadcast);
  room.slots.set(slot, broadcast);
  room.emptySince = null;

  sendJson(ws, { type: 'slot', slot });
  broadcastState(room);
  return broadcast;
}

export function startStream(room: Room, b: Broadcast): void {
  b.streaming = true;
  b.config = null;
  b.audioConfig = null;
  // Transmissão nova recomeça do zero: ninguém assiste até pedir.
  for (const v of room.viewers.values()) {
    v.primed.delete(b.slot);
    v.watching.delete(b.slot);
  }
  toViewers(room, { type: 'stream-start', slot: b.slot, userId: b.info.id });
  broadcastState(room);
}

/**
 * Config do áudio, guardada e repassada igual à do vídeo.
 *
 * Quem começa a assistir no meio precisa dela para montar o decodificador — e,
 * ao contrário do vídeo, aqui não existe keyframe para servir de ponto de
 * partida: sem a config, nenhum pacote de som é aproveitável.
 */
export function setAudioConfig(room: Room, b: Broadcast, config: CodecConfig): void {
  b.audioConfig = config;
  for (const v of room.viewers.values()) {
    if (v.watching.has(b.slot)) {
      sendJson(v.ws, { type: 'audio-config', slot: b.slot, config });
    }
  }
}

export function setConfig(room: Room, b: Broadcast, config: CodecConfig): void {
  b.config = config;
  // Config nova significa decodificador recriado; ele volta a precisar de
  // keyframe.
  for (const v of room.viewers.values()) {
    v.primed.delete(b.slot);
    if (v.watching.has(b.slot)) sendJson(v.ws, { type: 'config', slot: b.slot, config });
  }
}

export function relayChunk(room: Room, b: Broadcast, chunk: Buffer): void {
  // O transmissor carimba o próprio slot; conferimos para um cliente adulterado
  // não conseguir injetar quadros no stream de outra pessoa.
  if (chunk[SLOT_BYTE] !== b.slot) return;

  const type = chunk[TYPE_BYTE];
  const isKeyframe = type === TYPE_KEYFRAME;
  const isAudio = type === TYPE_AUDIO;

  for (const v of room.viewers.values()) {
    if (v.ws.readyState !== v.ws.OPEN) continue;

    // Assistir é opt-in: quem não pediu esta tela não recebe os bytes dela.
    if (!v.watching.has(b.slot)) continue;

    // Áudio não depende de keyframe — cada pacote Opus se decodifica sozinho —,
    // então não passa pelo controle de "já recebeu ponto de partida".
    if (isAudio) {
      if (v.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        room.droppedChunks++;
        warnDropped(v, b.slot);
        continue;
      }
      v.ws.send(chunk);
      continue;
    }

    if (isKeyframe) {
      // Teto dobrado: o keyframe é o que destrava a imagem, e descartá-lo
      // deixa a pessoa na tela preta até o próximo — que só vem quando alguém
      // pedir de novo.
      if (v.ws.bufferedAmount > MAX_BUFFERED_BYTES * 2) {
        room.droppedChunks++;
        warnDropped(v, b.slot);
        continue;
      }
      v.ws.send(chunk);
      v.primed.add(b.slot);
      continue;
    }

    if (!v.primed.has(b.slot)) continue;

    if (v.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      room.droppedChunks++;
      // Faltava aqui (RF-AST-18 só cobria keyframe e áudio): descarte de delta
      // é o caso mais comum — é ele que trava a imagem no meio de uma
      // transmissão —, e sem avisar o indicador de qualidade nunca via o
      // problema, e o cliente não tinha como saber que precisava pedir um
      // keyframe novo para se recuperar.
      warnDropped(v, b.slot);
      continue;
    }
    v.ws.send(chunk);
  }
}

export function stopStream(room: Room, b: Broadcast): void {
  if (!b.streaming) return;
  b.streaming = false;
  b.config = null;
  b.audioConfig = null;
  for (const v of room.viewers.values()) {
    v.primed.delete(b.slot);
    v.watching.delete(b.slot);
  }
  toViewers(room, { type: 'stream-stop', slot: b.slot });
}

export function detachBroadcaster(room: Room, b: Broadcast): void {
  // Só remove se ainda for a transmissão registrada: uma reconexão rápida pode
  // ter posto outra no lugar, e apagá-la aqui derrubaria a que está no ar.
  if (room.broadcasters.get(b.info.id) !== b) return;

  stopStream(room, b);
  room.broadcasters.delete(b.info.id);
  room.slots.delete(b.slot);
  broadcastState(room);
}

export const broadcasterOf = (room: Room, uid: string): Broadcast | null =>
  room.broadcasters.get(uid) ?? null;

// ----------------------------------------------------------------- espectador

export function watch(room: Room, ws: WebSocket, slot: number): void {
  const viewer = room.viewers.get(ws);
  const b = room.slots.get(slot);
  if (!viewer || !b || !b.streaming) return;
  // Repetir o pedido não muda nada, mas custaria um anúncio de estado para a
  // sala inteira — um cliente em laço faria o servidor inundar todo mundo.
  if (viewer.watching.has(slot)) return;

  if (watchersOf(room, slot).length >= MAX_VIEWERS_PER_STREAM) {
    sendJson(ws, { type: 'error', message: 'Esta tela já está no limite de espectadores.' });
    return;
  }

  viewer.watching.add(slot);
  viewer.primed.delete(slot);

  if (b.config) sendJson(ws, { type: 'config', slot, config: b.config });
  if (b.audioConfig) sendJson(ws, { type: 'audio-config', slot, config: b.audioConfig });

  // Em vez de guardar um keyframe antigo, pedimos um novo: a tela aparece em
  // ~1 quadro, e o servidor não precisa segurar buffer de ninguém.
  sendJson(b.ws, { type: 'need-keyframe' });
  broadcastState(room);
}

/**
 * Pede um keyframe de novo para quem **já está assistindo** (RF-AST-18a).
 *
 * `watch()` só pede uma vez, na entrada — e não existia nada que pedisse de
 * novo se aquele pedido (ou o próprio keyframe) se perdesse no caminho. Sem
 * isso, quem caía nesse buraco ficava vendo "Conectando…" para sempre, e quem
 * já estava assistindo e sofria um descarte no meio da transmissão dependia só
 * do keyframe periódico do transmissor (a cada 3 s) para voltar a ver algo —
 * o cliente pede isto sempre que passa um tempo sem desenhar um quadro
 * enquanto descartes continuam chegando.
 *
 * Diferente de `watch()`: não mexe em `watching` nem reemite o estado da sala
 * — é só um "de novo, por favor" para quem já tinha pedido, então não custa
 * nada repetir sob demanda.
 */
export function rewatch(room: Room, ws: WebSocket, slot: number): void {
  const viewer = room.viewers.get(ws);
  const b = room.slots.get(slot);
  if (!viewer || !b || !b.streaming || !viewer.watching.has(slot)) return;

  if (b.config) sendJson(ws, { type: 'config', slot, config: b.config });
  if (b.audioConfig) sendJson(ws, { type: 'audio-config', slot, config: b.audioConfig });
  sendJson(b.ws, { type: 'need-keyframe' });
}

export function unwatch(room: Room, ws: WebSocket, slot: number): void {
  const viewer = room.viewers.get(ws);
  // Só avisa a sala se algo mudou de fato; ver a nota em watch().
  if (!viewer?.watching.delete(slot)) return;
  viewer.primed.delete(slot);
  broadcastState(room);
}

export function attachViewer(room: Room, ws: WebSocket, info: Person): void {
  const viewer: Viewer = { ws, info, watching: new Set(), primed: new Set() };
  room.viewers.set(ws, viewer);
  room.emptySince = null;

  sendJson(ws, roomState(room));

  // Anuncia o que está no ar, sem começar a mandar quadros: assistir é opt-in.
  for (const b of room.broadcasters.values()) {
    if (!b.streaming) continue;
    sendJson(ws, { type: 'stream-start', slot: b.slot, userId: b.info.id });
  }

  broadcastState(room);
}

export function detachViewer(room: Room, ws: WebSocket): void {
  if (!room.viewers.delete(ws)) return;
  broadcastState(room);
}

/**
 * Fecha a sala agora, se ela ficou vazia (RN-SAL-20a).
 *
 * A carência de 12 s existe para a **queda**: recarregar a atividade desconecta
 * e reconecta, e sem ela quem estivesse sozinho perderia a sala a cada F5. Sair
 * de propósito é outra coisa — ali não há reconexão a esperar, e deixar a sala
 * de pé por mais 12 segundos só faz ela aparecer vazia na lista de quem está
 * olhando o lobby naquele instante.
 *
 * Só quem sai é que chama isto. A queda continua passando pelo varredor.
 */
export function closeIfEmpty(room: Room): void {
  if (room.viewers.size > 0 || room.broadcasters.size > 0) return;
  rooms.delete(room.id);
  console.log(`[room ${room.id}] fechada por quem saiu`);
}

export const stats = () =>
  [...rooms.values()].map((r) => ({
    id: r.id,
    name: r.name,
    locked: Boolean(r.password),
    broadcasting: r.broadcasters.size,
    viewers: r.viewers.size,
    droppedChunks: r.droppedChunks,
  }));
