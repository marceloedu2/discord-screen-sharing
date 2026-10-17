import {
  test, expect, createRoom, joinRoom, shareScreen, shareCamera, setName, videoCount, roomButton,
} from './fixtures';

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.describe('produto', () => {
  test('tela e câmera: duas transmissões independentes e simultâneas', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('dupla');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);

    await shareScreen(ana);
    await shareCamera(ana);

    // Bia vê dois convites: o da tela e o da câmera.
    await expect(bia.page.getByRole('button', { name: /^Assistir a tela de/ })).toHaveCount(2);
    // Cada clique troca o convite por "Parar de assistir": o primeiro que sobra é sempre o próximo.
    for (let i = 0; i < 2; i++) {
      await bia.page.getByRole('button', { name: /^Assistir a tela de/ }).first().click();
    }
    await expect.poll(() => videoCount(bia), { timeout: 20_000 }).toBe(2);

    // Parar a câmera não toca na tela.
    await ana.page.getByRole('button', { name: 'Desligar câmera' }).click();
    await expect.poll(() => videoCount(bia)).toBe(1);
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toBeVisible();

    // E o inverso: religa a câmera, para a tela.
    await shareCamera(ana);
    await ana.page.getByRole('button', { name: 'Parar de transmitir' }).click();
    await expect(ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first()).toBeVisible();
    await expect(bia.page.getByRole('button', { name: /^Assistir a tela de/ })).toHaveCount(1);
  });

  test('quem entra depois vê o convite e não recebe aviso de início', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const caio = await spawn('Caio');
    const sala = unique('tarde');
    await createRoom(ana, sala);
    await shareScreen(ana);
    await shareCamera(ana);

    await joinRoom(caio, sala);
    await expect(caio.page.getByRole('button', { name: /^Assistir a tela de/ })).toHaveCount(2);
    // RN-AST-32: entrar numa sala com transmissões no ar não dispara "começou".
    await caio.page.waitForTimeout(800);
    await expect(caio.page.getByText(/começou a compartilhar|ligou a câmera/)).toHaveCount(0);
  });

  test('quem já está na sala é avisado quando alguém começa a transmitir', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('aviso');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await expect(bia.page.getByText(/começou a compartilhar a tela/)).toBeVisible();
    await shareCamera(ana);
    await expect(bia.page.getByText(/ligou a câmera/)).toBeVisible();
  });

  test('apelido aparece para os outros, no tile e na lista', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('apelido');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await setName(ana, 'Anabela');
    await expect(bia.page.getByText('Anabela').first()).toBeVisible();

    // Renomear DEPOIS de transmitir também precisa chegar no tile da tela.
    await shareScreen(ana);
    await setName(ana, 'Anabela Dois');
    await expect(bia.page.getByRole('button', { name: 'Assistir a tela de Anabela Dois' })).toBeVisible();
  });

  test('assistir mostra latência e quadros no painel de detalhes', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('detalhes');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await bia.page.getByRole('button', { name: /^Assistir a tela de/ }).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);

    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await bia.page.getByRole('menuitem', { name: /Detalhes da conexão/ }).click();
    // O painel é uma camada flutuante, não um diálogo modal.
    const dialog = bia.page.getByRole('heading', { name: 'Detalhes' }).locator('xpath=../..');
    await expect(dialog.getByText('Latência')).toBeVisible();
    // O contador é por segundo: a primeira leitura é zero até a primeira amostra.
    await expect
      .poll(async () => Number((await dialog.getByText(/^\d+\/s$/).first().innerText()).replace('/s', '')), { timeout: 10_000 })
      .toBeGreaterThan(5);
    await expect(dialog.getByText(/^\d+ ms$/)).toBeVisible();
  });

  test('parar de assistir devolve o convite e a transmissão segue no ar', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('unwatch');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await bia.page.getByRole('button', { name: /^Assistir a tela de/ }).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
    await bia.page.getByRole('button', { name: /^Parar de assistir/ }).click();
    await expect(bia.page.getByRole('button', { name: /^Assistir a tela de/ })).toBeVisible();
    expect(await videoCount(bia)).toBe(0);
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toBeVisible();
    // E dá para voltar a assistir.
    await bia.page.getByRole('button', { name: /^Assistir a tela de/ }).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
  });

  test('sala com senha: errada barra, certa entra', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('senha');
    await createRoom(ana, sala, 'segredo');
    bia.allow(/status of 403/); // a recusa por senha é o comportamento esperado

    await bia.page.goto('/');
    await roomButton(bia.page, sala).click();
    await bia.page.locator('#enterPassword').fill('errada');
    await bia.page.keyboard.press('Enter');
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toHaveCount(0);
    await bia.page.locator('#enterPassword').fill('segredo');
    await bia.page.keyboard.press('Enter');
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  });

  test('só o dono troca a senha, e a nova vale para quem entra depois', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('troca');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);

    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(bia.page.getByRole('menuitem', { name: 'Senha da sala' })).toHaveCount(0);
    await bia.page.keyboard.press('Escape');

    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    await ana.page.getByRole('menuitem', { name: 'Senha da sala' }).click();
    await ana.page.getByRole('dialog').getByRole('textbox').fill('nova');
    await ana.page.keyboard.press('Enter');

    const caio = await spawn('Caio');
    caio.allow(/status of 403/);
    await caio.page.goto('/');
    await roomButton(caio.page, sala).click();
    await expect(caio.page.locator('#enterPassword')).toBeVisible();
  });

  test('sair: a sala some da lista só quando o último sai', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const obs = await spawn('Obs');
    const sala = unique('sair');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);

    await ana.page.getByRole('button', { name: 'Sair da sala' }).click();
    await obs.page.goto('/');
    await expect(roomButton(obs.page, sala)).toBeVisible();

    await bia.page.getByRole('button', { name: 'Sair da sala' }).click();
    await expect(bia.page.getByRole('heading', { name: 'Salas' })).toBeVisible();
    await expect
      .poll(async () => {
        await obs.page.reload();
        return roomButton(obs.page, sala).count();
      }, { timeout: 15_000 })
      .toBe(0);
  });

  test('grade ↔ foco e participantes: a escolha sobrevive ao recarregar', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('modo');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);

    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    const grade = bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' });
    await expect(grade).toBeChecked();
    await grade.click();
    await bia.page.reload();
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await bia.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(bia.page.getByRole('menuitemcheckbox', { name: 'Exibição em grade' })).not.toBeChecked();
  });

  test('textos da interface em pt-BR, sem resto de renomeação em inglês', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await createRoom(ana, unique('texto'));
    await shareScreen(ana);
    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    const texto = await ana.page.locator('body').innerText();
    for (const ruim of [/\bDetails\b/, /\bScreen cheia\b/, /\bRoom\b/, /\bshare\b/i]) {
      expect(texto, `contém ${ruim}`).not.toMatch(ruim);
    }
    const labels = await ana.page.locator('[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    for (const l of labels) expect(l, 'aria-label').not.toMatch(/\bDetails\b|\bScreen\b/);
  });

  test('sala trancada: recarregar não pede a senha de novo, e o token mora em sala:<id>', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('guardado');
    await createRoom(ana, sala, 'segredo');
    bia.allow(/status of 403/);
    await bia.page.goto('/');
    await roomButton(bia.page, sala).click();
    await bia.page.locator('#enterPassword').fill('segredo');
    await bia.page.keyboard.press('Enter');
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();

    // A chave segue em português: renomear orfanaria a sessão de quem já usava o app.
    const chaves = await bia.page.evaluate(() => Object.keys(localStorage).filter((k) => /^(sala|room):/.test(k)));
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatch(/^sala:/);

    await bia.page.reload();
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible({ timeout: 15_000 });
    await expect(bia.page.locator('#enterPassword')).toHaveCount(0);

    // Quem gravou na chave do porte (room:<id>) também entra, e a gravação migra.
    await bia.page.evaluate((k) => {
      const v = localStorage.getItem(k)!;
      localStorage.removeItem(k);
      localStorage.setItem(k.replace(/^sala:/, 'room:'), v);
    }, chaves[0]!);
    await bia.page.reload();
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible({ timeout: 15_000 });
    await expect(bia.page.locator('#enterPassword')).toHaveCount(0);
  });

  test('o aviso com botão tem espaço entre o texto e a ação (leitor de tela)', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('espaco');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareCamera(ana);
    const aviso = bia.page.getByRole('status');
    await expect(aviso).toContainText('ligou a câmera');
    expect(await aviso.evaluate((el) => el.textContent)).toMatch(/câmera\s+Assistir/);
  });
});
