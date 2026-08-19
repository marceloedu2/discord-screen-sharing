import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sala de Tela",
    template: "%s · Sala de Tela",
  },
  description:
    "Mostre sua tela para quem está na mesma call do Discord. Uma pessoa compartilha, todo mundo assiste sem sair do Discord.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
