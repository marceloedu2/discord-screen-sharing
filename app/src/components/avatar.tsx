"use client";

import { useState } from "react";

import { colorOf, initialsOf } from "@/lib/name";
import { useDiscord } from "@/contexts/discord";

/**
 * A foto da pessoa, com as iniciais como plano B.
 *
 * Os avatares passam pelo nosso próprio /api/avatar, não pelo CDN do Discord: o
 * CSP da Activity bloqueia cdn.discordapp.com, e o proxy do Discord só repassa
 * domínios mapeados no portal do desenvolvedor — sem esse mapeamento a foto
 * caía sempre nas iniciais. Pela nossa rota a URL é a mesma dentro e fora da
 * Activity (RN-PRO-4).
 */

const SHAPE =
  "grid aspect-square w-[clamp(48px,22%,90px)] place-items-center rounded-full" +
  " text-[clamp(16px,4vw,28px)] font-semibold text-white select-none";

export function Avatar({
  id,
  name,
  avatar = null,
  className = "",
}: {
  id: string;
  name: string;
  /** O hash do avatar no Discord. Ausente em convidado e em quem nunca trocou a foto. */
  avatar?: string | null;
  className?: string;
}) {
  const { api } = useDiscord();
  // Uma URL que falha no meio do caminho cai nas iniciais em vez de deixar o
  // ícone quebrado do navegador dentro do tile.
  const [failed, setFailed] = useState(false);

  if (!avatar || failed) {
    return (
      <span
        className={`${SHAPE} ${className}`}
        style={{ background: colorOf(id) }}
        // A imagem tem alt com o nome; aqui o nome já está escrito ao lado, no
        // rodapé do tile. Repetir faria o leitor de tela dizer duas vezes.
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    // A rota /api/avatar já devolve 128px com cache imutável; o otimizador do
    // Next seria um salto a mais para a mesma imagem, e dentro da Activity um
    // caminho a mais para dar errado.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={api(`/api/avatar/${id}/${avatar}`)}
      alt={name}
      width={128}
      height={128}
      className={`${SHAPE} object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
