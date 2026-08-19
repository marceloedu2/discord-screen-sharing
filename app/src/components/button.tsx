import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * O botão do dock.
 *
 * Variantes explícitas em vez de booleanos soltos: no CSS antigo eram classes
 * combináveis (`.btn.go.wide`), e a combinação que ninguém quis — primário e
 * encerrar ao mesmo tempo — só não acontecia por disciplina. Aqui o tipo
 * recusa.
 *
 * Medidas herdadas de client/src/style.css (spec 02): altura 46px, largura
 * mínima 46px, raio 999px, texto 14px/1 peso 500. O ícone é SVG traçado com
 * stroke-width 1.8, que é o que casa com o conjunto do Discord (RN-UI-3) —
 * nada de biblioteca de ícones preenchidos.
 */
type Variante = "neutro" | "primario" | "encerrar" | "atencao";

const VARIANTES: Record<Variante, string> = {
  // Padrão do dock.
  neutro: "bg-tile hover:not-disabled:bg-tile-hover",
  // Ação principal disponível (`.btn.go`).
  primario: "bg-acento text-white hover:not-disabled:bg-acento-hover",
  // Você está transmitindo, ou está saindo (`.btn.live`, `.btn.leave`). Vermelho
  // e por último, como o encerrar chamada do Discord.
  encerrar: "bg-perigo text-white hover:not-disabled:bg-perigo-hover",
  // Algo pedido não pôde ser feito e a saída está atrás deste botão. Amarelo,
  // não vermelho: é um convite a clicar, não um erro (RF-TRX-5).
  atencao: "bg-atencao text-[#111214] hover:not-disabled:bg-atencao-hover",
};

const BASE = [
  // relative ancora a dica que aparece ao passar o mouse.
  "relative inline-flex items-center justify-center gap-2",
  "h-[46px] min-w-[46px] rounded-full border-0",
  "text-[14px]/none font-medium transition-colors duration-150",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto",
  "disabled:bg-transparent disabled:text-suave disabled:cursor-default",
  "[&_svg]:size-[21px] [&_svg]:fill-none [&_svg]:stroke-current",
  "[&_svg]:[stroke-width:1.8] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]",
].join(" ");

export function Button({
  variant = "neutro",
  wide = false,
  className = "",
  children,
  ...resto
}: {
  variant?: Variante;
  /** `.btn.wide` — respiro maior nas laterais quando o rótulo é longo. */
  wide?: boolean;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${BASE} ${VARIANTES[variant]} ${wide ? "px-5" : "px-[14px]"} ${className}`}
      {...resto}
    >
      {children}
    </button>
  );
}
