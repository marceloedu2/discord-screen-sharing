import { test, expect, type Page } from '@playwright/test';
import { post, open, makeRoom, guest, wsUrl, frame, sleep, until, dispose, healthy, BASE } from './ws';
import { test as uiTest, expect as uiExpect, createRoom, roomButton } from './fixtures';

/**
 * Fronteiras de confiança: o que um token, uma senha e um corpo de requisição
 * mal-intencionados conseguem — e o que não podem.
 */
test.describe('autenticação e autorização', () => {
  test.afterEach(async () => {
    await dispose();
    expect(await healthy()).toBe(true);
  });

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  test('token adulterado é recusado (papel, uid, sala, assinatura)', async () => {
    const r = await makeRoom();
    const [body, sig] = r.view.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = [
      `${b64({ ...claims, role: 'broadcaster' })}.${sig}`, // promoveu a si mesmo
      `${b64({ ...claims, uid: 'guest-outro' })}.${sig}`, // roubou outra identidade
      `${b64({ ...claims, room: 'outra-sala' })}.${sig}`,
      `${body}.${sig.split('').reverse().join('')}`,
      `${b64({ ...claims, exp: 1 })}.${sig}`,
      `${b64({ ...claims })}.`,
      `.${sig}`,
      `${body}.${sig}.extra`,
      b64({ ...claims, role: 'broadcaster' }), // sem assinatura nenhuma
    ];
    for (const t of forged) {
      const s = await open(wsUrl(t)).catch(() => null);
      expect(s, `aceitou ${t.slice(0, 24)}…`).toBeNull();
    }
  });

  test('token de espectador não vira transmissor, nem com kind=camera', async () => {
    const r = await makeRoom();
    const spy = await open(wsUrl(r.view));
    const fake = await open(wsUrl(r.view, 'camera'));
    fake.send(JSON.stringify({ type: 'start' }));
    fake.send(JSON.stringify({ type: 'config', config: { codec: 'vp8' } }));
    fake.send(frame(0, 1, 'x'));
    await sleep(300);
    expect(spy.json.some((m) => m.type === 'stream-start')).toBe(false);
    const last = [...spy.json].reverse().find((m) => m.type === 'state');
    expect(last.streams).toEqual([]);
    spy.close();
    fake.close();
  });

  test('stop-broadcast só atinge a transmissão de quem pediu', async () => {
    const dono = await makeRoom('dono');
    const outro = await guest('Outro');
    const entrou = await post('/api/rooms/join', { identity: outro, roomId: dono.roomId });
    expect(entrou.status).toBe(200);

    const caster = await open(wsUrl(dono.share));
    caster.send(JSON.stringify({ type: 'start' }));
    await sleep(150);
    const intruso = await open(wsUrl(entrou.data.viewerToken));
    intruso.send(JSON.stringify({ type: 'stop-broadcast', kind: 'screen' }));
    intruso.send(JSON.stringify({ type: 'stop-broadcast', kind: 'camera' }));
    await sleep(300);
    expect(caster.json.some((m) => m.type === 'stop-request'), 'derrubou a tela de outra pessoa').toBe(false);
    caster.close();
    intruso.close();
  });

  test('senha: sem senha e errada dão 403; só o dono troca; lista não vaza hash', async () => {
    const dono = await guest('Dono');
    const sala = await makeRoom('trancada', { password: 'segredo', identity: dono });
    const outro = await guest('Outro');

    expect((await post('/api/rooms/join', { identity: outro, roomId: sala.roomId })).status).toBe(403);
    expect((await post('/api/rooms/join', { identity: outro, roomId: sala.roomId, password: 'x' })).status).toBe(403);
    expect((await post('/api/rooms/join', { identity: outro, roomId: sala.roomId, password: { $ne: 1 } })).status).toBe(403);
    expect((await post('/api/rooms/join', { identity: outro, roomId: sala.roomId, password: ['segredo'] })).status).toBe(403);

    const troca = await post('/api/rooms/password', { identity: outro, roomId: sala.roomId, password: 'invadida' });
    expect(troca.status).toBeGreaterThanOrEqual(400);
    expect((await post('/api/rooms/join', { identity: outro, roomId: sala.roomId, password: 'segredo' })).status).toBe(200);

    const lista = await post('/api/rooms/list', { identity: outro });
    const texto = JSON.stringify(lista.data);
    expect(texto).not.toMatch(/salt|hash|scrypt|segredo/i);
    expect(lista.data.rooms.find((x: any) => x.id === sala.roomId).locked).toBe(true);
  });

  test('força bruta de senha trava a sala, e o travamento vale até para a senha certa', async () => {
    const sala = await makeRoom('forca', { password: 'certa' });
    const alvo = await guest('Alvo');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await post('/api/rooms/join', { identity: alvo, roomId: sala.roomId, password: `x${i}` })).status);
    }
    expect(statuses.slice(0, 4)).toEqual([403, 403, 403, 403]);
    expect(statuses.slice(4)).toEqual([429, 429, 429]);
    expect((await post('/api/rooms/join', { identity: alvo, roomId: sala.roomId, password: 'certa' })).status).toBe(429);
  });

  test('identidade não serve de token de sala, e o inverso também', async () => {
    const identity = await guest();
    const r = await makeRoom();
    expect((await post('/api/rooms/join', { identity: r.view, roomId: r.roomId })).status).toBeGreaterThanOrEqual(400);
    expect((await post('/api/rooms/create', { identity: r.share, name: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect(await open(wsUrl(identity)).catch(() => null)).toBeNull();
  });

  test('corpos hostis na API: enorme, não-JSON, tipos trocados — 4xx e servidor de pé', async () => {
    const enorme = await fetch(`${BASE}/api/rooms/create`, { method: 'POST', body: 'x'.repeat(200_000), headers: { 'Content-Type': 'application/json' } }).catch(() => null);
    if (enorme) expect(enorme.status).toBeGreaterThanOrEqual(400);

    for (const corpo of ['', '{', 'null', '[]', '"x"', '{"identity":{}}', '{"identity":42,"name":[]}', '{"__proto__":{"admin":true}}']) {
      const r = await fetch(`${BASE}/api/rooms/create`, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/json' } }).catch(() => null);
      if (r) expect(r.status, `corpo ${corpo}`).toBeLessThan(500);
    }
    for (const [metodo, rota] of [['GET', '/api/rooms/create'], ['DELETE', '/api/health'], ['PUT', '/api/rooms/list'], ['GET', '/api/nada'], ['GET', '/ws']] as const) {
      const r = await fetch(BASE + rota, { method: metodo }).catch(() => null);
      if (r) expect(r.status, `${metodo} ${rota}`).toBeLessThan(500);
    }
    const lixo = await post('/api/session-guest', { name: { x: 1 } });
    expect(lixo.status).toBeLessThan(500);
  });

  test('nomes enormes e de controle são limitados na criação', async () => {
    const identity = await guest('x'.repeat(500));
    const claims = JSON.parse(Buffer.from(identity.split('.')[0], 'base64url').toString());
    expect(claims.name.length).toBeLessThanOrEqual(32);
    const r = await post('/api/rooms/create', { identity, name: 'S'.repeat(1000) });
    const lista = await post('/api/rooms/list', { identity });
    const sala = lista.data.rooms.find((x: any) => x.id === r.data.roomId);
    expect(sala.name.length).toBeLessThanOrEqual(40);
    await post('/api/rooms/password', { identity, roomId: r.data.roomId });
  });

  test('avatar: id e hash fora do formato do Discord não viram proxy aberto', async () => {
    for (const caminho of [
      '/api/avatar/1/abc', '/api/avatar/../../etc/passwd/x', '/api/avatar/123456789012345678/..%2f..%2fsecret',
      '/api/avatar/123456789012345678/http:%2f%2f127.0.0.1', '/api/avatar/123456789012345678/' + 'a'.repeat(33),
      '/api/avatar/123456789012345678%00/' + 'a'.repeat(32), '/api/avatar/123456789012345678/a_' + 'g'.repeat(32),
    ]) {
      const r = await fetch(BASE + caminho);
      expect([400, 404], caminho).toContain(r.status);
    }
  });
});

// ------------------------------------------------------------- XSS na interface

uiTest.describe('conteúdo do usuário é texto, nunca HTML', () => {
  uiTest('nome de sala, apelido e parâmetros hostis aparecem literais e nada executa', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const dialogos: string[] = [];
    for (const u of [ana, bia]) u.page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });

    const veneno = `<img src=x onerror="alert('xss')">`;
    const sala = `${veneno}-${Date.now() % 1000}`.slice(0, 40);
    await createRoom(ana, sala);
    await ana.page.getByRole('button', { name: /Seu perfil/ }).click();
    await ana.page.getByLabel('Nome exibido').fill(`<script>alert(1)</script>`);
    await ana.page.getByRole('button', { name: 'Salvar' }).click();

    await bia.page.goto('/');
    await uiExpect(bia.page.getByText(sala.slice(0, 20), { exact: false }).first()).toBeVisible();
    await bia.page.getByText(sala.slice(0, 20), { exact: false }).first().click();
    await uiExpect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await uiExpect(bia.page.getByText('<script>alert(1)</script>').first()).toBeVisible();
    expect(await bia.page.locator('img[src="x"]').count()).toBe(0);
    expect(await bia.page.evaluate(() => [...document.querySelectorAll('script')].filter((x) => x.textContent?.includes('alert(1)') && !x.textContent.includes('self.__next')).length)).toBe(0);

    for (const url of [`/?room=${encodeURIComponent('"><script>alert(2)</script>')}`, `/?room=%00`, `/?room=${'a'.repeat(5000)}`, `/share?t=${encodeURIComponent(veneno)}`, `/%3Cscript%3E`]) {
      bia.allow(/./); // páginas de erro e 4xx esperados nessas URLs
      await bia.page.goto(url).catch(() => {});
    }
    await bia.page.waitForTimeout(500);
    expect(dialogos).toEqual([]);
  });
});
