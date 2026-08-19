import type { Metadata } from "next";

import { Capture } from "@/components/capture";

export const metadata: Metadata = { title: "Compartilhar tela" };

/**
 * A aba de captura, que roda FORA do Discord.
 *
 * O endereço desta página é montado pelo servidor, em `shareUrl`, e aponta para
 * o PUBLIC_ORIGIN — nunca para o domínio do sandbox do Discord (RN-PRO-13): a
 * página precisa abrir fora do iframe, senão a captura volta a ser bloqueada.
 */
export default function Share() {
  return (
    <main className="grid min-h-dvh place-items-center p-respiro">
      <Capture />
    </main>
  );
}
