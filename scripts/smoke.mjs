#!/usr/bin/env node
/**
 * Smoke do servidor: API de salas + relay, sem navegador.
 *
 * Bate na porta de entrada, e não na do relay: um /ws que funciona direto e
 * falha pelo roteador é exatamente o tipo de quebra que este teste existe para
 * pegar. Cobre o que mais dói neste desenho — senha, "assistir é opt-in", a
 * máquina de estados do keyframe, e o isolamento entre salas.
 *
 *   npm run dev        # numa janela
 *   node scripts/smoke.mjs   # noutra
 */
import WebSocket from 'ws';

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS  ' : 'FALHOU'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Abre um socket já pronto, guardando tudo que chegar. */
function open(url) {
  const ws = new WebSocket(url);
  ws.json = [];
  ws.binary = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) ws.binary.push(Buffer.from(data));
    else ws.json.push(JSON.parse(data.toString()));
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** [1B slot][1B tipo][8B tempo][8B relógio][payload] — ver specs/09. */
function frame(slot, type, payload = 'x') {
  const head = Buffer.alloc(18);
  head[0] = slot;
  head[1] = type;
  return Buffer.concat([head, Buffer.from(payload)]);
}

const TYPE_KEYFRAME = 1;
const TYPE_DELTA = 2;

// --------------------------------------------------------------------- setup

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`Nada respondendo em ${BASE}. Suba com "npm run dev" antes.`);
  process.exit(1);
}

const me = await post('/api/session-dev', { instance_id: 'smoke', name: 'Ana' });
check('sessão de dev emite identidade', Boolean(me.data?.identity));
const identity = me.data.identity;

const other = await post('/api/session-dev', { instance_id: 'outra', name: 'Bia' });
const otherIdentity = other.data.identity;

// ---------------------------------------------------------------------- salas

const locked = await post('/api/rooms/create', { identity, name: 'Trancada', password: 'senha' });
check('criar sala devolve tokens', Boolean(locked.data?.viewerToken && locked.data?.shareUrl));
check('shareUrl aponta para /share', String(locked.data?.shareUrl).includes('/share?t='));

const wrong = await post('/api/rooms/join', {
  identity,
  roomId: locked.data.roomId,
  password: 'errada',
});
check('senha errada é recusada', wrong.status === 403, `status ${wrong.status}`);

const right = await post('/api/rooms/join', {
  identity,
  roomId: locked.data.roomId,
  password: 'senha',
});
check('senha certa devolve tokens', right.status === 200 && Boolean(right.data?.viewerToken));

const listed = await post('/api/rooms/list', { identity });
check('a sala aparece no lobby da própria instância', listed.data.rooms.length >= 1);
const otherList = await post('/api/rooms/list', { identity: otherIdentity });
check(
  'outra instância não enxerga a sala',
  !otherList.data.rooms.some((r) => r.id === locked.data.roomId)
);

const ghost = await post('/api/rooms/join', { identity, roomId: 'nao-existe' });
check('sala inexistente devolve 404', ghost.status === 404);

// --------------------------------------------------------------------- relay

const room = await post('/api/rooms/create', { identity, name: 'Aberta' });
const shareToken = new URL(room.data.shareUrl).searchParams.get('t');

const rejected = await open(`${WS_BASE}/ws?t=${encodeURIComponent(identity)}`).catch(() => null);
check('token de identidade não abre WebSocket', rejected === null);

const caster = await open(`${WS_BASE}/ws?t=${encodeURIComponent(shareToken)}`);
const viewer = await open(`${WS_BASE}/ws?t=${encodeURIComponent(room.data.viewerToken)}`);
await sleep(150);

check('transmissor recebe um slot', caster.json.some((m) => m.type === 'slot' && m.slot === 0));
check('espectador recebe o estado da sala', viewer.json.some((m) => m.type === 'state'));

caster.send(JSON.stringify({ type: 'start' }));
caster.send(JSON.stringify({ type: 'config', config: { codec: 'vp8' } }));
await sleep(150);
check('espectador é avisado da transmissão', viewer.json.some((m) => m.type === 'stream-start'));

// Assistir é opt-in: sem pedir, nada de binário chega.
caster.send(frame(0, TYPE_KEYFRAME));
await sleep(150);
check('sem pedir para assistir, nada é enviado', viewer.binary.length === 0);

viewer.send(JSON.stringify({ type: 'watch', slot: 0 }));
await sleep(150);
check('watch entrega o config guardado', viewer.json.some((m) => m.type === 'config'));
check('watch pede um keyframe novo', caster.json.some((m) => m.type === 'need-keyframe'));

// Delta em decodificador frio é erro: o servidor barra até o keyframe chegar.
caster.send(frame(0, TYPE_DELTA));
await sleep(150);
check('delta antes do keyframe é barrado', viewer.binary.length === 0);

caster.send(frame(0, TYPE_KEYFRAME));
await sleep(150);
check('keyframe destrava o espectador', viewer.binary.length === 1);

caster.send(frame(0, TYPE_DELTA));
await sleep(150);
check('delta passa depois do keyframe', viewer.binary.length === 2);

// Quadro carimbado com slot alheio não entra no stream de ninguém.
caster.send(frame(3, TYPE_KEYFRAME));
await sleep(150);
check('quadro com slot de outro é descartado', viewer.binary.length === 2);

viewer.send(JSON.stringify({ type: 'unwatch', slot: 0 }));
await sleep(150);
caster.send(frame(0, TYPE_KEYFRAME));
await sleep(150);
check('unwatch corta o envio', viewer.binary.length === 2);

caster.close();
viewer.close();
await sleep(100);

console.log(failures ? `\n${failures} falha(s)\n` : '\nTudo passou\n');
process.exit(failures ? 1 : 0);
