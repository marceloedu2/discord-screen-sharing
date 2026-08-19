/**
 * A porta de entrada em desenvolvimento.
 *
 * Em produção quem faz este papel é o Caddy (infra/Caddyfile). Aqui existe uma
 * versão em Node para não exigir nada instalado além do próprio Node.
 *
 * Por que uma porta de entrada, e não os rewrites do Next:
 *
 * 1. Rewrite de Next não repassa o `upgrade` do WebSocket. O /ws é o produto
 *    inteiro deste projeto, então isso sozinho já decide.
 * 2. O Discord aceita um URL Mapping por prefixo. Com o app e o servidor em
 *    portas diferentes e nada na frente, seriam dois mapeamentos para manter
 *    em dia à mão no portal.
 * 3. Mesma origem para tudo significa nenhum CORS, e um PUBLIC_ORIGIN só.
 *
 * O roteamento é o mesmo do Caddy, lido de infra/server-paths.mjs.
 */
import http from 'node:http';
import net from 'node:net';

import { belongsToServer } from '../infra/server-paths.mjs';

const PORT = Number(process.env.PORT) || 3000;
const APP_PORT = Number(process.env.APP_PORT) || 3100;
const RELAY_PORT = Number(process.env.RELAY_PORT) || 3101;

const target = (path) => (belongsToServer(path) ? RELAY_PORT : APP_PORT);

const server = http.createServer((req, res) => {
  const port = target(new URL(req.url, 'http://internal').pathname);

  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    }
  );

  // Sem isto, o app ainda não ter subido vira um pedido pendurado até o
  // timeout do navegador, sem nada no terminal explicando o silêncio.
  upstream.on('error', (err) => {
    console.error(`[proxy] ${req.method} ${req.url} → :${port} — ${err.code || err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Nada atendendo na porta ${port}. Ele ainda está subindo?`);
  });

  req.pipe(upstream);
});

/**
 * O upgrade do WebSocket, na unha.
 *
 * Não dá para usar http.request aqui: uma vez que o upstream responde 101, o
 * que trafega deixa de ser HTTP e vira um cano de bytes nos dois sentidos.
 * Repassamos o handshake e depois só emendamos os dois sockets.
 */
server.on('upgrade', (req, socket, head) => {
  const port = target(new URL(req.url, 'http://internal').pathname);
  const upstream = net.connect(port, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`);
    upstream.write(`GET ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
    // O `head` é o que o cliente já mandou junto do handshake. Esquecer dele
    // perde o primeiro quadro, e o sintoma é uma transmissão que começa
    // sempre com um engasgo.
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, () => {
  console.log(`  Porta de entrada em http://localhost:${PORT}`);
  console.log(`    app    → :${APP_PORT}`);
  console.log(`    relay  → :${RELAY_PORT}  (/ws, /api/rooms, /api/session, /auth)`);
});
