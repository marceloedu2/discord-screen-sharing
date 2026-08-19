"use client";

import { useEffect } from "react";

/**
 * O aviso passageiro, encostado acima do dock.
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
        "fixed bottom-6 left-1/2 z-10 max-w-[min(440px,calc(100vw-32px))] -translate-x-1/2" +
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
