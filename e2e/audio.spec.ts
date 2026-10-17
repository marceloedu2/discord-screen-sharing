import { test, expect, createRoom, joinRoom, shareScreen, videoCount, invite, isPlaying, type User } from './fixtures';

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/**
 * A captura de tela sintética do Chromium não tem faixa de som. Aqui o
 * `getDisplayMedia` devolve um canvas animado **com** um oscilador, e marca a
 * superfície como aba — o app só deixa o som passar de aba e janela
 * (RN-TRX-24), nunca de tela inteira.
 */
async function comSom(user: User, surface: 'browser' | 'window' | 'monitor' = 'browser') {
  await user.context.addInitScript((displaySurface) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const g = canvas.getContext('2d')!;
      let t = 0;
      setInterval(() => {
        g.fillStyle = `hsl(${(t += 6) % 360} 80% 40%)`;
        g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#fff';
        g.font = '64px sans-serif';
        g.fillText(String(t), 100, 200);
      }, 33);
      const stream = canvas.captureStream(30);
      const ac = new AudioContext({ sampleRate: 48000 });
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      void ac.resume();
      stream.addTrack(dest.stream.getAudioTracks()[0]!);
      const video = stream.getVideoTracks()[0]!;
      const base = video.getSettings.bind(video);
      video.getSettings = () => ({ ...base(), displaySurface } as MediaTrackSettings);
      return stream;
    };
  }, surface);
}

async function abrirDetalhes(user: User) {
  await user.page.getByRole('button', { name: 'Mais opções' }).click();
  await user.page.getByRole('menuitem', { name: /Detalhes da conexão/ }).click();
  return user.page.getByRole('heading', { name: 'Detalhes' }).locator('xpath=../..');
}

test.describe('áudio', () => {
  test('transmissão de aba leva som: aviso de áudio, controle de volume e estado "tocando"', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana);
    const sala = unique('som');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);

    // Sem nada para ouvir, não há controle de som (RN-AUD-14).
    await expect(bia.page.getByRole('button', { name: /Silenciar|Tirar do mudo/ })).toHaveCount(0);

    await shareScreen(ana);
    await invite(bia).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);
    await expect(bia.page.getByRole('button', { name: 'Silenciar' })).toBeVisible({ timeout: 15_000 });

    const detalhes = await abrirDetalhes(bia);
    await expect(detalhes.getByText(/tocando/)).toBeVisible({ timeout: 10_000 });
  });

  test('mudo vira zero, desmutar volta ao valor anterior (não a 100%) e a escolha sobrevive a recarregar', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana);
    const sala = unique('mudo');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    const slider = bia.page.getByRole('slider').first();
    await expect(slider).toBeVisible({ timeout: 15_000 });

    await slider.fill('0.4');
    await bia.page.getByRole('button', { name: 'Silenciar' }).click();
    await expect(slider).toHaveValue('0');
    await bia.page.getByRole('button', { name: 'Tirar do mudo' }).click();
    await expect(slider).toHaveValue('0.4');

    await bia.page.reload();
    await invite(bia).click();
    await expect(bia.page.getByRole('slider').first()).toHaveValue('0.4', { timeout: 15_000 });
  });

  test('atalho M alterna o mudo, e digitar "m" num campo de texto não aciona nada', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana);
    const sala = unique('atalho-m');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    const slider = bia.page.getByRole('slider').first();
    await expect(slider).toBeVisible({ timeout: 15_000 });
    const antes = await slider.inputValue();

    await bia.page.keyboard.press('m');
    await expect(slider).toHaveValue('0');
    await bia.page.keyboard.press('m');
    await expect(slider).toHaveValue(antes);

    // Com modal aberto e foco no campo, "m" é só uma letra.
    await bia.page.getByRole('button', { name: /Seu perfil/ }).click();
    await bia.page.getByLabel('Nome exibido').fill('');
    await bia.page.keyboard.type('mmm');
    await expect(bia.page.getByLabel('Nome exibido')).toHaveValue('mmm');
    await bia.page.keyboard.press('Escape');
    await expect(slider).toHaveValue(antes);
  });

  test('tela inteira nunca leva som (RN-TRX-24): sem controle de volume para quem assiste', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana, 'monitor');
    const sala = unique('monitor');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    await expect.poll(() => isPlaying(bia), { timeout: 15_000 }).toBe(true);
    await bia.page.waitForTimeout(2500);
    await expect(bia.page.getByRole('button', { name: /Silenciar|Tirar do mudo/ })).toHaveCount(0);
    const detalhes = await abrirDetalhes(bia);
    await expect(detalhes.getByText(/não tem áudio/)).toBeVisible();
  });

  test('menu do tile: volume por pessoa vai até 200% e fica guardado depois de recarregar', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana);
    const sala = unique('pessoa');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    await expect(bia.page.getByRole('button', { name: 'Silenciar' })).toBeVisible({ timeout: 15_000 });

    const tile = bia.page.getByRole('button', { name: /^Parar de assistir/ }).locator('xpath=ancestor::*[self::div or self::section][1]');
    await tile.click({ button: 'right', position: { x: 80, y: 80 } });
    const volume = bia.page.getByRole('slider', { name: /Volume de/ });
    await expect(volume).toBeVisible();
    expect(await volume.getAttribute('max')).toBe('2');
    await volume.fill('1.5');
    await bia.page.keyboard.press('Escape');

    const guardado = await bia.page.evaluate(() => localStorage.getItem('volumePessoa'));
    expect(guardado).toContain('1.5');
    await bia.page.reload();
    await invite(bia).click();
    await expect(bia.page.getByRole('button', { name: 'Silenciar' })).toBeVisible({ timeout: 15_000 });
    const guardado2 = await bia.page.evaluate(() => localStorage.getItem('volumePessoa'));
    expect(guardado2).toContain('1.5');
  });

  test('queda de rede com som: o áudio volta junto do vídeo', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    await comSom(ana);
    const sala = unique('som-queda');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    await expect(bia.page.getByRole('button', { name: 'Silenciar' })).toBeVisible({ timeout: 15_000 });

    await bia.page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.forEach((s) => s.close()));
    await expect(bia.page.getByRole('button', { name: /^Parar de assistir/ })).toBeVisible({ timeout: 15_000 });
    await expect(bia.page.getByRole('button', { name: 'Silenciar' })).toBeVisible({ timeout: 15_000 });
    const detalhes = await abrirDetalhes(bia);
    await expect(detalhes.getByText(/tocando/)).toBeVisible({ timeout: 10_000 });
  });
});
