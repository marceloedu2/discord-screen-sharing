import Link from "next/link";
import type { ReactNode } from "react";

/**
 * As duas peças que termos e privacidade repetem.
 *
 * O texto das políticas é o mesmo do projeto antigo, palavra por palavra: é
 * texto jurídico, e reescrever no porte trocaria o que foi publicado por algo
 * parecido. O que muda aqui é só a moldura.
 */

/** A caixa de "em resumo", no topo — o que a pessoa lê se ler só uma coisa. */
export function Summary({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-linha bg-painel-fundo px-5 py-4 [&>ul]:mb-0 [&>ul>li:last-child]:mb-0">
      <p className="mb-2 font-semibold">Em resumo:</p>
      {children}
    </div>
  );
}

/** O rodapé, com o link para a outra política e o aviso de marca. */
export function PolicyFooter({ href, label }: { href: "/termos" | "/privacidade"; label: string }) {
  return (
    <footer className="mt-10 border-t border-linha pt-6 text-suave">
      {/* Alvo de toque: 24px de altura. A exceção de WCAG 2.5.8 vale para link
          dentro de frase, e estes dois são navegação solta no rodapé. */}
      <p className="mb-3">
        <Link href={href} className="inline-block py-[3px]">
          {label}
        </Link>{" "}
        ·{" "}
        <Link href="/" className="inline-block py-[3px]">
          Voltar
        </Link>
      </p>
      <p className="mb-0 text-[13.5px]">
        Este projeto não é afiliado ao Discord Inc., nem patrocinado ou endossado por ele. Discord é
        marca registrada da Discord Inc.
      </p>
    </footer>
  );
}
