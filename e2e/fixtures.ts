import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Uma pessoa na sala: contexto próprio (storage separado = identidade
 * separada), página, e tudo que o console e a rede reclamaram.
 *
 * Erro de console e exceção não tratada reprovam o teste por padrão — é o
 * mesmo critério de `npm run test`, aplicado aos fluxos que só existem com
 * gente transmitindo e assistindo.
 */
export interface User {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
  /** Entradas esperadas e já tratadas; o resto reprova. */
  allow: (pattern: RegExp) => void;
}

// Ruído conhecido e inofensivo: o transmissor sintético do relay-fuzz não manda
// vídeo decodificável, e o Next em dev avisa de coisas que produção não tem.
const NOISE = [/Download the React DevTools/, /\[HMR\]/, /Fast Refresh/, /favicon/i];

export const test = base.extend<{ spawn: (name: string) => Promise<User> }>({
  spawn: async ({ browser }, use) => {
    const users: User[] = [];
    await use(async (name) => {
      const user = await makeUser(browser, name);
      users.push(user);
      return user;
    });
    for (const u of users) {
      // Sai de propósito: a última pessoa dissolve a sala, e o teto de 20
      // salas por instância não se acumula entre testes.
      await u.page
        .getByRole('button', { name: 'Sair da sala' })
        .click({ timeout: 1500 })
        .catch(() => {});
      await u.context.close().catch(() => {});
    }
    for (const u of users) {
      expect(u.errors, `erros de console/página de ${u.name}`).toEqual([]);
    }
  },
});

async function makeUser(browser: Browser, name: string): Promise<User> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  const errors: string[] = [];
  const allowed: RegExp[] = [...NOISE];

  const record = (text: string) => {
    if (!allowed.some((re) => re.test(text))) errors.push(text);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') record(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => record(`pageerror: ${e.message}`));

  // Guarda todo WebSocket aberto, para os testes derrubarem a conexão no meio.
  await context.addInitScript(() => {
    const w = window as unknown as { __sockets: WebSocket[] };
    w.__sockets = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        w.__sockets.push(this);
      }
    } as typeof WebSocket;
  });

  return { name, context, page, errors, allow: (re) => allowed.push(re) };
}

export { expect };

// ------------------------------------------------------------------ ações

export async function setName(user: User, name: string) {
  await user.page.getByRole('button', { name: /Seu perfil/ }).click();
  await user.page.getByLabel('Nome exibido').fill(name);
  await user.page.getByRole('button', { name: 'Salvar' }).click();
  await expect(user.page.getByRole('dialog')).toHaveCount(0);
}

export async function createRoom(user: User, room: string, password?: string) {
  const { page } = user;
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar sala', exact: true }).click();
  await page.locator('#roomName').fill(room);
  if (password) await page.locator('#roomPassword').fill(password);
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
}

/** O botão da sala no lobby; salas trancadas ganham o prefixo 🔒. */
export const roomButton = (page: Page, room: string) =>
  page.getByRole('button', { name: new RegExp(`^(🔒 )?${room} de `) });

export async function joinRoom(user: User, room: string, password?: string) {
  const { page } = user;
  await page.goto('/');
  await roomButton(page, room).click();
  if (password) {
    await page.locator('#enterPassword').fill(password);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
}

export const shareScreen = async (user: User) => {
  await user.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
  await user.page.getByRole('dialog').getByRole('button', { name: 'Compartilhar tela' }).click();
  await expect(user.page.getByRole('button', { name: 'Parar de transmitir' })).toBeVisible();
};

export const shareCamera = async (user: User) => {
  await user.page.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(user.page.getByRole('button', { name: 'Desligar câmera' })).toBeVisible();
};

/** Derruba todos os sockets da página, como uma queda de rede. */
export const dropSockets = (user: User) =>
  user.page.evaluate(() => {
    const w = window as unknown as { __sockets: WebSocket[] };
    w.__sockets.forEach((s) => s.close());
  });

/** Quantos canvas de vídeo com quadro desenhado há na página. */
export const videoCount = (user: User) =>
  user.page.evaluate(
    () => [...document.querySelectorAll('canvas')].filter((c) => c.width > 2 && c.height > 2).length
  );

/** O primeiro vídeo desenhado está mudando? (a captura sintética anima sem parar) */
export async function isPlaying(user: User, ms = 700): Promise<boolean> {
  const sample = () =>
    user.page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].find((x) => x.width > 2 && x.height > 2);
      return c ? c.toDataURL('image/png').length + ':' + c.toDataURL('image/png').slice(-200) : null;
    });
  const a = await sample();
  await user.page.waitForTimeout(ms);
  const b = await sample();
  return a !== null && b !== null && a !== b;
}

export const invite = (user: User) => user.page.getByRole('button', { name: /^Assistir a tela de/ });
export const stopWatching = (user: User) => user.page.getByRole('button', { name: /^Parar de assistir/ });
