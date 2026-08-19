/**
 * Arranque do servidor de tempo real.
 *
 * Este processo não serve página nenhuma: quem faz isso é o `app/`. Aqui ficam
 * o relay WebSocket, o estado das salas em memória e as rotas que tocam um
 * segredo. Na frente dos dois há um roteador por caminho — o Caddy em
 * produção, `scripts/proxy.mjs` em desenvolvimento — que manda /ws, /api e
 * /auth para cá e o resto para o app. É o que mantém tudo na mesma origem: um
 * URL Mapping só no portal do Discord, e nenhum CORS.
 */
import { createServer } from 'node:http';

import { createRouter } from './http.ts';
import { routes } from './api.ts';
import { mountRelay } from './relay.ts';
import { DISCORD_CLIENT_ID, PORT, PUBLIC_ORIGIN } from './config.ts';

// O roteador é montado uma vez, não por pedido: a tabela é fixa e remontá-la
// a cada requisição só gera lixo.
const handle = createRouter(routes);

const server = createServer((req, res) => {
  void handle(req, res);
});
mountRelay(server);

// Porta ocupada é o tropeco mais comum aqui: basta um `npm run dev` esquecido
// numa janela. Sem isto, o Node cospe um stack trace que não diz nem qual é o
// problema nem o que fazer.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;

  console.error('');
  console.error(`  A porta ${PORT} já está sendo usada.`);
  console.error('  Quase sempre é outra janela deste mesmo projeto aberta.');
  console.error('  Feche a outra e tente de novo, ou mude RELAY_PORT no .env.');
  console.error('');
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('');
  console.log(`  Servidor de tempo real na porta ${PORT}`);
  console.log(`  Abra o site em  ${PUBLIC_ORIGIN}  — é o app que atende ali.`);
  console.log('');

  if (DISCORD_CLIENT_ID) {
    console.log(`  Discord: ligado · aplicação ${DISCORD_CLIENT_ID}`);
    console.log(`  Redirect que precisa estar no portal: ${PUBLIC_ORIGIN}/auth/callback`);
  } else {
    console.log('  Discord: desligado (só navegador).');
  }

  // Erro fácil de cometer e difícil de diagnosticar: com PUBLIC_ORIGIN
  // apontando para o proxy, a página de captura abre dentro do sandbox do
  // Discord e getDisplayMedia volta a ser bloqueado (`RN-PRO-1`, .claude/specs/03).
  if (PUBLIC_ORIGIN.includes('discordsays.com')) {
    console.error('');
    console.error('  ERRO: o endereço público aponta para o proxy do Discord.');
    console.error('  A tela de captura precisa abrir fora do Discord, senão a captura é bloqueada.');
  }

  console.log('');
});

// Ctrl+C precisa fechar os sockets abertos: sem isto o processo fica pendurado
// esperando um relay que nunca termina sozinho.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
