/**
 * O relay: a única parte deste projeto que não poderia morar no `app/`.
 *
 * Um WebSocket binário de longa duração precisa do evento `upgrade` do
 * servidor HTTP, que Route Handler nenhum expõe, e o estado das salas vive em
 * memória — o que exige que este processo seja um só e não morra entre
 * pedidos. É por isso que o servidor existe separado (`RN-PRO-2` em .claude/specs/03).
 */
import type { Server } from 'node:http';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { verify } from './tokens.ts';
import * as rooms from './rooms.ts';
import type { Broadcast, CodecConfig, Claims, Person, Room } from './types.ts';

// maxPayload: o relay repassa o buffer intacto para todos os espectadores, então
// um quadro gigante de um transmissor adulterado sairia multiplicado por N. Um
// keyframe 1080p a 5 Mbps não passa de algumas centenas de KB.
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

/** O `ws` não expõe onde guardar o "está vivo?" do heartbeat. */
const alive = new WeakSet<WebSocket>();

export function mountRelay(server: Server): WebSocketServer {
  server.on('upgrade', (req, socket, head) => {
    // O proxy do Discord entrega o caminho com o prefixo /.proxy/.
    const url = new URL(req.url ?? '/', 'http://internal');
    const path = url.pathname.replace(/^\/\.proxy/, '');

    if (path !== '/ws') {
      socket.destroy();
      return;
    }

    const claims = verify(url.searchParams.get('t'));
    // scope 'identity' não dá acesso a sala nenhuma: só os tokens de sala servem.
    if (!claims?.room) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Vem na URL, e não em `start` (RF-CAM-3): a checagem de duplicata e o
    // slot têm que acontecer na conexão, antes de qualquer mensagem chegar.
    const kind = url.searchParams.get('kind') === 'camera' ? 'camera' : 'screen';

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, claims, kind));
  });

  return wss;
}

wss.on('connection', (ws: WebSocket, _req: unknown, claims: Claims, kind: 'screen' | 'camera') => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  const room = claims.room ? rooms.getRoom(claims.room) : null;

  // A sala pode ter fechado entre a emissão do token e a conexão.
  if (!room) {
    rooms.sendJson(ws, { type: 'room-gone' });
    ws.close();
    return;
  }

  const info: Person = { id: claims.uid, name: claims.name, avatar: claims.av ?? null };

  if (claims.role === 'broadcaster') {
    handleBroadcaster(ws, room, info, kind);
  } else {
    handleViewer(ws, room, info);
  }
});

function handleBroadcaster(ws: WebSocket, room: Room, info: Person, kind: 'screen' | 'camera'): void {
  const attached = rooms.attachBroadcaster(room, ws, info, kind);

  if (typeof attached === 'string') {
    rooms.sendJson(ws, { type: 'error', message: attached });
    ws.close();
    return;
  }

  const broadcast: Broadcast = attached;
  console.log(`[room ${room.id}] broadcaster conectado: ${info.name} (slot ${broadcast.slot})`);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      rooms.relayChunk(room, broadcast, toBuffer(data));
      return;
    }

    const msg = asJson(data);
    if (!msg) return;

    switch (msg.type) {
      case 'start':
        rooms.startStream(room, broadcast);
        console.log(`[room ${room.id}] stream (${kind}) iniciada por ${info.name}`);
        break;
      case 'config':
        if (msg.config) {
          rooms.setConfig(room, broadcast, msg.config);
          console.log(`[room ${room.id}] codec de ${info.name}: ${String(msg.config.codec)}`);
        }
        break;
      case 'audio-config':
        if (msg.config) {
          rooms.setAudioConfig(room, broadcast, msg.config);
          console.log(`[room ${room.id}] audio de ${info.name}: ${String(msg.config.codec)}`);
        }
        break;
      case 'stop':
        rooms.stopStream(room, broadcast);
        console.log(`[room ${room.id}] stream parada por ${info.name}`);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    rooms.detachBroadcaster(room, broadcast);
    console.log(`[room ${room.id}] broadcaster saiu: ${info.name}`);
  });
}

function handleViewer(ws: WebSocket, room: Room, info: Person): void {
  rooms.attachViewer(room, ws, info);

  /** Clicou em sair, e não simplesmente perdeu a conexão. */
  let leftOnPurpose = false;

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return;

    const msg = asJson(data);
    if (!msg) return;

    // Nome exibido escolhido pela pessoa. Nada é persistido: vale enquanto a
    // conexão durar, e some quando ela reabre a atividade.
    if (msg.type === 'rename') {
      rooms.rename(room, ws, msg.name);
      return;
    }

    if (msg.type === 'watch' && Number.isInteger(msg.slot)) {
      rooms.watch(room, ws, msg.slot as number);
      return;
    }

    if (msg.type === 'unwatch' && Number.isInteger(msg.slot)) {
      rooms.unwatch(room, ws, msg.slot as number);
      return;
    }

    // O cliente pediu de novo porque travou — sem keyframe novo ou sem
    // desenhar há um tempo (RF-AST-18a). Diferente de 'watch', não exige que
    // ainda não esteja assistindo: é assim que ele se recupera.
    if (msg.type === 'rewatch' && Number.isInteger(msg.slot)) {
      rooms.rewatch(room, ws, msg.slot as number);
      return;
    }

    // Saiu de propósito. Marca a intenção antes de o socket fechar: é ela que
    // separa "clicou em sair" de "a conexão caiu", e as duas pedem tratamentos
    // opostos na hora de fechar a sala (RN-SAL-20a).
    if (msg.type === 'leave') {
      leftOnPurpose = true;
      return;
    }

    // Encerrar a própria transmissão de dentro da Activity, sem ter que achar
    // a aba de captura. Cada um só encerra a sua — e agora precisa dizer
    // qual: tela e câmera são duas transmissões independentes (RF-CAM-3).
    if (msg.type === 'stop-broadcast') {
      const kind = msg.kind === 'camera' ? 'camera' : 'screen';
      const mine = rooms.broadcasterOf(room, info.id, kind);
      if (mine) {
        rooms.sendJson(mine.ws, { type: 'stop-request' });
        console.log(`[room ${room.id}] parada de ${kind} pedida por ${info.name}`);
      }
    }
  });

  ws.on('close', () => {
    rooms.detachViewer(room, ws);
    // Última pessoa saindo por vontade própria: a sala vai embora agora. Quem
    // caiu continua com a carência do varredor, que existe para o F5.
    if (leftOnPurpose) rooms.closeIfEmpty(room);
  });
  ws.on('error', () => rooms.detachViewer(room, ws));
}

interface ControlMessage {
  type?: string;
  slot?: unknown;
  name?: unknown;
  config?: CodecConfig;
  /** Tela ou câmera, em `stop-broadcast` (RF-CAM-3). Qualquer coisa != 'camera' vira 'screen'. */
  kind?: unknown;
}

function asJson(data: RawData): ControlMessage | null {
  try {
    // Pelo Buffer, e não pelo toString() do RawData: quando o quadro chega
    // fragmentado o `ws` entrega um array de Buffers, e o toString() dele
    // junta os pedaços com vírgula — JSON quebrado por um motivo invisível.
    const parsed: unknown = JSON.parse(toBuffer(data).toString('utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * O `ws` entrega binário como Buffer, array de Buffers ou ArrayBuffer,
 * dependendo de como o quadro chegou fragmentado. O relay precisa de um
 * Buffer contíguo para ler os dois primeiros bytes do cabeçalho.
 */
function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

// Derruba sockets mortos — sem isso o contador de viewers fica mentindo.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

wss.on('close', () => clearInterval(heartbeat));
