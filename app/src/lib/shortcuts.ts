import { useEffect } from 'react';

/**
 * O conjunto mínimo de atalhos (RF-UI-1), sem remapeamento.
 *
 *   Esc    fecha modal / sai da tela cheia   (já existe, tratado por quem abre)
 *   F      alterna tela cheia
 *   M      silencia e devolve o som geral
 *   G      alterna Grid ↔ Foco
 *   P      recolhe / mostra as pessoas
 *   1–4    põe a tela daquele slot no palco
 *   ?      abre a lista de atalhos
 *
 * Nenhum atalho é o **único** caminho para uma ação (RN-UI-10): dentro da
 * Activity o cliente do Discord captura alguns antes de chegarem ao iframe, e o
 * que sobrar funciona. Todos têm botão visível.
 */
export interface Shortcuts {
  fullscreen: () => void;
  mute: () => void;
  mode: () => void;
  people: () => void;
  toStage: (index: number) => void;
  help: () => void;
}

export function useShortcuts(active: boolean, actions: Shortcuts): void {
  useEffect(() => {
    if (!active) return;

    const onKey = (e: KeyboardEvent) => {
      // Atalho nunca dispara com foco em campo de texto (RN-UI-9): o apelido
      // tem "M" e "F" como qualquer palavra.
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      // Nem com modal aberto — o Esc daquele modal é quem manda ali.
      if (document.querySelector('[role="dialog"]')) return;
      // Combinações com modificador são do navegador e do sistema.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === 'f') actions.fullscreen();
      else if (key === 'm') actions.mute();
      else if (key === 'g') actions.mode();
      else if (key === 'p') actions.people();
      else if (key === '?') actions.help();
      else if (key >= '1' && key <= '4') actions.toStage(Number(key) - 1);
      else return;

      e.preventDefault();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, actions]);
}
