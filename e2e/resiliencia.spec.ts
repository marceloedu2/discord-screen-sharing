import {
  test, expect, createRoom, joinRoom, shareScreen, shareCamera, videoCount, dropSockets,
  isPlaying, invite, stopWatching, roomButton, type User,
} from './fixtures';

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** Ana transmite a tela, Bia assiste e o vídeo está tocando. */
async function setup(spawn: (n: string) => Promise<User>, prefix: string) {
  const ana = await spawn('Ana');
  const bia = await spawn('Bia');
  const sala = unique(prefix);
  await createRoom(ana, sala);
  await joinRoom(bia, sala);
  await shareScreen(ana);
  await invite(bia).click();
  await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
  expect(await isPlaying(bia)).toBe(true);
  return { ana, bia, sala };
}

test.describe('resiliência', () => {
  test('queda de rede do espectador: retoma sozinho e volta a tocar', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'queda');
    // O aviso legítimo do início ainda pode estar na tela; o que não pode é um novo depois da queda.
    await expect(bia.page.getByText(/começou a compartilhar/)).toHaveCount(0, { timeout: 20_000 });
    await dropSockets(bia);
    await expect(stopWatching(bia)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
    await expect(bia.page.getByText(/começou a compartilhar/)).toHaveCount(0);
  });

  test('rede cai e volta quatro vezes seguidas', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'flap');
    bia.allow(/ERR_INTERNET_DISCONNECTED|WebSocket connection to/); // a rede foi desligada de propósito
    for (let i = 0; i < 4; i++) {
      await bia.context.setOffline(true);
      await dropSockets(bia);
      await bia.page.waitForTimeout(400);
      await bia.context.setOffline(false);
      await bia.page.waitForTimeout(300);
    }
    await expect(stopWatching(bia)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => isPlaying(bia), { timeout: 20_000 }).toBe(true);
  });

  test('queda longa de rede (vários ciclos de backoff) não expulsa da sala', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'longa');
    bia.allow(/ERR_INTERNET_DISCONNECTED|WebSocket connection to/);
    await bia.context.setOffline(true);
    await dropSockets(bia);
    // 1 s + 2 s + 4 s de tentativas falhas: antes, a primeira já tirava a pessoa da sala.
    await bia.page.waitForTimeout(8000);
    await expect(bia.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await expect(bia.page.getByText(/Reconectando/)).toBeVisible();
    await bia.context.setOffline(false);
    await expect(stopWatching(bia)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => isPlaying(bia), { timeout: 20_000 }).toBe(true);
  });

  test('avisos somem sozinhos mesmo com alguém assistindo (a sala re-renderiza todo segundo)', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'toast');
    // O aviso do início da transmissão é de 6 s; com o bug, nunca saía.
    await expect(bia.page.getByRole('status')).toHaveCount(0, { timeout: 12_000 });
  });

  test('transmissão a 15 fps ou parada não é marcada como ruim', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('leve');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
    await ana.page.getByRole('dialog').getByText('Leve').click();
    await ana.page.getByRole('dialog').getByRole('button', { name: 'Compartilhar tela' }).click();
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toBeVisible();
    await invite(bia).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
    await bia.page.waitForTimeout(4000);
    // O selo de qualidade só aparece quando não está "bom".
    await expect(bia.page.getByTitle(/Conexão (ruim|instável)/)).toHaveCount(0);
  });

  test('o transmissor perde a conexão: espectadores e a própria tela se acertam', async ({ spawn }) => {
    const { ana, bia } = await setup(spawn, 'caiu');
    // Derruba só o socket do transmissor (o último aberto é o de captura).
    await ana.page.evaluate(() => {
      const w = window as unknown as { __sockets: WebSocket[] };
      w.__sockets.filter((s) => /kind=/.test(s.url)).forEach((s) => s.close());
    });
    await expect(invite(bia)).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => videoCount(bia)).toBe(0);
    // Ana não pode ficar presa num "Parar de transmitir" de algo que já acabou.
    await expect(ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first()).toBeVisible({ timeout: 10_000 });
    // E consegue transmitir de novo.
    await shareScreen(ana);
    await expect(invite(bia)).toBeVisible();
  });

  test('transmissor recarrega a página no meio: a sala se acerta', async ({ spawn }) => {
    const { ana, bia } = await setup(spawn, 'f5');
    await ana.page.reload();
    await expect(ana.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible({ timeout: 15_000 });
    await expect(invite(bia)).toHaveCount(0, { timeout: 10_000 });
    await shareScreen(ana);
    await expect(invite(bia)).toBeVisible();
  });

  test('transmissor fecha a aba de repente: pode transmitir de novo ao voltar', async ({ spawn }) => {
    const { ana, bia, sala } = await setup(spawn, 'fecha');
    await ana.page.close();
    await expect(invite(bia)).toHaveCount(0, { timeout: 10_000 });
    const volta = await ana.context.newPage();
    ana.page = volta;
    await volta.goto('/');
    await roomButton(volta, sala).click();
    await expect(volta.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await shareScreen(ana);
    await expect(invite(bia)).toBeVisible();
  });

  test('espectador recarrega no meio: volta ao convite e reassiste', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'viewer-f5');
    await bia.page.reload();
    await expect(invite(bia)).toBeVisible({ timeout: 15_000 });
    await invite(bia).click();
    await expect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
  });

  test('assistir/parar em rajada termina consistente', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'rajada');
    for (let i = 0; i < 15; i++) {
      await stopWatching(bia).click();
      await invite(bia).click();
    }
    await expect.poll(() => isPlaying(bia), { timeout: 20_000 }).toBe(true);
    expect(await videoCount(bia)).toBe(1);
  });

  test('ligar e desligar a transmissão seis vezes com alguém assistindo', async ({ spawn }) => {
    const { ana, bia } = await setup(spawn, 'ciclos');
    for (let i = 0; i < 6; i++) {
      await ana.page.getByRole('button', { name: 'Parar de transmitir' }).click();
      await expect(invite(bia)).toHaveCount(0);
      await shareScreen(ana);
      await invite(bia).click();
      await expect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
    }
  });

  test('trocar de sala não deixa a anterior para trás', async ({ spawn }) => {
    const { bia } = await setup(spawn, 'sala-a');
    const caio = await spawn('Caio');
    const b = unique('sala-b');
    await createRoom(caio, b);
    await shareCamera(caio);

    await bia.page.getByRole('button', { name: 'Sair da sala' }).click();
    await joinRoom(bia, b);
    // Só existe a câmera do Caio; nada da sala A (a tela da Ana) pode ter sobrado.
    await expect(invite(bia)).toHaveCount(1);
    expect(await videoCount(bia)).toBe(0);
    await invite(bia).click();
    await expect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
    expect(await videoCount(bia)).toBe(1);
  });

  test('quatro espectadores na mesma transmissão', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const sala = unique('muitos');
    await createRoom(ana, sala);
    await shareScreen(ana);
    await shareCamera(ana);
    const viewers: User[] = [];
    for (let i = 0; i < 4; i++) {
      const v = await spawn(`V${i}`);
      await joinRoom(v, sala);
      viewers.push(v);
    }
    for (const v of viewers) {
      await invite(v).first().click();
      await invite(v).first().click();
    }
    for (const v of viewers) {
      await expect.poll(() => videoCount(v), { timeout: 30_000 }).toBe(2);
      expect(await isPlaying(v)).toBe(true);
    }
  });

  test('três transmissões de duas pessoas ao mesmo tempo', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const caio = await spawn('Caio');
    const bia = await spawn('Bia');
    const sala = unique('tres');
    await createRoom(ana, sala);
    await joinRoom(caio, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await shareCamera(ana);
    await shareScreen(caio);
    await expect(invite(bia)).toHaveCount(3);
    for (let i = 0; i < 3; i++) await invite(bia).first().click();
    await expect.poll(() => videoCount(bia), { timeout: 30_000 }).toBe(3);
    // Caio sai: só a dele some.
    await caio.page.getByRole('button', { name: 'Sair da sala' }).click();
    await expect.poll(() => videoCount(bia), { timeout: 10_000 }).toBe(2);
  });

  test('cancelar o modal não transmite nada', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await createRoom(ana, unique('cancela'));
    await ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
    await ana.page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    await expect(ana.page.getByRole('dialog')).toHaveCount(0);
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toHaveCount(0);
  });
});
