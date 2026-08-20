import { Suspense } from "react";
import type { Metadata } from "next";

import { DiscordProvider } from "@/contexts/discord";
import "./globals.css";

/**
 * Renderização sempre no servidor, nunca no build.
 *
 * Sem isto o Next pré-renderiza a página e o DISCORD_CLIENT_ID é lido uma vez
 * só, na hora de construir — o que traz de volta exatamente o problema que o
 * antigo GET /api/config existia para resolver: trocar a credencial passaria a
 * exigir um build novo, e esquecer o build não daria erro nenhum. A atividade
 * abriria normalmente e só quebraria no login, longe da causa.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Sala de Tela",
    template: "%s · Sala de Tela",
  },
  description:
    "Mostre sua tela para quem está na mesma call do Discord. Uma pessoa compartilha, todo mundo assiste sem sair do Discord.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // RN-SES-4: o Client ID chega ao navegador pelo HTML, não pelo bundle. O `||`
  // é de propósito: variável vazia no .env chega como string vazia, e o
  // contrato é null para "não configurado".
  const room: RoomWindowData = { clientId: process.env.DISCORD_CLIENT_ID || null };

  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/*
          O único dangerouslySetInnerHTML autorizado do projeto. RN-UI-6 proíbe
          o resto: todo texto vindo de terceiro entra como texto, nunca como
          HTML. Aqui a source é o nosso próprio .env, e ainda assim o "<" vai
          escapado — é o que impede um valor com "</script>" de fechar a tag.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ROOM__=${JSON.stringify(room).replace(/</g, "\\u003c")}`,
          }}
        />

        {/* useSearchParams suspende; o limite mora aqui para não drag a página inteira. */}
        <Suspense>
          <DiscordProvider>{children}</DiscordProvider>
        </Suspense>
      </body>
    </html>
  );
}
