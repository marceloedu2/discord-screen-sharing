/**
 * Espelho do avatar do Discord.
 *
 * O CSP da Activity bloqueia cdn.discordapp.com, e o proxy do Discord só
 * repassa domínios mapeados no portal do desenvolvedor. Servindo pelo nosso
 * próprio /api, a mesma URL funciona dentro e fora da Activity, sem depender
 * de configuração que ninguém lembra de fazer (RN-PRO-4).
 *
 * Mora no app, e não no server/, porque é a única rota que não toca o estado
 * das salas nem um segredo — no projeto antigo ela mantinha um cache de 200
 * imagens dentro do mesmo processo que faz o relay de vídeo, disputando memória
 * com o backpressure dos sockets. Aqui o cache é o do próprio Next: a chave
 * inclui o hash, que muda quando a pessoa troca a foto, então nada envelhece
 * errado.
 */

// O id e o hash são validados no formato exato do Discord: sem isso a rota
// viraria um proxy aberto, com o servidor buscando qualquer URL que pedissem
// (RN-PRO-9).
const ID = /^[0-9]{15,21}$/;
const HASH = /^(a_)?[0-9a-f]{32}$/;

const UM_DIA = 86_400;

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/avatar/[id]/[hash]">
): Promise<Response> {
  const { id, hash } = await ctx.params;
  if (!ID.test(id) || !HASH.test(hash)) return new Response(null, { status: 400 });

  try {
    const upstream = await fetch(`https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`, {
      // O CDN fora do ar não pode virar uma sala que não abre.
      signal: AbortSignal.timeout(5000),
      next: { revalidate: UM_DIA },
    });
    if (!upstream.ok) return new Response(null, { status: 404 });

    return new Response(await upstream.arrayBuffer(), {
      headers: {
        // Tipo fixo, não o que o upstream disser: pedimos .png e é png que sai
        // (RN-PRO-10).
        "Content-Type": "image/png",
        // O hash muda quando a pessoa troca a foto, então a URL é imutável.
        "Cache-Control": `public, max-age=${UM_DIA}, immutable`,
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
