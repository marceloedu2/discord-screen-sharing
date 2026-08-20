"use client";

import { useEffect } from "react";

/**
 * O aviso passageiro, no canto superior direito, abaixo do cabeçalho.
 *
 * Ele já foi encostado acima do dock — bem em cima dos controles e do palco,
 * que é onde a pessoa está olhando quando alguém começa a transmitir. O canto
 * é o lugar que menos carrega informação da tela (mesmo raciocínio do selo
 * "AO VIVO" no tile), e "de erro" e "de sistema" compartilham o canto: são a
 * mesma fila, e a pessoa não precisa vasculhar dois lugares para saber por que
 * algo mudou.
 *
 * `role="status"` com `aria-live="polite"` porque é informação que chega sem a
 * pessoa ter pedido: um leitor de tela anuncia quando terminar o que está
 * dizendo, em vez de interromper. Some em 6 s, herdado.
 *
 * Aviso que exige ação não vem por aqui — ele some, e ninguém acha o caminho
 * depois. É o motivo de RF-TRX-5 piscar a engrenagem em vez de mandar um toast.
 */
export const DURACAO_MS = 6000;

export function Toast({
  message,
  error = false,
  action,
  onDismiss,
}: {
  message: string;
  error?: boolean;
  /** Um botão dentro do aviso — "Assistir", por exemplo (RF-AST-15). */
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, DURACAO_MS);
    return () => clearTimeout(t);
    // A mensagem entra na dependência de propósito: um toast novo enquanto o
    // anterior ainda está na tela reinicia a contagem, em vez de herdar o resto
    // do tempo do outro.
  }, [message, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        // `top-[68px]`: os 52px do cabeçalho mais um respiro — não os
        // `right-*`/`top-*` do chip "AO VIVO" do tile, que é outro canto e
        // mora atrás do palco. Em tela cheia o cabeçalho recolhe (h-0), e o
        // aviso sobra com uma folga em cima em vez de colar nele; folga é
        // menos ruim que sobrepor.
        "fixed top-[68px] right-4 z-10 max-w-[min(380px,calc(100vw-32px))]" +
        " rounded-lg border bg-[#111214] px-4 py-[11px] text-[13.5px]/[1.45]" +
        " shadow-[0_8px_24px_rgba(0,0,0,0.45)]" +
        (error ? " border-perigo text-[#ffb3b6]" : " border-linha text-texto")
      }
    >
      {message}
      {action ? (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
          className="ml-3 rounded-full bg-acento px-3 py-1 text-[13px] font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
