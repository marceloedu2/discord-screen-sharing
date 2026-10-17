import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

/**
 * Fuzz do relay, sem navegador. Cada caso agride o servidor de um jeito e
 * termina provando duas coisas: ele continua de pé (/api/health) e um par
 * transmissor→espectador legítimo continua funcionando. Um relay que sobrevive
 * mas deixa de servir a sala ao lado não sobreviveu.
 */
const BASE = 'http://localhost:3000';
const WS = 'ws://localhost:3000';

const post = (path: string, body?: unknown) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => null)) as any }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera uma condição com prazo, em vez de apostar num sleep fixo. */
async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(25);
  return cond();
}

interface Sock extends WebSocket {
  json: any[];
  binary: Buffer[];
  closed: boolean;
  closeCode?: number;
  errors: Error[];
}

function open(url: string): Promise<Sock> {
  const ws = new WebSocket(url) as Sock;
  ws.json = [];
  ws.binary = [];
  ws.errors = [];
  ws.closed = false;
  ws.on('message', (d, bin) => (bin ? ws.binary.push(Buffer.from(d as Buffer)) : ws.json.push(JSON.parse(d.toString()))));
  ws.on('close', (code) => {
    ws.closed = true;
    ws.closeCode = code;
  });
  ws.on('error', (e) => ws.errors.push(e));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function frame(slot: number, type: number, payload: Buffer | string = 'x') {
  const head = Buffer.alloc(18);
  head[0] = slot;
  head[1] = type;
  return Buffer.concat([head, Buffer.from(payload)]);
}

/** Salas criadas pelo teste. O teto é de 20 abertas por instância (e todo convidado é a mesma): sem fechar, a suíte esbarra nele. */
const created: string[] = [];

async function dispose() {
  for (const view of created.splice(0)) {
    const ws = await open(`${WS}/ws?t=${encodeURIComponent(view)}`).catch(() => null);
    ws?.send(JSON.stringify({ type: 'leave' }));
    ws?.close();
  }
  await sleep(50);
}

async function makeRoom(name = 'fuzz') {
  const g = await post('/api/session-guest', { name: 'Fuzz' });
  const r = await post('/api/rooms/create', { identity: g.data.identity, name });
  const share = new URL(r.data.shareUrl).searchParams.get('t')!;
  created.push(r.data.viewerToken);
  return { identity: g.data.identity as string, roomId: r.data.roomId as string, share, view: r.data.viewerToken as string };
}

const health = async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok === true;

/** O par legítimo: transmissor sobe, espectador assiste, recebe o keyframe. */
async function canary() {
  const r = await makeRoom('canario');
  const caster = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
  const viewer = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
  caster.send(JSON.stringify({ type: 'start' }));
  caster.send(JSON.stringify({ type: 'config', config: { codec: 'vp8' } }));
  await sleep(150);
  viewer.send(JSON.stringify({ type: 'watch', slot: 0 }));
  await sleep(150);
  caster.send(frame(0, 1, 'canario'));
  await sleep(150);
  const ok = viewer.binary.some((b) => b.subarray(18).toString() === 'canario');
  caster.close();
  viewer.close();
  await sleep(100);
  await dispose();
  return ok;
}

test.describe('relay sob agressão', () => {
  test.afterEach(async () => {
    await sleep(200);
    await dispose();
    expect(await health(), 'servidor de pé').toBe(true);
    expect(await canary(), 'par legítimo ainda funciona').toBe(true);
  });

  test('lixo no lugar de JSON e tipos desconhecidos', async () => {
    const r = await makeRoom();
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    const c = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    for (const s of ['', '{', 'null', '[]', '"x"', '123', '{"type":null}', '{"type":{}}', '{"type":"watch"}', '\u0000\u0001']) {
      v.send(s);
      c.send(s);
    }
    v.send(Buffer.alloc(0));
    v.send(Buffer.from([1]));
    c.send(Buffer.alloc(0));
    c.send(Buffer.from([0]));
    await sleep(300);
    expect(v.closed || v.readyState === WebSocket.OPEN).toBe(true);
    v.close();
    c.close();
  });

  test('slot hostil em watch/unwatch/rewatch', async () => {
    const r = await makeRoom();
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    for (const slot of [-1, 0, 1.5, 255, 256, 2 ** 31, 2 ** 53, '0', null, [0], {}, NaN]) {
      for (const type of ['watch', 'unwatch', 'rewatch']) v.send(JSON.stringify({ type, slot }));
    }
    await sleep(300);
    expect(v.closed).toBe(false);
    v.close();
  });

  test('nome absurdo em rename', async () => {
    const r = await makeRoom();
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    const watcher = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    for (const name of ['', '   ', 'x'.repeat(100_000), '<img src=x onerror=alert(1)>', '‮\u0000', '😀'.repeat(500), 42, null, {}, ['a']]) {
      v.send(JSON.stringify({ type: 'rename', name }));
    }
    await sleep(300);
    const last = [...watcher.json].reverse().find((m) => m.type === 'state');
    const names: string[] = last.participants.map((p: any) => p.name);
    for (const n of names) expect(n.length, 'nome limitado').toBeLessThanOrEqual(64);
    v.close();
    watcher.close();
  });

  test('quadro com slot de outro transmissor não vaza', async () => {
    const r = await makeRoom();
    const g2 = await post('/api/session-guest', { name: 'Outro' });
    const room2 = await post('/api/rooms/join', { identity: g2.data.identity, roomId: r.roomId });
    // o 2º transmissor entra pelo mesmo shareUrl da sala? só o dono tem — usa o viewerToken como controle
    expect(room2.status).toBe(200);
    const c = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    c.send(JSON.stringify({ type: 'start' }));
    c.send(JSON.stringify({ type: 'config', config: { codec: 'vp8' } }));
    await sleep(150);
    v.send(JSON.stringify({ type: 'watch', slot: 0 }));
    await sleep(150);
    c.send(frame(7, 1, 'forjado')); // carimbo de slot que não é o meu
    c.send(frame(0, 1, 'legitimo'));
    await sleep(200);
    const got = v.binary.map((b) => b.subarray(18).toString());
    expect(got).not.toContain('forjado');
    expect(got).toContain('legitimo');
    c.close();
    v.close();
  });

  test('espectador não consegue injetar quadros', async () => {
    const r = await makeRoom();
    const c = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    const v2 = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    c.send(JSON.stringify({ type: 'start' }));
    await sleep(100);
    v2.send(JSON.stringify({ type: 'watch', slot: 0 }));
    await sleep(100);
    v.send(frame(0, 1, 'injetado'));
    await sleep(200);
    expect(v2.binary.length).toBe(0);
    c.close();
    v.close();
    v2.close();
  });

  test('quadro acima do limite NÃO derruba o servidor (transmissor)', async () => {
    const r = await makeRoom();
    const c = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    c.on('error', () => {});
    c.send(frame(0, 1, Buffer.alloc(5 * 1024 * 1024)));
    expect(await until(() => c.closed), 'conexão agressora é encerrada').toBe(true);
  });

  test('quadro acima do limite NÃO derruba o servidor (espectador)', async () => {
    const r = await makeRoom();
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    v.on('error', () => {});
    v.send(Buffer.alloc(5 * 1024 * 1024));
    expect(await until(() => v.closed), 'conexão agressora é encerrada').toBe(true);
  });

  test('tokens inválidos e kind estranho', async () => {
    const r = await makeRoom();
    for (const t of ['', 'x', r.identity, r.share.slice(0, -2), r.share + 'AA', 'a.b.c']) {
      const s = await open(`${WS}/ws?t=${encodeURIComponent(t)}`).catch(() => null);
      expect(s, `token ${t.slice(0, 12)}…`).toBeNull();
    }
    for (const kind of ['', 'x', 'CAMERA', '__proto__', 'camera&kind=screen']) {
      const s = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}&kind=${kind}`).catch(() => null);
      s?.close();
      await sleep(50);
    }
  });

  test('duplicata de modalidade é recusada, tela e câmera coexistem', async () => {
    const r = await makeRoom();
    const screen1 = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    const camera = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}&kind=camera`);
    const screen2 = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    const camera2 = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}&kind=camera`);
    await sleep(300);
    expect(screen1.closed).toBe(false);
    expect(camera.closed).toBe(false);
    expect(screen2.json.some((m) => m.type === 'error' && /tela/.test(m.message))).toBe(true);
    expect(camera2.json.some((m) => m.type === 'error' && /câmera/.test(m.message))).toBe(true);
    const slots = [screen1, camera].map((s) => s.json.find((m) => m.type === 'slot')?.slot);
    expect(new Set(slots).size).toBe(2);
    [screen1, camera, screen2, camera2].forEach((s) => s.close());
  });

  test('tempestade: 150 conexões abrindo e fechando', async () => {
    const r = await makeRoom();
    const socks = await Promise.all(
      Array.from({ length: 150 }, (_, i) =>
        open(`${WS}/ws?t=${encodeURIComponent(i % 3 === 0 ? r.share : r.view)}&kind=${i % 2 ? 'camera' : 'screen'}`).catch(() => null)
      )
    );
    await sleep(200);
    socks.forEach((s) => s?.terminate());
    await sleep(300);
  });

  test('inundação de watch/unwatch não infla o servidor', async () => {
    const r = await makeRoom();
    const c = await open(`${WS}/ws?t=${encodeURIComponent(r.share)}`);
    const v = await open(`${WS}/ws?t=${encodeURIComponent(r.view)}`);
    c.send(JSON.stringify({ type: 'start' }));
    await sleep(100);
    for (let i = 0; i < 3000; i++) v.send(JSON.stringify({ type: i % 2 ? 'unwatch' : 'watch', slot: 0 }));
    await sleep(500);
    const states = c.json.filter((m) => m.type === 'state').length;
    expect(states, 'estados emitidos').toBeLessThan(3500);
    c.close();
    v.close();
  });
});
