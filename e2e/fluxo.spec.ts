import { test, expect, createRoom, joinRoom, shareScreen, videoCount } from './fixtures';

test('criar sala, outra pessoa entra, transmite, assiste e para', async ({ spawn }) => {
  const ana = await spawn('Ana');
  const bia = await spawn('Bia');
  const sala = `sala-${Date.now()}`;

  await createRoom(ana, sala);
  await joinRoom(bia, sala);

  await shareScreen(ana);
  // Assistir é opt-in: Bia vê o convite, não o vídeo.
  const assistir = bia.page.getByRole('button', { name: /^Assistir a tela de/ });
  await expect(assistir).toBeVisible();
  expect(await videoCount(bia)).toBe(0);

  await assistir.click();
  await expect.poll(() => videoCount(bia), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(bia.page.getByRole('button', { name: /^Parar de assistir/ })).toBeVisible();

  await ana.page.getByRole('button', { name: 'Parar de transmitir' }).click();
  await expect(bia.page.getByRole('button', { name: /^Assistir a tela de/ })).toHaveCount(0);
  await expect.poll(() => videoCount(bia)).toBe(0);
});
