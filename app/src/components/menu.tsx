"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * O menu do "…", ancorado acima do botão que o abriu.
 *
 * O fechamento por `pointerdown` **ignora cliques dentro do próprio menu**
 * (RN-AST-22). `pointerdown` dispara antes de `click`; sem essa guarda o menu
 * saía do DOM e o `click` nunca chegava ao item — era por isso que, no projeto
 * antigo, "parar de assistir" não fazia nada.
 */
export function Menu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="menu"
      // A largura cede à janela. Fixa em 306px, numa janela estreita o menu
      // estoura para os dois lados e o `overflow-hidden` da raiz o corta pela
      // metade — o texto quebra em três linhas e o menu parece esmagado, sem
      // nada indicando que ele está saindo da tela.
      className="absolute bottom-full left-1/2 mb-2 w-[min(340px,calc(100vw-16px))] -translate-x-1/2 rounded-lg border border-linha bg-[#111214] py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
    >
      {children}
    </div>
  );
}

/** Um item que liga e desliga alguma coisa, com a marca à direita. */
export function CheckItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px] text-texto hover:bg-tile focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-acento"
    >
      {label}
      <span
        aria-hidden="true"
        className={
          "grid size-5 shrink-0 place-items-center rounded text-[13px]" +
          (checked ? " bg-acento text-white" : " border border-linha")
        }
      >
        {checked ? "✓" : ""}
      </span>
    </button>
  );
}

/** Um item que faz uma coisa e fecha. */
export function ActionItem({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[15px] text-texto hover:bg-tile focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-acento [&_svg]:size-[18px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:1.8]"
    >
      {children}
      {label}
    </button>
  );
}

export function Separator() {
  return <div role="separator" className="my-1.5 h-px bg-linha" />;
}
