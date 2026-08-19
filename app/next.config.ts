import type { NextConfig } from 'next';

/**
 * O app: tudo que o navegador vê. Nenhuma rota daqui toca o estado das salas
 * nem um segredo — o que precisa disso mora no `server/`, e quem separa os dois
 * é a porta de entrada (scripts/proxy.mjs em desenvolvimento, o Caddy em
 * produção), roteando por caminho.
 *
 * Sem rewrites para o servidor, de propósito: a porta de entrada já decide o
 * roteamento antes de o Next ver o pedido, e ela também precisa repassar o
 * `upgrade` do WebSocket — coisa que rewrite de Next não faz. Duas regras de
 * roteamento em dois lugares divergem; uma só, não.
 */
const nextConfig: NextConfig = {
  // O Next escreve AGENTS.md e CLAUDE.md na pasta do app por conta própria.
  // Este repositório mantém os seus na raiz, onde valem para os dois
  // workspaces; um arquivo gerado a cada build entrando no git é ruído.
  agentRules: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            // Uma Activity roda dentro de um iframe em <id>.discordsays.com,
            // que por sua vez está dentro do discord.com. Declarar essa cadeia
            // é o que autoriza o navegador a desenhar a página ali (RN-PRO-1).
            //
            // Se a borda da hospedagem carimbar "X-Frame-Options: SAMEORIGIN"
            // nas respostas, não há nada a fazer daqui: o proxy do Discord
            // repassa o X-Frame-Options da origem e substitui o CSP pelo dele,
            // então o frame-ancestors abaixo nem chega ao navegador. O sintoma
            // é retângulo branco no Discord, log limpo, e o mesmo endereço
            // funcionando quando aberto direto.
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
