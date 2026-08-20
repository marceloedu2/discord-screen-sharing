import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Em tela cheia, os controles somem depois de um tempo parado (RF-UI-2).
 *
 * É a contrapartida de `RN-UI-5a`: como a barra flutua **sobre** a imagem, ela
 * cobre a faixa de baixo do que está sendo mostrado. Sumir devolve essa faixa
 * quando ninguém está mexendo, e voltar a qualquer movimento ou tecla.
 *
 * Fora de tela cheia nunca some (`RN-UI-12`): ali a barra convive com a grade,
 * e recolher mudaria a altura do conteúdo a cada movimento do mouse.
 */
const IDLE_MS = 3000;

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * "Esta pessoa pediu menos movimento?", assinado em vez de lido num efeito.
 *
 * Um elemento que aparece e some é movimento, e a preferência pode mudar com a
 * página aberta.
 */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}

export function useControlsVisible(fullscreen: boolean): boolean {
  const reduced = useReducedMotion();
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!fullscreen || reduced) return;

    let timer: ReturnType<typeof setTimeout>;

    const postpone = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Sumir sob o foco de quem navega por Tab é perder a pessoa dentro da
        // própria interface (RN-UI-11), então o foco dentro da barra a segura.
        setIdle(!document.activeElement?.closest('[data-controls]'));
      }, IDLE_MS);
    };

    postpone();
    for (const event of ['pointermove', 'keydown', 'pointerdown'] as const) {
      window.addEventListener(event, postpone);
    }

    return () => {
      clearTimeout(timer);
      for (const event of ['pointermove', 'keydown', 'pointerdown'] as const) {
        window.removeEventListener(event, postpone);
      }
    };
  }, [fullscreen, reduced]);

  // Derivado, e não guardado: fora de tela cheia e com movimento reduzido a
  // resposta é sempre "visível", e escrever isso num estado exigiria um efeito
  // que dispara re-render em cascata a cada troca de modo.
  return !fullscreen || reduced || !idle;
}
