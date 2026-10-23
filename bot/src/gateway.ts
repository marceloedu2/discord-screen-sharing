/**
 * Conexão com o Gateway do Discord.
 *
 * Só o necessário para receber interações: o intent `Guilds` não exige
 * autorização no portal, e comando de barra chega por INTERACTION_CREATE sem
 * intent nenhum. Sem biblioteca de Discord, pelo mesmo motivo do `server/`:
 * um processo que fica horas de pé ganha pouco com uma dependência grande
 * para usar um décimo dela.
 */
import WebSocket from 'ws';

import { DISCORD_BOT_TOKEN } from './config.ts';
import { handleInteraction, type Interaction } from './interactions.ts';

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENT_GUILDS = 1 << 0;

const OP = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const;

// Códigos de fechamento em que reconectar só repetiria o erro: token errado,
// intent não permitido, versão inválida.
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

interface Payload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface Ready {
  session_id: string;
  resume_gateway_url: string;
}

export function connectGateway(): void {
  let socket: WebSocket | null = null;
  let seq: number | null = null;
  let sessionId: string | null = null;
  let resumeUrl: string | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let acked = true;

  const send = (op: number, d: unknown) => socket?.send(JSON.stringify({ op, d }));

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const open = () => {
    const url = sessionId && resumeUrl ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY;
    const ws = new WebSocket(url);
    socket = ws;
    acked = true;

    ws.on('message', (raw) => {
      // `RawData` pode chegar como Buffer, ArrayBuffer ou fragmentos; `String()`
      // só acerta o primeiro caso.
      const text = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw);
      const payload = JSON.parse(text.toString()) as Payload;
      if (payload.s !== null) seq = payload.s;

      switch (payload.op) {
        case OP.hello: {
          const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
          stopHeartbeat();
          // O primeiro batimento sai num ponto aleatório do intervalo, como o
          // Discord pede, para não concentrar todos os clientes no mesmo instante.
          setTimeout(() => {
            if (socket !== ws) return;
            send(OP.heartbeat, seq);
            heartbeat = setInterval(() => {
              // Sem ack do batimento anterior a conexão morreu em silêncio.
              if (!acked) return ws.terminate();
              acked = false;
              send(OP.heartbeat, seq);
            }, interval);
          }, interval * Math.random());

          if (sessionId) {
            send(OP.resume, { token: DISCORD_BOT_TOKEN, session_id: sessionId, seq });
          } else {
            send(OP.identify, {
              token: DISCORD_BOT_TOKEN,
              intents: INTENT_GUILDS,
              properties: { os: process.platform, browser: 'sala-de-tela', device: 'sala-de-tela' },
            });
          }
          break;
        }
        case OP.heartbeat:
          send(OP.heartbeat, seq);
          break;
        case OP.heartbeatAck:
          acked = true;
          break;
        case OP.reconnect:
          ws.close(4000);
          break;
        case OP.invalidSession:
          // `d` diz se dá para retomar; se não dá, recomeça do zero.
          if (payload.d !== true) sessionId = null;
          ws.close(4000);
          break;
        case OP.dispatch:
          if (payload.t === 'READY') {
            const ready = payload.d as Ready;
            sessionId = ready.session_id;
            resumeUrl = ready.resume_gateway_url;
            console.log('[gateway] conectado');
          } else if (payload.t === 'INTERACTION_CREATE') {
            handleInteraction(payload.d as Interaction).catch((err: unknown) => {
              console.error('[interação] erro:', err);
            });
          }
          break;
      }
    });

    ws.on('error', (err) => console.error('[gateway] erro:', err.message));

    ws.on('close', (code) => {
      stopHeartbeat();
      if (socket !== ws) return;
      if (FATAL_CLOSE.has(code)) {
        console.error(`[gateway] fechado com ${code}; verifique o token do bot. Encerrando.`);
        process.exit(1);
      }
      console.warn(`[gateway] fechado (${code}); reconectando…`);
      // Folga curta e com jitter: reconexão em laço apertado vira rate limit.
      setTimeout(open, 1000 + Math.random() * 4000);
    });
  };

  open();
}
