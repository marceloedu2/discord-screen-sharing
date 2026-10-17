import { test, expect, createRoom, joinRoom, shareScreen, invite, videoCount, isPlaying, type User } from './fixtures';

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const abrirModalTela = async (u: User) => {
  await u.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
  await u.page.getByRole('dialog').getByRole('button', { name: 'Compartilhar tela' }).click();
};

/** Faz o getDisplayMedia falhar do jeito pedido, depois de `atrasoMs`. */
async function falhaCaptura(u: User, nome: string, atrasoMs: number) {
  await u.context.addInitScript(
    ([n, ms]) => {
      navigator.mediaDevices.getDisplayMedia = () =>
        new Promise((_, rej) => setTimeout(() => rej(new DOMException('negado', n as string)), ms as number));
    },
    [nome, atrasoMs] as const
  );
}

test.describe('captura que falha', () => {
  test('câmera negada: mensagem clara, botão não fica preso, e dá para tentar de novo', async ({ browser, spawn }) => {
    const ana = await spawn('Ana');
    await createRoom(ana, unique('sem-camera'));
    await ana.context.clearPermissions();
    await ana.context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await ana.page.reload();
    await expect(ana.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible({ timeout: 15_000 });
    await ana.page.getByRole('button', { name: 'Ligar câmera' }).click();
    await expect(ana.page.getByRole('status')).toBeVisible({ timeout: 5000 });
    await expect(ana.page.getByRole('button', { name: 'Ligar câmera' })).toBeVisible();
    await expect(ana.page.getByRole('button', { name: 'Desligar câmera' })).toHaveCount(0);
    // Tentar de novo não pode estar travado por estado antigo.
    await ana.page.getByRole('button', { name: 'Ligar câmera' }).click();
    await expect(ana.page.getByRole('button', { name: 'Desligar câmera' })).toHaveCount(0);
    void browser;
  });

  test('seletor de tela cancelado (negado depois de um tempo): sem erro, sem transmissão, sem aba', async ({ spawn, context }) => {
    const ana = await spawn('Ana');
    await falhaCaptura(ana, 'NotAllowedError', 600);
    await createRoom(ana, unique('cancela-seletor'));
    const abas: string[] = [];
    ana.context.on('page', (p) => abas.push(p.url()));
    await abrirModalTela(ana);
    await ana.page.waitForTimeout(1500);
    expect(abas, 'abriu aba externa para quem só cancelou').toEqual([]);
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toHaveCount(0);
    await expect(ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first()).toBeVisible();
    void context;
  });

  test('bloqueio instantâneo por política cai para a aba externa, já configurada (RN-TRX-7)', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await falhaCaptura(ana, 'NotAllowedError', 0);
    await createRoom(ana, unique('politica'));
    const aba = ana.context.waitForEvent('page');
    await abrirModalTela(ana);
    const nova = await aba;
    await nova.waitForLoadState('domcontentloaded');
    const url = new URL(nova.url());
    expect(url.pathname).toBe('/share');
    expect(url.searchParams.get('source')).toBe('screen');
    expect(url.searchParams.get('preset')).toBe('good');
    expect(url.searchParams.get('q')).toBe('2500000');
    expect(url.searchParams.get('fps')).toBe('30');
    expect(url.searchParams.get('t')).toBeTruthy();
    await expect(nova.getByRole('heading', { name: 'Compartilhar tela' })).toBeVisible();
  });

  test('erro inesperado da captura aparece como aviso e não derruba a sala', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await falhaCaptura(ana, 'NotReadableError', 100);
    await createRoom(ana, unique('ilegivel'));
    await abrirModalTela(ana);
    await expect(ana.page.getByRole('status')).toBeVisible({ timeout: 5000 });
    await expect(ana.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toHaveCount(0);
  });

  test('parar pelo botão nativo do navegador encerra a transmissão e avisa (RF-TRX-10)', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    // Guarda a stream para o teste "clicar em parar de compartilhar" do navegador.
    await ana.context.addInitScript(() => {
      const nativo = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (c) => {
        const s = await nativo(c);
        (window as unknown as { __captura: MediaStream }).__captura = s;
        return s;
      };
    });
    const sala = unique('nativo');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await shareScreen(ana);
    await invite(bia).click();
    await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBe(1);

    await ana.page.evaluate(() => {
      const s = (window as unknown as { __captura: MediaStream }).__captura;
      s.getTracks().forEach((t) => { t.stop(); t.dispatchEvent(new Event('ended')); });
    });
    await expect(ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(ana.page.getByText(/parou o compartilhamento pelo navegador/)).toBeVisible();
    await expect(invite(bia)).toHaveCount(0, { timeout: 10_000 });
    expect(await videoCount(bia)).toBe(0);
  });

  test('trocar de qualidade no preset Máxima não derruba quem assiste', async ({ spawn }) => {
    const ana = await spawn('Ana');
    const bia = await spawn('Bia');
    const sala = unique('maxima');
    await createRoom(ana, sala);
    await joinRoom(bia, sala);
    await ana.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
    await ana.page.getByRole('dialog').getByText('Máxima').click();
    await ana.page.getByRole('dialog').getByRole('button', { name: 'Compartilhar tela' }).click();
    await expect(ana.page.getByRole('button', { name: 'Parar de transmitir' })).toBeVisible();
    await invite(bia).click();
    await expect.poll(() => isPlaying(bia), { timeout: 20_000 }).toBe(true);
  });
});
