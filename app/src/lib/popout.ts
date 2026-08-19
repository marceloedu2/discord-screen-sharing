/**
 * A janela destacada (RF-AST-19), com a Document Picture-in-Picture API.
 *
 * Serve para quem quer assistir enquanto trabalha em outra coisa: a janela é
 * sempre-no-topo, coisa que `window.open` não faz. Por isso **não há fallback**
 * (RN-AST-37): uma janela comum não resolve o problema que a pessoa tinha, e
 * oferecer uma solução que não soluciona é pior do que não oferecer o botão.
 *
 * O canvas é um nó só (RN-AST-17), então destacar o **move** para a janela — o
 * palco passa a mostrar que ele está lá. Duplicar o decodificador para pintar
 * nos dois lugares dobraria CPU por nada (RN-AST-36).
 */

/** Sem suporte — ou negada por Permissions Policy na Activity (RN-AST-38). */
export const supported = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.documentPictureInPicture);

export async function popOut(
  canvas: HTMLCanvasElement,
  onClose: () => void
): Promise<Window | null> {
  const api = window.documentPictureInPicture;
  if (!api) return null;

  const pip = await api.requestWindow({
    width: Math.min(960, canvas.width || 640),
    height: Math.min(540, canvas.height || 360),
  });

  // A janela nasce sem folha de estilo nenhuma: o fundo preto e o encaixe do
  // canvas vão à mão, senão a imagem aparece num campo branco com barras.
  const style = pip.document.createElement('style');
  style.textContent =
    'html,body{margin:0;height:100%;background:#000;display:grid;place-items:center}' +
    'canvas{max-width:100%;max-height:100%}';
  pip.document.head.append(style);
  pip.document.body.append(canvas);

  pip.addEventListener('pagehide', onClose);
  return pip;
}
