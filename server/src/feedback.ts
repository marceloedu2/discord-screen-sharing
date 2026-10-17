/**
 * Relatos de bug e feedback, enviados ao canal do Discord (spec 12).
 *
 * Mora no servidor, e não no app, pelo mesmo critério de tudo aqui: quem fala
 * com a API do Discord com o token do bot é este processo. O token nunca chega
 * ao navegador — o formulário só conhece `/api/feedback`.
 *
 * A rota é "crua" (ver `createRouter`): o corpo é multipart e carrega imagens,
 * então o leitor de JSON de 64 KB não serve. O teto de tamanho é imposto aqui,
 * em fluxo, antes de qualquer arquivo virar memória.
 */
import { Readable, Transform } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import { fail, json } from './http.ts';
import type { Handler } from './http.ts';
import { verify } from './tokens.ts';
import {
  DISCORD_API_BASE,
  DISCORD_BOT_TOKEN,
  FEEDBACK_CHANNEL_ID,
  FEEDBACK_GUILD_ID,
} from './config.ts';

// ------------------------------------------------------------------ limites
// Espelhados em app/src/lib/feedback.ts — o cliente confere antes de enviar
// para a pessoa não esperar um upload só para ouvir "grande demais", mas quem
// vale é este arquivo.

const KINDS = ['bug', 'feedback'] as const;
type Kind = (typeof KINDS)[number];

const LIMITS = {
  title: { min: 3, max: 100 },
  description: { min: 10, max: 1500 },
  steps: { max: 1000 },
  contact: { max: 100 },
  where: { max: 200 },
  viewport: { max: 20 },
} as const;

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 5 imagens no teto + campos de texto + a margem do multipart. O Discord aceita
// 25 MB por mensagem; ficar abaixo evita uma recusa só na ponta.
const MAX_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BYTES + 256 * 1024;

// Por endereço, e não por identidade: qualquer um cria convidados à vontade em
// /api/session-guest, então um limite por identidade não limitaria ninguém. O
// teto global protege o canal quando os endereços são muitos. Os dois vêm do
// ambiente para os testes não esbarrarem neles.
const RATE_MAX = Number(process.env.FEEDBACK_RATE_MAX) || 3;
const RATE_GLOBAL = Number(process.env.FEEDBACK_RATE_GLOBAL) || 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const SEND_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------------- imagens

interface Sniffed {
  mime: string;
  ext: string;
}

/**
 * O tipo da imagem pelos primeiros bytes, nunca pelo que o navegador declarou.
 * Nome e `Content-Type` vêm de quem envia; aceitar o declarado deixaria um
 * executável ou HTML passar por "foto.png".
 */
export function sniffImage(bytes: Uint8Array): Sniffed | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return { mime: 'image/gif', ext: 'gif' };
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

// -------------------------------------------------------------------- texto

/** Sem caracteres de controle (menos quebra de linha), sem espaço nas pontas, no teto. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Por pontos de código: cortar em UTF-16 partiria um emoji ao meio.
  return Array.from(text).slice(0, max).join('');
}

/**
 * Defesa em profundidade contra menções: `allowed_mentions` vazio já impede o
 * ping, mas quem lê o canal ainda veria "@everyone" ativo no texto. O espaço de
 * largura zero desfaz o reconhecimento sem mudar o que se lê.
 */
function defang(text: string): string {
  return text.replace(/@(everyone|here)/gi, '@​$1').replace(/<@/g, '<@​');
}

// --------------------------------------------------------------- limite de uso

const sends = new Map<string, number[]>();

function rateLimited(key: string, max: number, now = Date.now()): number | null {
  const recent = (sends.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= max) {
    sends.set(key, recent);
    return Math.ceil((RATE_WINDOW_MS - (now - recent[0]!)) / 1000);
  }
  return null;
}

function markSent(key: string, now = Date.now()): void {
  const recent = (sends.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  sends.set(key, recent);

  // Varre as chaves vencidas de vez em quando para o mapa não crescer para sempre.
  if (sends.size > 500) {
    for (const [k, v] of sends) if (v.every((t) => now - t >= RATE_WINDOW_MS)) sends.delete(k);
  }
}

// ------------------------------------------------------------------- corpo

class TooLarge extends Error {}

/** O multipart lido em fluxo, abortando assim que passar do teto. */
async function readForm(req: IncomingMessage): Promise<FormData> {
  const type = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) throw new Error('not-multipart');

  let total = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, done) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) done(new TooLarge());
      else done(null, chunk);
    },
  });
  req.on('error', (e) => guard.destroy(e));
  req.pipe(guard);

  const request = new Request('http://internal/', {
    method: 'POST',
    headers: { 'content-type': type },
    body: Readable.toWeb(guard),
    duplex: 'half',
  });

  try {
    return await request.formData();
  } catch (err) {
    // O erro do Transform chega embrulhado pelo fetch; o tamanho é a causa
    // que importa para a resposta, e total > teto a identifica sem depender do embrulho.
    if (err instanceof TooLarge || total > MAX_BODY_BYTES) throw new TooLarge();
    throw err;
  }
}

// ------------------------------------------------------------------- Discord

interface Attachment {
  name: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** O que a rota usa de um arquivo do multipart — o `File` do Node e o do undici divergem em tipo. */
interface Upload {
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

const isUpload = (f: unknown): f is Upload =>
  typeof f === 'object' && f !== null && typeof (f as Upload).size === 'number' && typeof (f as Upload).arrayBuffer === 'function';

interface Report {
  kind: Kind;
  title: string;
  description: string;
  steps: string;
  contact: string;
  where: string;
  viewport: string;
  userAgent: string;
  sender: { name: string; id: string } | null;
  images: Attachment[];
}

function messageOf(r: Report) {
  const bug = r.kind === 'bug';
  const field = (name: string, value: string, inline = false) =>
    value ? [{ name, value: defang(value).slice(0, 1024), inline }] : [];

  const embed = {
    title: defang(`${bug ? '🐞 Bug' : '💬 Feedback'}: ${r.title}`).slice(0, 256),
    description: defang(r.description).slice(0, 4000),
    color: bug ? 0xf23f43 : 0x5865f2,
    fields: [
      ...(bug ? field('Passos para reproduzir', r.steps) : []),
      ...field('Contato', r.contact, true),
      ...field('Enviado por', r.sender ? `${r.sender.name} (\`${r.sender.id}\`)` : 'Convidado sem identidade', true),
      ...field('Onde', r.where, true),
      ...field('Tela', r.viewport, true),
      ...field('Navegador', r.userAgent),
      ...(r.images.length ? field('Imagens', String(r.images.length), true) : []),
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Sala de Tela' },
    ...(r.images[0] ? { image: { url: `attachment://${r.images[0].name}` } } : {}),
  };

  return {
    embeds: [embed],
    // Nada aqui pode pingar ninguém, nem com "@everyone" no texto do relato.
    allowed_mentions: { parse: [] as string[] },
    attachments: r.images.map((img, id) => ({ id, filename: img.name })),
  };
}

type SendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message: string; code: string; retryAfter?: number };

async function sendToDiscord(report: Report): Promise<SendResult> {
  if (!DISCORD_BOT_TOKEN) {
    return {
      ok: false,
      status: 503,
      code: 'feedback-off',
      message: 'O envio de feedback não está configurado neste servidor.',
    };
  }

  const form = new FormData();
  form.append('payload_json', JSON.stringify(messageOf(report)));
  report.images.forEach((img, i) => {
    form.append(`files[${i}]`, new Blob([img.bytes], { type: img.mime }), img.name);
  });

  let response: Response;
  try {
    response = await fetch(`${DISCORD_API_BASE}/channels/${FEEDBACK_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    // Sem a mensagem do erro no corpo da resposta: ela pode citar a URL, e
    // o log é o lugar certo para o detalhe.
    console.error('[feedback] Discord inalcançável:', err instanceof Error ? err.message : err);
    return { ok: false, status: 502, code: 'discord-down', message: 'Não consegui falar com o Discord agora. Tente de novo em instantes.' };
  }

  if (response.ok) {
    const sent = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: sent?.id ?? '' };
  }

  const detail = await response.text().catch(() => '');
  console.error(`[feedback] Discord respondeu ${response.status}: ${detail.slice(0, 300)}`);

  if (response.status === 429) {
    const wait = Number(response.headers.get('retry-after')) || 5;
    return { ok: false, status: 503, code: 'discord-busy', message: 'O Discord pediu para esperar um pouco. Tente de novo em instantes.', retryAfter: wait };
  }
  // 401/403/404: token, permissão ou canal errados — configuração, não culpa de
  // quem enviou. Dizer isso à pessoa não ajuda; o log do servidor ajuda quem
  // administra.
  return { ok: false, status: 502, code: 'discord-refused', message: 'Não consegui entregar o relato. A equipe já foi avisada nos registros do servidor.' };
}

// -------------------------------------------------------------------- rota

const submit: Handler = async ({ req, res }) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    res.once('finish', () => req.destroy());
    res.setHeader('Connection', 'close');
    return fail(res, 413, 'Os anexos passam do limite de tamanho.', { code: 'too-large' });
  }

  let form: FormData;
  try {
    form = await readForm(req);
  } catch (err) {
    if (err instanceof TooLarge) {
      res.once('finish', () => req.destroy());
      res.setHeader('Connection', 'close');
      return fail(res, 413, 'Os anexos passam do limite de tamanho.', { code: 'too-large' });
    }
    return fail(res, 400, 'Formulário inválido.', { code: 'bad-form' });
  }

  // Armadilha para robô: o campo existe no HTML, escondido, e gente de verdade
  // nunca o preenche. Fingir que deu certo não ensina nada ao robô.
  if (clean(form.get('website'), 100)) {
    console.warn('[feedback] envio descartado: campo-armadilha preenchido');
    return json(res, 200, { ok: true });
  }

  const kind = form.get('kind');
  if (typeof kind !== 'string' || !KINDS.includes(kind as Kind)) {
    return fail(res, 400, 'Escolha se é um bug ou um feedback.', { code: 'kind' });
  }

  const title = clean(form.get('title'), LIMITS.title.max);
  const description = clean(form.get('description'), LIMITS.description.max);
  if (title.length < LIMITS.title.min) {
    return fail(res, 400, `O título precisa ter ao menos ${LIMITS.title.min} caracteres.`, { code: 'title' });
  }
  if (description.length < LIMITS.description.min) {
    return fail(res, 400, `A descrição precisa ter ao menos ${LIMITS.description.min} caracteres.`, { code: 'description' });
  }

  // Imagens: quantidade, tamanho e o formato lido dos bytes.
  const files: Upload[] = [];
  for (const entry of form.getAll('images') as unknown[]) {
    if (isUpload(entry) && entry.size > 0) files.push(entry);
  }
  if (files.length > MAX_IMAGES) {
    return fail(res, 400, `Anexe no máximo ${MAX_IMAGES} imagens.`, { code: 'images-count' });
  }
  const images: Attachment[] = [];
  for (const [i, file] of files.entries()) {
    if (file.size > MAX_IMAGE_BYTES) {
      return fail(res, 400, `A imagem ${i + 1} passa de ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, { code: 'image-size' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kindOfImage = sniffImage(bytes);
    if (!kindOfImage) {
      return fail(res, 400, `A imagem ${i + 1} não é PNG, JPG, GIF ou WebP.`, { code: 'image-type' });
    }
    // Nome nosso, nunca o enviado: ele iria para o Discord e para quem abrir o anexo.
    images.push({ name: `imagem-${i + 1}.${kindOfImage.ext}`, mime: kindOfImage.mime, bytes });
  }

  // Identidade é opcional: quem relata um erro de login justamente não tem uma.
  const claims = verify(form.get('identity'));
  // O id vem do crachá verificado; o nome, do que a pessoa vê (o apelido muda
  // depois de o crachá ser emitido). É só rótulo — quem confia no id é o crachá.
  const shownName = clean(form.get('name'), 32);
  const sender = claims?.scope === 'identity' ? { name: shownName || claims.name, id: claims.uid } : null;

  // O Caddy sobrescreve o X-Forwarded-For de quem chega de fora; atrás dele o
  // endereço do socket seria sempre o do próprio proxy.
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  const key = `ip:${forwarded || req.socket.remoteAddress || '?'}`;
  const wait = rateLimited(key, RATE_MAX) ?? rateLimited('global', RATE_GLOBAL);
  if (wait !== null) {
    res.setHeader('Retry-After', String(wait));
    return fail(res, 429, `Já chegaram relatos demais há pouco. Tente de novo em ${Math.max(1, Math.ceil(wait / 60))} min.`, {
      code: 'rate',
      retryAfter: wait,
    });
  }

  const report: Report = {
    kind: kind as Kind,
    title,
    description,
    steps: clean(form.get('steps'), LIMITS.steps.max),
    contact: clean(form.get('contact'), LIMITS.contact.max),
    where: clean(form.get('where'), LIMITS.where.max),
    viewport: clean(form.get('viewport'), LIMITS.viewport.max),
    userAgent: clean(req.headers['user-agent'], 200),
    sender,
    images,
  };

  const result = await sendToDiscord(report);
  if (!result.ok) {
    return fail(res, result.status, result.message, {
      code: result.code,
      ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
    });
  }

  // Só conta no limite o que de fato foi entregue: falha do Discord não pode
  // gastar a cota de quem tentou.
  markSent(key);
  markSent('global');
  console.log(`[feedback] ${kind} entregue (${images.length} imagem(ns)) por ${sender?.id ?? key}`);
  json(res, 200, {
    ok: true,
    ...(result.id ? { link: `https://discord.com/channels/${FEEDBACK_GUILD_ID}/${FEEDBACK_CHANNEL_ID}/${result.id}` } : {}),
  });
};

export const rawRoutes: Record<string, Handler> = {
  'POST /api/feedback': submit,
};
