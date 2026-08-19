"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * O modal do produto.
 *
 * Fecha no fundo e no `Esc` — os dois, porque o clique fora é o gesto que a
 * maioria tenta e a tecla é o que quem usa teclado espera. Dentro da Activity o
 * `Esc` pode ser capturado pelo cliente do Discord antes de chegar até nós, e é
 * por isso que o fundo clicável não é opcional.
 *
 * O foco entra no cartão ao abrir e volta para onde estava ao fechar: sem isso,
 * quem navega por `Tab` continua percorrendo a página atrás do modal.
 */
export function Modal({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    card.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      // `fixed`, e não `absolute` como no CSS antigo: ali o modal vivia dentro
      // do container da sala e o dock ficava por cima dele. Cobrindo a janela
      // inteira, o modal é a única coisa clicável enquanto está aberto — que é
      // o que "modal" quer dizer.
      className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-5 backdrop-blur-[3px]"
      // O fundo fecha; o cartão não. Sem o alvo exato, um clique que começa
      // dentro e termina fora fecharia o modal no meio de uma seleção.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-full w-[min(400px,100%)] overflow-y-auto rounded-xl border border-linha bg-painel p-[22px] shadow-[0_16px_48px_rgba(0,0,0,0.6)] focus:outline-none"
      >
        <h2 className="mb-1.5 text-[19px] font-semibold text-texto">{title}</h2>
        {sub ? <p className="mb-5 text-[13.5px]/[1.5] text-suave">{sub}</p> : null}
        {children}
      </div>
    </div>
  );
}
