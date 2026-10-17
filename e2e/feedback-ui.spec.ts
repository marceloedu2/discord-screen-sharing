import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect, createRoom, setName, type User } from './fixtures';

/**
 * O modal de feedback no navegador, de ponta a ponta: o que a pessoa vê e faz,
 * e o que de fato chega ao (falso) Discord.
 */
const MOCK = 'http://127.0.0.1:4999';
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

// Imagens reais e minúsculas: precisam decodificar para a miniatura aparecer.
const B64 = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  gif: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  webp: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
};
const arquivo = (nome: string, tipo: keyof typeof B64 | 'texto', tamanho?: number) => {
  const base = tipo === 'texto' ? Buffer.from('isto não é uma imagem') : Buffer.from(B64[tipo], 'base64');
  const buffer = tamanho ? Buffer.concat([base, Buffer.alloc(Math.max(0, tamanho - base.length), 0)]) : base;
  const mimeType = tipo === 'texto' ? 'text/plain' : `image/${tipo}`;
  return { name: nome, mimeType, buffer };
};

let seq = 0;
/** Cada pessoa com seu "endereço": o limite por endereço não vaza entre testes. */
async function comEndereco(user: User) {
  const ip = `10.7.${Math.floor(++seq / 250)}.${seq % 250}-${Date.now()}`;
  await user.context.route('**/api/feedback', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } })
  );
  user.allow(/Failed to load resource/); // 4xx/5xx dos casos de erro são o esperado
}

const gravados = async (): Promise<any[]> => (await fetch(`${MOCK}/__requests`)).json();
const modo = (m: object) => fetch(`${MOCK}/__mode`, { method: 'POST', body: JSON.stringify(m) });
const dialogo = (u: User) => u.page.getByRole('dialog', { name: 'Enviar feedback' });
const abrir = async (u: User) => {
  await u.page.getByRole('button', { name: 'Enviar feedback' }).first().click();
  await expect(dialogo(u)).toBeVisible();
};
const preencher = async (u: User, { resumo = 'O vídeo trava', descricao = 'Depois de um minuto assistindo, a imagem congela.' } = {}) => {
  await dialogo(u).getByLabel('Resumo').fill(resumo);
  await dialogo(u).getByLabel(/O que aconteceu\?|Seu feedback/).fill(descricao);
};
const anexar = (u: User, ...arquivos: ReturnType<typeof arquivo>[]) => dialogo(u).locator('input[type=file]').setInputFiles(arquivos);
const enviar = (u: User) => dialogo(u).getByRole('button', { name: 'Enviar', exact: true }).click();

async function axe(u: User) {
  await u.page.evaluate(axeSource);
  return u.page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return r.violations
      .filter((v: any) => v.impact === 'serious' || v.impact === 'critical')
      .map((v: any) => `${v.id}: ${v.nodes.slice(0, 2).map((n: any) => n.target.join(' ')).join(' | ')}`);
  });
}

test.describe('modal de feedback', () => {
  test.beforeEach(async () => {
    await fetch(`${MOCK}/__reset`, { method: 'POST' });
  });

  test('abre no lobby e na sala, fecha com Esc, clique fora e Cancelar, e devolve o foco', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await ana.page.goto('/');
    const botao = ana.page.getByRole('button', { name: 'Enviar feedback' }).first();
    await expect(botao).toBeVisible();

    await botao.click();
    await expect(dialogo(ana)).toBeVisible();
    await ana.page.keyboard.press('Escape');
    await expect(dialogo(ana)).toHaveCount(0);
    await expect(botao).toBeFocused();

    await botao.click();
    await ana.page.mouse.click(5, 5);
    await expect(dialogo(ana)).toHaveCount(0);

    await botao.click();
    await dialogo(ana).getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo(ana)).toHaveCount(0);

    // Na sala: pelo cabeçalho e pelo menu "Mais opções".
    await createRoom(ana, `fb-${Date.now()}`);
    await abrir(ana);
    await ana.page.keyboard.press('Escape');
    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    await ana.page.getByRole('menuitem', { name: 'Enviar feedback' }).click();
    await expect(dialogo(ana)).toBeVisible();
    expect(await gravados()).toEqual([]);
  });

  test('relato de bug com imagens: chega ao canal com tudo, e a pessoa vê a confirmação', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    const sala = `fb-envio-${Date.now()}`;
    await createRoom(ana, sala);
    await setName(ana, 'Ana Tester');
    await abrir(ana);

    await expect(dialogo(ana).getByRole('radio', { name: 'Relatar um bug' })).toBeChecked();
    await preencher(ana, { resumo: 'A tela some ao trocar de sala', descricao: 'Entro na sala B e a tela da sala A continua aparecendo por um instante.' });
    await dialogo(ana).getByLabel(/Como reproduzir/).fill('1. Entrar na sala A\n2. Sair\n3. Entrar na B');
    await dialogo(ana).getByLabel(/Como falar com você/).fill('ana#1234');

    await anexar(ana, arquivo('print-1.png', 'png'), arquivo('gif-2.gif', 'gif'), arquivo('foto-3.webp', 'webp'));
    await expect(dialogo(ana).getByRole('list', { name: 'Imagens anexadas' }).getByRole('img')).toHaveCount(3);
    // Remover uma e conferir que a certa saiu.
    await dialogo(ana).getByRole('button', { name: 'Remover imagem 2: gif-2.gif' }).click();
    await expect(dialogo(ana).getByRole('list', { name: 'Imagens anexadas' }).getByRole('img')).toHaveCount(2);

    await enviar(ana);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible({ timeout: 15_000 });
    await expect(ana.page.getByRole('status')).toContainText('Valeu!');

    const [msg, ...resto] = await gravados();
    expect(resto).toEqual([]);
    expect(msg.channel).toBe('1561141729648840754');
    expect(msg.authorization).toBe('Bot token-de-teste');
    const embed = msg.payload.embeds[0];
    expect(embed.title).toBe('🐞 Bug: A tela some ao trocar de sala');
    const campo = (n: string) => embed.fields.find((f: any) => f.name === n)?.value as string;
    expect(campo('Passos para reproduzir')).toContain('3. Entrar na B');
    expect(campo('Contato')).toBe('ana#1234');
    expect(campo('Enviado por')).toMatch(/^Ana Tester \(`guest-/);
    expect(campo('Onde')).toMatch(/^sala · \/\?room=/);
    expect(campo('Tela')).toMatch(/^\d+×\d+$/);
    expect(campo('Imagens')).toBe('2');
    expect(msg.files.map((f: any) => [f.name, f.type])).toEqual([['imagem-1.png', 'image/png'], ['imagem-2.webp', 'image/webp']]);

    // Fechar volta para onde estava.
    await ana.page.getByRole('button', { name: 'Fechar' }).click();
    await expect(ana.page.getByRole('dialog')).toHaveCount(0);
    await expect(ana.page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  });

  test('feedback: some o campo de passos, e o relato sai como feedback', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    await expect(dialogo(ana).getByLabel(/Como reproduzir/)).toBeVisible();
    await dialogo(ana).getByRole('radio', { name: 'Dar um feedback' }).check();
    await expect(dialogo(ana).getByLabel(/Como reproduzir/)).toHaveCount(0);
    await dialogo(ana).getByLabel('Resumo').fill('Fixar duas telas');
    await dialogo(ana).getByLabel('Seu feedback').fill('Seria ótimo fixar duas telas lado a lado no palco.');
    await enviar(ana);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible();
    const [msg] = await gravados();
    expect(msg.payload.embeds[0].title).toBe('💬 Feedback: Fixar duas telas');
    expect(msg.payload.embeds[0].fields.map((f: any) => f.name)).not.toContain('Passos para reproduzir');
    expect(msg.payload.embeds[0].fields.find((f: any) => f.name === 'Onde').value).toMatch(/^lobby · \//);
  });

  test('validação: campos obrigatórios avisam, focam o primeiro e nada é enviado', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await ana.page.goto('/');
    await abrir(ana);
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('resumo');
    await expect(dialogo(ana).getByLabel('Resumo')).toBeFocused();
    await expect(dialogo(ana).getByLabel('Resumo')).toHaveAttribute('aria-invalid', 'true');

    await dialogo(ana).getByLabel('Resumo').fill('Algo quebrou');
    await dialogo(ana).getByLabel('O que aconteceu?').fill('curto');
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('descrição');
    await expect(dialogo(ana).getByLabel('O que aconteceu?')).toBeFocused();
    expect(await gravados()).toEqual([]);
  });

  test('anexos: teto de 5, tipo errado, arquivo grande e repetido são recusados com motivo', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await ana.page.goto('/');
    await abrir(ana);
    const miniaturas = dialogo(ana).getByRole('list', { name: 'Imagens anexadas' }).getByRole('img');

    await anexar(ana, ...Array.from({ length: 6 }, (_, i) => arquivo(`n${i}.png`, 'png', 100 + i)));
    await expect(miniaturas).toHaveCount(5);
    await expect(dialogo(ana).getByRole('alert').filter({ hasText: 'ficou de fora' })).toBeVisible();
    await expect(dialogo(ana).getByRole('button', { name: 'Anexar imagens' })).toBeDisabled();

    await dialogo(ana).getByRole('button', { name: /^Remover imagem/ }).first().click();
    await dialogo(ana).getByRole('button', { name: /^Remover imagem/ }).first().click();
    await expect(miniaturas).toHaveCount(3);

    await anexar(ana, arquivo('nota.txt', 'texto'));
    await expect(dialogo(ana).getByRole('alert')).toContainText('nota.txt');
    await expect(dialogo(ana).getByRole('alert')).toContainText('não é PNG, JPG, GIF ou WebP');
    await anexar(ana, arquivo('enorme.png', 'png', 8 * 1024 * 1024 + 1));
    await expect(dialogo(ana).getByRole('alert')).toContainText('o limite é 8 MB');
    await expect(miniaturas).toHaveCount(3);

    // O mesmo arquivo duas vezes não duplica. O `setInputFiles` do Playwright cria
    // um File novo (e com outro lastModified) a cada chamada; num navegador de
    // verdade, escolher o mesmo arquivo de novo devolve o mesmo — por isso o
    // teste solta o mesmo File duas vezes na área, como um arrastar repetido.
    const soltar = () =>
      ana.page.evaluate((b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'igual.png', { type: 'image/png', lastModified: 1_700_000_000_000 }));
        document.querySelector('input[type=file]')!.parentElement!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, B64.png);
    await soltar();
    await soltar();
    await expect(miniaturas).toHaveCount(4);
  });

  test('anexar colando um print (Ctrl+V) e arrastando para a área', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await ana.page.goto('/');
    await abrir(ana);
    const miniaturas = dialogo(ana).getByRole('list', { name: 'Imagens anexadas' }).getByRole('img');

    await ana.page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'print-colado.png', { type: 'image/png' }));
      document.querySelector('textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, B64.png);
    await expect(miniaturas).toHaveCount(1);

    // Colar TEXTO continua colando texto, sem virar anexo.
    await ana.page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'texto colado');
      document.querySelector('textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(miniaturas).toHaveCount(1);

    await ana.page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'arrastada.gif', { type: 'image/gif' }));
      const zona = document.querySelector('input[type=file]')!.parentElement!;
      zona.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      zona.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, B64.gif);
    await expect(miniaturas).toHaveCount(2);
  });

  test('o Discord falha: aviso claro, o formulário continua preenchido, e tentar de novo funciona', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    await preencher(ana, { resumo: 'Resumo que não pode sumir', descricao: 'Descrição que também não pode sumir.' });
    await anexar(ana, arquivo('print.png', 'png'));

    await modo({ status: 500 });
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('Não consegui entregar');
    await expect(dialogo(ana).getByLabel('Resumo')).toHaveValue('Resumo que não pode sumir');
    await expect(dialogo(ana).getByRole('list', { name: 'Imagens anexadas' }).getByRole('img')).toHaveCount(1);
    await expect(dialogo(ana).getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();

    await modo({ status: 200 });
    await enviar(ana);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible();
  });

  test('o Discord pede para esperar e o limite por endereço: mensagens que dizem o que fazer', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    await preencher(ana);

    await modo({ status: 429, retryAfter: 4 });
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('esperar');
    await modo({ status: 200 });

    for (let i = 0; i < 3; i++) {
      await enviar(ana);
      await ana.page.getByRole('button', { name: 'Enviar outro' }).click();
      await preencher(ana, { resumo: `Relato número ${i + 2}` });
    }
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText(/Tente de novo em \d+ min/);
    await expect(dialogo(ana).getByLabel('Resumo')).toHaveValue('Relato número 4');
  });

  test('enquanto envia: botão e campos travados; fechar cancela e não mostra sucesso', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    await preencher(ana);
    await modo({ status: 200, ms: 2500 });
    await enviar(ana);
    await expect(dialogo(ana).getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await expect(dialogo(ana).getByLabel('Resumo')).toBeDisabled();
    await ana.page.keyboard.press('Escape');
    await expect(ana.page.getByRole('dialog')).toHaveCount(0);
    await ana.page.waitForTimeout(3000);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toHaveCount(0);
  });

  test('"Enviar outro" limpa o formulário; o campo-armadilha não é visível nem alcançável por Tab', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);

    const armadilha = ana.page.locator('input[name=website]');
    await expect(armadilha).toBeHidden().catch(() => {}); // fora da tela conta como não visível ao usuário
    expect(await armadilha.evaluate((el) => el.getBoundingClientRect().x)).toBeLessThan(-1000);
    const focados: string[] = [];
    for (let i = 0; i < 30; i++) {
      await ana.page.keyboard.press('Tab');
      focados.push(await ana.page.evaluate(() => (document.activeElement as HTMLInputElement)?.name ?? ''));
    }
    expect(focados).not.toContain('website');

    await preencher(ana);
    await enviar(ana);
    await ana.page.getByRole('button', { name: 'Enviar outro' }).click();
    await expect(dialogo(ana).getByLabel('Resumo')).toHaveValue('');
    await expect(dialogo(ana).getByLabel('O que aconteceu?')).toHaveValue('');
  });

  test('só pelo teclado: Tab percorre os campos e Enter no formulário envia', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    await dialogo(ana).getByLabel('Resumo').focus();
    await ana.page.keyboard.type('Pelo teclado');
    await ana.page.keyboard.press('Tab');
    await ana.page.keyboard.type('Preenchi tudo sem encostar no mouse.');
    await dialogo(ana).getByLabel('Resumo').focus();
    await ana.page.keyboard.press('Enter'); // Enter num <input> envia o formulário
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible({ timeout: 15_000 });
    expect((await gravados())[0].payload.embeds[0].title).toBe('🐞 Bug: Pelo teclado');
  });

  test('atalhos da sala não disparam com o modal aberto', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await createRoom(ana, `fb-atalho-${Date.now()}`);
    await abrir(ana);
    for (const k of ['f', 'g', 'p', 'm', 'Shift+?']) await ana.page.keyboard.press(k);
    await expect(dialogo(ana)).toBeVisible();
    await expect(ana.page.getByRole('dialog')).toHaveCount(1);
    await ana.page.keyboard.press('Escape');
    // "p" alternaria "Participantes sem vídeo" (marcado por padrão): continua marcado.
    await ana.page.getByRole('button', { name: 'Mais opções' }).click();
    await expect(ana.page.getByRole('menuitemcheckbox', { name: 'Participantes sem vídeo' })).toBeChecked();
  });

  test('acessibilidade (axe) em cada estado do modal, e texto sem resto de código', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    await ana.page.goto('/');
    await abrir(ana);
    expect(await axe(ana), 'vazio').toEqual([]);

    await enviar(ana);
    expect(await axe(ana), 'com erro de validação').toEqual([]);

    await preencher(ana);
    await anexar(ana, arquivo('print.png', 'png'));
    expect(await axe(ana), 'com imagem').toEqual([]);
    await anexar(ana, arquivo('nota.txt', 'texto'));
    expect(await axe(ana), 'com recusa de anexo').toEqual([]);

    const texto = await dialogo(ana).innerText();
    expect(texto).not.toMatch(/\b[a-z]{2,}[A-Z][a-zA-Z]+\b|undefined|\[object|NaN/);

    await enviar(ana);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible();
    expect(await axe(ana), 'sucesso').toEqual([]);
  });

  test('celular (390×844 e 320×568): o modal cabe, rola por dentro, e o botão Enviar é alcançável', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await ana.page.setViewportSize(vp);
      await ana.page.goto('/');
      const botao = ana.page.getByRole('button', { name: 'Enviar feedback' }).first();
      const caixa = (await botao.boundingBox())!;
      expect(Math.min(caixa.width, caixa.height), 'alvo de toque').toBeGreaterThanOrEqual(24);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(vp.width);

      await botao.click();
      await anexar(ana, arquivo('a.png', 'png'), arquivo('b.png', 'png', 400), arquivo('c.gif', 'gif'));
      const cartao = dialogo(ana);
      const r = (await cartao.boundingBox())!;
      expect(r.x, `${vp.width}px: cartão começa fora`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, `${vp.width}px: cartão passa da tela`).toBeLessThanOrEqual(vp.width + 1);
      expect(await ana.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      const enviarBtn = cartao.getByRole('button', { name: 'Enviar', exact: true });
      await enviarBtn.scrollIntoViewIfNeeded();
      await expect(enviarBtn).toBeInViewport();
      await ana.page.keyboard.press('Escape');
    }
  });

  test('conteúdo hostil no relato chega como texto e o formulário não executa nada', async ({ spawn }) => {
    const ana = await spawn('Ana');
    await comEndereco(ana);
    const dialogos: string[] = [];
    ana.page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
    await ana.page.goto('/');
    await abrir(ana);
    await preencher(ana, { resumo: '<img src=x onerror=alert(1)>', descricao: '@everyone <script>alert(2)</script> [link](javascript:alert(3))' });
    await anexar(ana, arquivo('<img src=x onerror=alert(4)>.png', 'png'));
    await expect(dialogo(ana).getByRole('img')).toHaveCount(1);
    await enviar(ana);
    await expect(ana.page.getByRole('dialog', { name: 'Relato enviado' })).toBeVisible();
    expect(dialogos).toEqual([]);
    const [msg] = await gravados();
    expect(msg.payload.allowed_mentions).toEqual({ parse: [] });
    expect(msg.payload.embeds[0].description).not.toContain('@everyone');
    expect(msg.files[0].name).toBe('imagem-1.png'); // o nome enviado nunca vai adiante
  });

  test('servidor sem bot configurado e rede caída: a mensagem diz o que houve e nada se perde', async ({ spawn }) => {
    const ana = await spawn('Ana');
    ana.allow(/Failed to load resource/);
    await ana.page.goto('/');
    await abrir(ana);
    await preencher(ana, { resumo: 'Resumo preservado', descricao: 'Descrição preservada no erro.' });

    await ana.context.route('**/api/feedback', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'O envio de feedback não está configurado neste servidor.', code: 'feedback-off' }) })
    );
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('não está configurado');

    await ana.context.unroute('**/api/feedback');
    await ana.context.route('**/api/feedback', (route) => route.abort('internetdisconnected'));
    await enviar(ana);
    await expect(dialogo(ana).getByRole('alert')).toContainText('Confira sua conexão');
    await expect(dialogo(ana).getByLabel('Resumo')).toHaveValue('Resumo preservado');
    await expect(dialogo(ana).getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
  });
});
