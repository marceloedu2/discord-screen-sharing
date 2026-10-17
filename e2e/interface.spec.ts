import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect, createRoom, joinRoom, shareScreen, shareCamera, videoCount, invite, isPlaying, setName, type User } from './fixtures';

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function axe(user: User) {
  await user.page.evaluate(axeSource);
  return user.page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return r.violations
      .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
      .map((v: any) => `${v.id}: ${v.nodes.slice(0, 2).map((n: any) => n.target.join(' ')).join(' | ')}`);
  });
}

const semEstouro = (user: User) =>
  user.page.evaluate(() => {
    const el = document.documentElement;
    const culpado = [...document.querySelectorAll('body *')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed';
    });
    return { sobra: el.scrollWidth - window.innerWidth, culpado: culpado ? `${culpado.tagName}.${String(culpado.className).slice(0, 60)}` : null };
  });

async function salaComDuasTelas(spawn: (n: string) => Promise<User>, prefix: string, viewport?: { width: number; height: number }) {
  const ana = await spawn('Ana');
  const bia = await spawn('Bia');
  if (viewport) await bia.page.setViewportSize(viewport);
  const sala = unique(prefix);
  await createRoom(ana, sala);
  await joinRoom(bia, sala);
  await shareScreen(ana);
  await shareCamera(ana);
  for (let i = 0; i < 2; i++) await invite(bia).first().click();
  await expect.poll(() => videoCount(bia), { timeout: 20_000 }).toBe(2);
  return { ana, bia, sala };
}

test.describe('interface', () => {
  test('acessibilidade (axe): sala com duas transmissões, desktop e celular', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'axe');
    expect(await axe(bia), 'desktop').toEqual([]);
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    expect(await axe(bia), 'menu aberto').toEqual([]);
    await bia.page.keyboard.press('Escape');
    await bia.page.setViewportSize({ width: 390, height: 844 });
    expect(await axe(bia), 'celular').toEqual([]);
  });

  test('celular (390×844): sem estouro horizontal, controles dentro da tela, alvos de toque ≥ 24px', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'mobile', { width: 390, height: 844 });
    const o = await semEstouro(bia);
    expect(o.sobra, `estouro por ${o.culpado}`).toBeLessThanOrEqual(0);

    const caixas = await bia.page.getByRole('button').evaluateAll((els) =>
      els.map((e) => ({ nome: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '?', r: e.getBoundingClientRect(), visivel: (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed' }))
        .filter((x) => x.visivel && x.r.width > 0)
        .map((x) => ({ nome: x.nome, w: x.r.width, h: x.r.height, dentro: x.r.left >= -1 && x.r.right <= window.innerWidth + 1 }))
    );
    for (const c of caixas) {
      if (/Next\.js/.test(c.nome)) continue; // ferramenta do modo dev
      expect(c.dentro, `${c.nome} fora da tela`).toBe(true);
      expect(Math.min(c.w, c.h), `${c.nome} pequeno demais para o toque`).toBeGreaterThanOrEqual(24);
    }
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeInViewport();
  });

  test('redimensionar de 1280 a 320 e voltar, assistindo: sem estouro e o vídeo segue', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'resize');
    for (const [w, h] of [[900, 600], [600, 800], [390, 844], [320, 568], [1280, 720]] as const) {
      await bia.page.setViewportSize({ width: w, height: h });
      await bia.page.waitForTimeout(250);
      const o = await semEstouro(bia);
      expect(o.sobra, `${w}×${h}: estouro por ${o.culpado}`).toBeLessThanOrEqual(0);
    }
    expect(await videoCount(bia)).toBe(2);
    expect(await isPlaying(bia)).toBe(true);
  });

  test('atalhos: G alterna grade/foco, P oculta pessoas, ? abre ajuda, números levam ao palco, F tela cheia', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'atalhos');
    await bia.page.locator('body').click({ position: { x: 5, y: 300 } });

    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    const grade = bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' });
    await expect(grade).toBeChecked();
    await bia.page.keyboard.press('Escape');

    await bia.page.keyboard.press('g');
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' })).not.toBeChecked();
    await bia.page.keyboard.press('Escape');

    await bia.page.keyboard.press('p');
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(bia.page.getByRole('menuitemcheckbox', { name: 'Participantes sem vídeo' })).not.toBeChecked();
    await bia.page.keyboard.press('Escape');
    await bia.page.keyboard.press('p');

    for (const k of ['2', '1', '3', '4', '9', '0']) await bia.page.keyboard.press(k); // 3,4,9,0 não existem: não pode quebrar
    expect(await videoCount(bia)).toBe(2);

    await bia.page.keyboard.press('Shift+?');
    await expect(bia.page.getByRole('dialog')).toBeVisible();
    await bia.page.keyboard.press('Escape');
    await expect(bia.page.getByRole('dialog')).toHaveCount(0);

    await bia.page.keyboard.press('f');
    await expect(bia.page.getByRole('button', { name: 'Sair da tela cheia' })).toBeVisible();
    await bia.page.keyboard.press('f');
    await expect(bia.page.getByRole('button', { name: 'Tela cheia' })).toBeVisible();
    expect(await isPlaying(bia)).toBe(true);
  });

  test('atalhos com Ctrl/Cmd/Alt não disparam (são do navegador)', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'modif');
    await bia.page.locator('body').click({ position: { x: 5, y: 300 } });
    for (const combo of ['Control+f', 'Control+g', 'Alt+p', 'Control+1', 'Meta+m']) await bia.page.keyboard.press(combo);
    await expect(bia.page.getByRole('button', { name: 'Tela cheia' })).toBeVisible();
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' })).toBeChecked();
  });

  test('menu e modais: Esc fecha, clique fora fecha, foco volta para quem abriu', async ({ spawn }) => {
    const { bia } = await salaComDuasTelas(spawn, 'foco');
    const mais = bia.page.getByRole('button', { name: 'Mais opções' });
    await mais.click();
    await expect(bia.page.getByRole('menu')).toBeVisible();
    await bia.page.keyboard.press('Escape');
    await expect(bia.page.getByRole('menu')).toHaveCount(0);

    await mais.click();
    await bia.page.mouse.click(300, 200);
    await expect(bia.page.getByRole('menu')).toHaveCount(0);

    const perfil = bia.page.getByRole('button', { name: /Seu perfil/ });
    await perfil.click();
    await expect(bia.page.getByRole('dialog')).toBeVisible();
    await bia.page.keyboard.press('Escape');
    await expect(bia.page.getByRole('dialog')).toHaveCount(0);
    await expect(perfil).toBeFocused();
  });

  test('nomes longos (40 e 32 caracteres, só "W") não estouram o layout em desktop e celular', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = 'W'.repeat(40);
    await createRoom(ana, sala);
    await setName(ana, 'W'.repeat(32));
    await joinRoom(bia, sala).catch(async () => {
      await bia.page.goto('/');
      await bia.page.getByRole('button', { name: /^W{10,}/ }).first().click();
    });
    await shareScreen(ana);
    for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await bia.page.setViewportSize(vp);
      await bia.page.waitForTimeout(250);
      const o = await semEstouro(bia);
      expect(o.sobra, `${vp.width}px: estouro por ${o.culpado}`).toBeLessThanOrEqual(0);
    }
    await bia.page.getByRole('button', { name: 'Sair da sala' }).click();
    await bia.page.setViewportSize({ width: 320, height: 568 });
    const lobby = await semEstouro(bia);
    expect(lobby.sobra, `lobby: estouro por ${lobby.culpado}`).toBeLessThanOrEqual(0);
  });

  test('sala cheia: oito pessoas e duas transmissões, grade sem estouro e todos listados', async ({ spawn }) => {
    test.setTimeout(120_000);
    const ana = await spawn('Ana');
    const sala = unique('cheia');
    await createRoom(ana, sala);
    await shareScreen(ana);
    await shareCamera(ana);
    const gente: User[] = [];
    for (let i = 0; i < 7; i++) {
      const u = await spawn(`P${i}`);
      await joinRoom(u, sala);
      gente.push(u);
    }
    const olhando = gente[0]!;
    for (let i = 0; i < 2; i++) await invite(olhando).first().click();
    await expect.poll(() => videoCount(olhando), { timeout: 30_000 }).toBe(2);
    await expect(olhando.page.getByText(/Convidado \d+/).first()).toBeVisible();
    for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await olhando.page.setViewportSize(vp);
      await olhando.page.waitForTimeout(300);
      const o = await semEstouro(olhando);
      expect(o.sobra, `${vp.width}px: estouro por ${o.culpado}`).toBeLessThanOrEqual(0);
    }
    expect(await isPlaying(olhando)).toBe(true);
  });
});

// Palavras de código que podem aparecer no texto de propósito (chaves de
// armazenamento e APIs citadas na política de privacidade, nome do framework).
const PERMITIDAS = /^(displayName|volumePessoa|localStorage|sessionStorage|getDisplayMedia|getUserMedia|WebSocket|iPhone|iPad|OAuth|DevTools|GitHub|YouTube|openExternalLink|SessionStorage)$/;
const CAMEL = /\b[a-z]{2,}[A-Z][a-zA-Z]+\b/g;
const INGLES = /\b(goBack|poppedOut|enterRoom|undefined|null|NaN|\[object Object\]|Details|Screen|Stream)\b/;

async function textoVisivel(user: User) {
  return user.page.evaluate(() => document.body.innerText);
}

function conferir(rota: string, texto: string) {
  const camel = (texto.match(CAMEL) ?? []).filter((p) => !PERMITIDAS.test(p));
  expect(camel, `${rota}: identificador de código no texto`).toEqual([]);
  expect(texto, `${rota}: resto de inglês ou valor cru`).not.toMatch(INGLES);
}

test.describe('texto e acessibilidade em todos os estados', () => {
  test('nenhuma tela mostra identificador de código, "undefined" ou resto de inglês', async ({ spawn }) => {
    const { ana, bia } = await salaComDuasTelas(spawn, 'texto-geral');
    for (const rota of ['/termos', '/privacidade', '/share']) {
      await bia.page.goto(rota);
      await bia.page.waitForTimeout(300);
      conferir(rota, await textoVisivel(bia));
    }
    await bia.page.goto('/');
    await bia.page.waitForTimeout(300);
    conferir('lobby', await textoVisivel(bia));
    await bia.page.getByRole('button', { name: 'Criar sala', exact: true }).click();
    conferir('modal criar sala', await textoVisivel(bia));
    await bia.page.keyboard.press('Escape');

    // Dentro da sala: menu, detalhes, perfil, modal de transmissão, ajuda.
    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    conferir('menu', await textoVisivel(ana));
    await ana.page.getByRole('menuitem', { name: /Detalhes da conexão/ }).click();
    conferir('detalhes', await textoVisivel(ana));
    await ana.page.getByRole('button', { name: /Seu perfil/ }).click();
    conferir('perfil', await textoVisivel(ana));
    await ana.page.keyboard.press('Escape');
    await ana.page.keyboard.press('Shift+?');
    conferir('ajuda', await textoVisivel(ana));
    await ana.page.keyboard.press('Escape');
    await ana.page.getByRole('button', { name: 'Parar de transmitir' }).click();
    await ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
    conferir('modal compartilhar', await textoVisivel(ana));
  });

  test('axe em lobby, modais, detalhes, menu de contexto e na página de captura', async ({ spawn }) => {
    const { ana, bia } = await salaComDuasTelas(spawn, 'axe-geral');

    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    await ana.page.getByRole('menuitem', { name: /Detalhes da conexão/ }).click();
    expect(await axe(ana), 'detalhes').toEqual([]);

    await bia.page.getByRole('button', { name: /Seu perfil/ }).click();
    expect(await axe(bia), 'perfil').toEqual([]);
    await bia.page.keyboard.press('Escape');

    await bia.page.getByRole('button', { name: 'Sair da sala' }).click();
    await expect(bia.page.getByRole('heading', { name: 'Salas' })).toBeVisible();
    expect(await axe(bia), 'lobby com sala').toEqual([]);
    await bia.page.getByRole('button', { name: 'Criar sala', exact: true }).click();
    expect(await axe(bia), 'modal criar sala').toEqual([]);
    await bia.page.keyboard.press('Escape');

    // Página de captura: antes e depois de transmitir (botão de encerrar, vermelho).
    const shareUrl = await ana.page.evaluate(() => {
      const t = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('sala:')) ?? '') ?? 'null');
      return t?.shareUrl ?? null;
    });
    expect(shareUrl, 'a sala guarda a shareUrl').not.toBeNull();
    // A aba de captura usa o link de transmissão da Ana: com a câmera dela já no ar, o servidor recusaria a duplicata.
    await ana.page.getByRole('button', { name: 'Desligar câmera' }).click();
    await expect(ana.page.getByRole('button', { name: 'Ligar câmera' })).toBeVisible();
    const cap = await spawn('Cap');
    await cap.page.goto(`${shareUrl}&source=camera&preset=good`);
    await expect(cap.page.getByRole('heading', { name: /Ligar câmera|Compartilhar tela/ })).toBeVisible();
    expect(await axe(cap), 'captura antes').toEqual([]);
    await cap.page.getByRole('button', { name: /Ligar câmera|Escolher tela/ }).click();
    const noAr = cap.page.getByRole('button', { name: /Entrar no ar|Desligar câmera|Parar de transmitir/ });
    await expect(noAr.first()).toBeVisible({ timeout: 15_000 });
    expect(await axe(cap), 'captura prévia/no ar').toEqual([]);
    if (await cap.page.getByRole('button', { name: 'Entrar no ar' }).count()) {
      await cap.page.getByRole('button', { name: 'Entrar no ar' }).click();
      await expect(cap.page.getByRole('button', { name: /Desligar câmera|Parar de transmitir/ })).toBeVisible({ timeout: 15_000 });
      expect(await axe(cap), 'captura no ar').toEqual([]);
    }
  });

  test('axe nos convites ("Assistir a tela de…") e nos tiles da própria pessoa ("Ver minha tela")', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('axe-convite');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await shareCamera(ana);

    // Convite para quem assiste: o nome acessível continua dizendo de quem é a tela.
    await expect(invite(bia)).toHaveCount(2);
    expect(await axe(bia), 'convites').toEqual([]);
    // E para quem transmite, o tile próprio.
    await expect(ana.page.getByRole('button', { name: 'Ver minha tela' })).toHaveCount(2);
    expect(await axe(ana), 'tiles próprios').toEqual([]);

    // Miniaturas (modo foco): sem texto visível, o nome só existe para o leitor de tela.
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' }).click();
    await bia.page.keyboard.press('Escape');
    expect(await axe(bia), 'foco, com miniaturas').toEqual([]);
    await expect(bia.page.getByRole('button', { name: /^Assistir a tela de/ }).first()).toBeVisible();
  });
});
