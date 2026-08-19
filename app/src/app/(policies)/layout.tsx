import type { ReactNode } from "react";

/**
 * A moldura de termos e privacidade.
 *
 * Existe como grupo de rotas por causa de RNF-UI-2: a sala não rola — quem rola
 * é a lateral do palco —, e o `overflow: hidden` que garante isso não pode
 * valer para texto longo. No projeto antigo a separação era física, uma folha
 * de estilo à parte servida de public/; aqui é escopo de layout, que é o que a
 * spec pede. O `flex-1 overflow-y-auto` abaixo é a rolagem desta parte do
 * produto, e continua funcionando quando a sala fechar o `body`.
 *
 * A tipografia vem por seletor de descendente em vez de classe em cada tag: são
 * quase quatrocentas linhas de texto entre as duas páginas, e repetir a mesma
 * classe em cada parágrafo esconderia o conteúdo dentro da marcação.
 */
const TIPOGRAFIA = [
  "[&_h2]:mt-8 [&_h2]:mb-2.5 [&_h2]:text-[17px]/[1.35] [&_h2]:font-semibold",
  "[&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-suave",
  "[&_p]:mb-3 [&_li]:mb-3 [&_li]:marker:text-suave",
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-[22px]",
  "[&_a]:text-acento-texto [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline",
  "[&_code]:rounded [&_code]:bg-painel-fundo [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13.5px]",
  "[&_strong]:font-semibold [&_strong]:text-texto",
].join(" ");

export default function LayoutPoliticas({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 pt-8 pb-16">
      {/* Medida de linha: acima de ~75 caracteres o olho perde a linha seguinte
          ao goBack da direita para a esquerda. */}
      <main
        className={`mx-auto max-w-[720px] rounded-xl border border-line bg-painel px-6 py-9 leading-[1.7] text-suave sm:px-10 ${TIPOGRAFIA}`}
      >
        {children}
      </main>
    </div>
  );
}
