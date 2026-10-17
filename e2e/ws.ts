import WebSocket from 'ws';

/** Helpers de protocolo, sem navegador: sessão, sala, sockets que guardam tudo que chega. */
export const BASE = 'http://localhost:3000';
export const WS = 'ws://localhost:3000';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(25);
  return cond();
}

export const post = (path: string, body?: unknown, init: RequestInit = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...init,
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => null)) as any }));

export interface Sock extends WebSocket {
  json: any[];
  binary: Buffer[];
  closed: boolean;
}

export function open(url: string): Promise<Sock> {
  const ws = new WebSocket(url) as Sock;
  ws.json = [];
  ws.binary = [];
  ws.closed = false;
  ws.on('message', (d, bin) => (bin ? ws.binary.push(Buffer.from(d as Buffer)) : ws.json.push(JSON.parse(d.toString()))));
  ws.on('close', () => (ws.closed = true));
  ws.on('error', () => {});
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function frame(slot: number, type: number, payload: Buffer | string = 'x') {
  const head = Buffer.alloc(18);
  head[0] = slot;
  head[1] = type;
  return Buffer.concat([head, Buffer.from(payload)]);
}

export const wsUrl = (token: string, kind?: string) =>
  `${WS}/ws?t=${encodeURIComponent(token)}${kind ? `&kind=${kind}` : ''}`;

const created: string[] = [];

export async function guest(name = 'Fuzz') {
  const g = await post('/api/session-guest', { name });
  return g.data.identity as string;
}

export async function makeRoom(name = 'fuzz', opts: { password?: string; identity?: string } = {}) {
  const identity = opts.identity ?? (await guest());
  const r = await post('/api/rooms/create', { identity, name, ...(opts.password ? { password: opts.password } : {}) });
  if (!r.data?.shareUrl) throw new Error(`criar sala falhou: ${r.status} ${JSON.stringify(r.data)}`);
  created.push(r.data.viewerToken);
  return {
    identity,
    roomId: r.data.roomId as string,
    share: new URL(r.data.shareUrl).searchParams.get('t')!,
    view: r.data.viewerToken as string,
  };
}

/** Fecha as salas criadas: o teto é de 20 abertas por instância. */
export async function dispose() {
  for (const view of created.splice(0)) {
    const ws = await open(wsUrl(view)).catch(() => null);
    ws?.send(JSON.stringify({ type: 'leave' }));
    ws?.close();
  }
  await sleep(50);
}

export const healthy = async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok === true;
