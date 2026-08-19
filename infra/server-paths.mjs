/**
 * Quais caminhos pertencem ao servidor de tempo real, e não ao app.
 *
 * Uma lista só, num arquivo só. A porta de entrada de desenvolvimento
 * (scripts/proxy.mjs) importa daqui; o Caddyfile repete as mesmas entradas à
 * mão, porque Caddy não lê JavaScript — e é por isso que elas estão listadas
 * aqui em vez de espalhadas: quando uma rota nova nascer, os dois lugares que
 * precisam saber estão a um `grep` de distância.
 *
 * Tudo que não casar com isto vai para o app — inclusive /api/avatar, que é
 * rota do Next.
 */
export const SERVER_PATHS = [
  '/ws', // o relay — o único caminho que precisa do upgrade de WebSocket
  '/api/token',
  '/api/session',
  '/api/session-dev',
  '/api/session-guest',
  '/api/rooms/',
  '/api/health',
  '/auth/',
];

/**
 * O prefixo /.proxy/ do Discord é removido antes de decidir: dentro da
 * atividade todo caminho chega com ele na frente, e roteá-lo pelo caminho cru
 * mandaria /.proxy/api/rooms/list para o app, que devolveria 404.
 */
export function belongsToServer(path) {
  const clean = path.replace(/^\/\.proxy/, '') || '/';
  return SERVER_PATHS.some((p) => (p.endsWith('/') ? clean.startsWith(p) : clean === p));
}
