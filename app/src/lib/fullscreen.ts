/**
 * Screen cheia de verdade quando dá, e por layout quando não dá.
 *
 * Fora do Discord a Fullscreen API existe e é o que a pessoa espera — é o mesmo
 * que o F11 do navegador faz. Dentro da Activity ela é **negada por Permissions
 * Policy** (RN-UI-8): o iframe não recebe `allow="fullscreen"`, e chamar
 * `requestFullscreen()` ali rejeita a promessa sem nada acontecer na tela.
 *
 * Por isso os dois caminhos, nesta ordem. O de layout (RN-AST-13) colapsa a
 * grade para uma coluna e zera o padding — funciona nos dois contextos e não
 * depende de permissão nenhuma.
 */

/** @returns true se a API nativa assumiu; false quando resta o layout. */
export async function enterNative(): Promise<boolean> {
  if (!document.documentElement.requestFullscreen) return false;
  try {
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function exitNative(): Promise<boolean> {
  if (!document.fullscreenElement) return false;
  try {
    await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

export const nativeActive = () => Boolean(document.fullscreenElement);

/** Avisa quando o navegador entra ou sai por conta própria — o `Esc`, por exemplo. */
export function listen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}
