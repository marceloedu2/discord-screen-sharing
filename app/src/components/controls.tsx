"use client";

import type { ReactNode } from "react";

/**
 * A barra de controles, flutuando sobre a tela ao centro de baixo.
 *
 * É a geometria do Discord: os controles não ocupam faixa própria no layout —
 * eles pairam sobre o vídeo, agrupados numa pílula, com o encerrar em vermelho
 * e redondo, separado do grupo.
 *
 * Isto **diverge de RN-UI-5**, que mandava o dock ocupar espaço para não comer
 * a parte de baixo da tela transmitida. A fidelidade ao Discord (RNF-UI-1)
 * ganhou: a Activity roda dentro do cliente dele, e uma barra em lugar
 * diferente do esperado lê como site de terceiro. O custo é real e conhecido —
 * a faixa inferior da tela compartilhada fica coberta enquanto o ponteiro se
 * move.
 */
export function ControlBar({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto flex items-center gap-2">{children}</div>
  );
}

/** O grupo de ações, numa pílula só, como o do Discord. */
export function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-painel/95 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-[8px]">
      {children}
    </div>
  );
}

/**
 * Um botão redondo da barra.
 *
 * `state` segue as cores que o Discord usa: neutral é escuro, `active` é verde
 * (a ação está ligada) e `end` é o vermelho do desligar chamada.
 */
export function RoundButton({
  label,
  state = "neutral",
  wide = false,
  onClick,
  children,
}: {
  label: string;
  state?: "neutral" | "active" | "end";
  wide?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const colors = {
    neutral: "bg-tile text-texto hover:bg-tile-hover",
    active: "bg-vivo text-white hover:brightness-110",
    end: "bg-perigo text-white hover:bg-perigo-hover",
  }[state];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "grid h-[46px] place-items-center rounded-full transition-colors" +
        ` ${wide ? "min-w-[62px] px-4" : "w-[46px]"} ${colors}` +
        " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto" +
        " [&_svg]:size-[21px] [&_svg]:fill-none [&_svg]:stroke-current" +
        " [&_svg]:[stroke-width:1.8] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]"
      }
    >
      {children}
    </button>
  );
}

/**
 * Os ícones, em SVG traçado com stroke-width 1.8 (RN-UI-3).
 *
 * É o que casa com o conjunto do Discord — nada de biblioteca de ícones
 * preenchidos.
 */
export const Icon = {
  Screen: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  Stop: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M4 3l16 16" />
    </svg>
  ),
  Camera: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10.5 22 7v10l-6-3.5" />
    </svg>
  ),
  CameraOff: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10.5 22 7v10l-6-3.5M4 3l16 16" />
    </svg>
  ),
  Sound: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </svg>
  ),
  Muted: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9l4 6M21 9l-4 6" />
    </svg>
  ),
  Leave: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11c5-4 13-4 18 0l-2.5 3-3.5-1v-2.5a12 12 0 0 0-6 0V13l-3.5 1L3 11z" />
    </svg>
  ),
  More: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  ),
  People: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Popout: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  ),
  Fullscreen: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
  ExitFullscreen: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  ),
};
