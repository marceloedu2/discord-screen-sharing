import type { ReactNode } from "react";

/**
 * A pílula flutuante do dock.
 *
 * Fundo translúcido com desfoque atrás, como os controles de uma call do
 * Discord. As medidas vêm de client/src/style.css (spec 02): 13px peso 500,
 * raio 999px, ícone traçado com stroke-width 2.
 *
 * `list` é o conteúdo que aparece ao passar o mouse — a plateia de um tile,
 * por exemplo. `position: relative` na pílula é o que a ancora.
 */
export function Pill({
  children,
  list,
  className = "",
}: {
  children: ReactNode;
  list?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={
        "group relative inline-flex items-center gap-[7px] rounded-full bg-black/65 px-[13px] py-[7px]" +
        " text-[13px] font-medium text-texto backdrop-blur-[8px]" +
        " [&_svg]:size-[15px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:opacity-75" +
        " [&_svg]:[stroke-width:2] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]" +
        ` ${className}`
      }
    >
      {children}
      {list ? (
        <span className="pointer-events-none absolute bottom-full left-0 mb-2 hidden min-w-max rounded-lg border border-linha bg-black/85 px-3 py-2 backdrop-blur-[10px] group-hover:block">
          {list}
        </span>
      ) : null}
    </span>
  );
}
