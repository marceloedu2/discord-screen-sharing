import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { post, open, makeRoom, guest, wsUrl, frame, sleep, until, dispose, healthy, BASE } from './ws';
import { test as uiTest, expect as uiExpect, createRoom, joinRoom, shareScreen, invite, videoCount, isPlaying } from './fixtures';

test.describe('servidor sob carga', () => {
  test.afterEach(async () => {
    await dispose();
    expect(await healthy()).toBe(true);
  });

  test('espectador lento não atrasa nem prejudica os outros, e se recupera com rewatch', async () => {
    const r = await makeRoom();
    const caster = await open(wsUrl(r.share));
    const lento = await open(wsUrl(r.view));
    const rapido = await open(wsUrl(r.view));
    caster.send(JSON.stringify({ type: 'start' }));
    caster.send(JSON.stringify({ type: 'config', config: { codec: 'vp8' } }));
    await sleep(150);
    lento.send(JSON.stringify({ type: 'watch', slot: 0 }));
    rapido.send(JSON.stringify({ type: 'watch', slot: 0 }));
    await sleep(200);

    // O lento para de ler: o buffer do servidor para ele só enche.
    (lento as any)._socket.pause();

    const N = 120;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      caster.send(frame(0, i % 10 === 0 ? 1 : 2, Buffer.alloc(250 * 1024, i)));
      if (i % 20 === 0) await sleep(30);
    }
    const recebidos = await until(() => rapido.binary.length >= N * 0.9, 15_000);
    expect(recebidos, `o rápido recebeu só ${rapido.binary.length}/${N}`).toBe(true);

    // O servidor continua respondendo depressa mesmo com um socket entupido.
    const h0 = Date.now();
    expect(await healthy()).toBe(true);
    expect(Date.now() - h0, 'saúde demorou').toBeLessThan(1500);
    expect(Date.now() - t0).toBeLessThan(20_000);

    // O lento volta a ler e é avisado do descarte (RF-AST-18).
    (lento as any)._socket.resume();
    expect(await until(() => lento.json.some((m) => m.type === 'dropped'), 8000), 'sem aviso de descarte').toBe(true);

    // E consegue pedir keyframe de novo sem refazer o watch.
    const antes = caster.json.filter((m) => m.type === 'need-keyframe').length;
    lento.send(JSON.stringify({ type: 'rewatch', slot: 0 }));
    expect(await until(() => caster.json.filter((m) => m.type === 'need-keyframe').length > antes)).toBe(true);
    [caster, lento, rapido].forEach((s) => s.close());
  });

  test('teto de espectadores por transmissão: o 13º é recusado com mensagem clara', async () => {
    const r = await makeRoom();
    const caster = await open(wsUrl(r.share));
    caster.send(JSON.stringify({ type: 'start' }));
    await sleep(150);
    const viewers = [];
    for (let i = 0; i < 13; i++) {
      // Cada espectador é uma pessoa diferente: o teto conta pessoas, não sockets.
      const id = await guest(`V${i}`);
      const j = await post('/api/rooms/join', { identity: id, roomId: r.roomId });
      const v = await open(wsUrl(j.data.viewerToken));
      v.send(JSON.stringify({ type: 'watch', slot: 0 }));
      viewers.push(v);
      await sleep(40);
    }
    await sleep(300);
    const recusados = viewers.filter((v) => v.json.some((m) => m.type === 'error' && /limite/i.test(m.message)));
    expect(recusados.length).toBe(1);
    expect(viewers[12]!.json.some((m) => m.type === 'error')).toBe(true);
    [caster, ...viewers].forEach((s) => s.close());
  });

  test('a mesma pessoa em várias abas conta uma vez no teto', async () => {
    const r = await makeRoom();
    const caster = await open(wsUrl(r.share));
    caster.send(JSON.stringify({ type: 'start' }));
    await sleep(150);
    const abas = await Promise.all(Array.from({ length: 15 }, () => open(wsUrl(r.view))));
    abas.forEach((a) => a.send(JSON.stringify({ type: 'watch', slot: 0 })));
    await sleep(500);
    expect(abas.some((a) => a.json.some((m) => m.type === 'error'))).toBe(false);
    const estado = [...caster.json].reverse().find((m) => m.type === 'state');
    expect(estado.streams[0].watchers.length).toBe(1);
    [caster, ...abas].forEach((s) => s.close());
  });

  test('teto de 20 salas: a 21ª é recusada com mensagem, e liberar uma abre vaga', async () => {
    const identidade = await guest('Criador');
    const abertas: Awaited<ReturnType<typeof makeRoom>>[] = [];
    let recusa: { status: number; data: any } | null = null;
    for (let i = 0; i < 25 && !recusa; i++) {
      const r = await post('/api/rooms/create', { identity: identidade, name: `teto-${i}` });
      if (r.data?.shareUrl) abertas.push({ roomId: r.data.roomId, view: r.data.viewerToken } as any);
      else recusa = r;
    }
    expect(recusa, 'nunca recusou').not.toBeNull();
    expect(recusa!.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(recusa!.data)).toMatch(/Limite de salas/);

    // Sair de propósito dissolve a sala e libera a vaga.
    const v = await open(wsUrl(abertas[0]!.view));
    v.send(JSON.stringify({ type: 'leave' }));
    v.close();
    await sleep(300);
    const nova = await post('/api/rooms/create', { identity: identidade, name: 'depois-do-teto' });
    expect(nova.data?.shareUrl).toBeTruthy();
    for (const a of [...abertas.slice(1), { view: nova.data.viewerToken }]) {
      const s = await open(wsUrl((a as any).view)).catch(() => null);
      s?.send(JSON.stringify({ type: 'leave' }));
      s?.close();
    }
    await sleep(200);
  });

  test('queda sem "sair": a sala sobrevive à carência (F5) e some depois', async () => {
    test.setTimeout(60_000);
    const r = await makeRoom('carencia');
    const quem = await guest('Obs');
    const v = await open(wsUrl(r.view));
    v.terminate(); // caiu, não clicou em sair
    const existe = async () =>
      (await post('/api/rooms/list', { identity: quem })).data.rooms.some((x: any) => x.id === r.roomId);
    await sleep(1000);
    expect(await existe(), 'sumiu cedo demais, o F5 perderia a sala').toBe(true);
    // 12 s de carência + varredura de 4 s.
    expect(await until(() => false, 1)).toBe(false);
    const fim = Date.now() + 25_000;
    let some = false;
    while (Date.now() < fim && !some) {
      await sleep(1000);
      some = !(await existe());
    }
    expect(some, 'sala vazia nunca foi fechada').toBe(true);
  });

  test('reconectar dentro da carência encontra a mesma sala', async () => {
    const r = await makeRoom('f5');
    const v1 = await open(wsUrl(r.view));
    v1.terminate();
    await sleep(1500);
    const v2 = await open(wsUrl(r.view));
    await sleep(300);
    expect(v2.json.some((m) => m.type === 'room-gone')).toBe(false);
    expect(v2.json.find((m) => m.type === 'state').room.name).toBe('f5');
    v2.close();
  });
});

uiTest.describe('reinício do servidor com gente na sala', () => {
  uiTest('todos acabam no lobby com aviso, sem laço de reconexão nem erro de página', async ({ spawn }) => {
    uiTest.setTimeout(120_000);
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    for (const u of [ana, bia]) u.allow(/WebSocket connection|ERR_CONNECTION|Failed to load resource|Failed to fetch|502|503/);

    const sala = `reinicio-${Date.now()}`;
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    await uiExpect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);

    // `node --watch` reinicia o relay quando o arquivo muda: as salas vivem em memória e somem.
    execSync('touch server/src/index.ts', { cwd: process.cwd() });

    for (const u of [ana, bia]) {
      await uiExpect(u.page.getByRole('heading', { name: 'Salas' })).toBeVisible({ timeout: 60_000 });
    }
    // Servidor de volta e saudável, e dá para criar sala de novo.
    await uiExpect.poll(healthy, { timeout: 30_000 }).toBe(true);
    const nova = `depois-${Date.now()}`;
    await createRoom(ana, nova);
    await joinRoom(bia, nova);
    await shareScreen(ana);
    await invite(bia).click();
    await uiExpect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
  });
});
