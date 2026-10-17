/**
 * Um Discord falso, só para a suíte E2E.
 *
 * Faz o papel de `POST /channels/:id/messages` e guarda tudo que chega — quem
 * autorizou, em qual canal, o JSON da mensagem e os arquivos (nome, tipo,
 * tamanho e os primeiros bytes) — para os testes conferirem o que o relay de
 * fato mandou. O que ele devolve é controlado em runtime:
 *
 *   POST /__reset              apaga o que foi gravado e volta ao modo normal
 *   POST /__mode {status, ms}  próximas respostas: status fixo, com atraso opcional
 *   GET  /__requests           o que chegou
 */
import http from 'node:http';

const PORT = Number(process.env.DISCORD_MOCK_PORT) || 4999;

let requests = [];
let mode = { status: 200, ms: 0, retryAfter: 2 };

const readAll = (req) =>
  new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/__health') return send(200, { ok: true });
  if (url.pathname === '/__reset' && req.method === 'POST') {
    requests = [];
    mode = { status: 200, ms: 0, retryAfter: 2 };
    return send(200, { ok: true });
  }
  if (url.pathname === '/__mode' && req.method === 'POST') {
    mode = { ...mode, ...JSON.parse((await readAll(req)).toString() || '{}') };
    return send(200, mode);
  }
  if (url.pathname === '/__requests') return send(200, requests);

  const match = url.pathname.match(/^\/channels\/(\d+)\/messages$/);
  if (!match || req.method !== 'POST') return send(404, { message: 'Unknown Channel', code: 10003 });

  const body = await readAll(req);
  const record = {
    channel: match[1],
    authorization: req.headers.authorization ?? null,
    contentType: req.headers['content-type'] ?? '',
    bytes: body.length,
    payload: null,
    files: [],
  };

  try {
    const form = await new Request('http://mock/', {
      method: 'POST',
      headers: { 'content-type': record.contentType },
      body,
    }).formData();
    const payload = form.get('payload_json');
    record.payload = typeof payload === 'string' ? JSON.parse(payload) : null;
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') continue;
      const bytes = new Uint8Array(await value.arrayBuffer());
      record.files.push({ field: key, name: value.name, type: value.type, size: value.size, head: Buffer.from(bytes.slice(0, 12)).toString('hex') });
    }
  } catch (err) {
    record.parseError = String(err);
  }
  requests.push(record);

  if (mode.ms) await new Promise((r) => setTimeout(r, mode.ms));
  if (mode.status === 200) return send(200, { id: String(Date.now()), channel_id: match[1] });
  if (mode.status === 429) return send(429, { message: 'You are being rate limited.', retry_after: mode.retryAfter }, { 'Retry-After': String(mode.retryAfter) });
  return send(mode.status, { message: 'erro simulado', code: mode.status });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[discord-mock] em http://127.0.0.1:${PORT}`));
