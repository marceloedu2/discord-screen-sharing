/**
 * As rotas HTTP que pertencem ao servidor.
 *
 * O critério do que fica aqui e do que vai para o `app/` é um só: toca o
 * estado em memória das salas, ou toca um segredo. O espelho de avatar não faz
 * nem uma coisa nem outra — e manter 200 imagens em cache dentro do processo
 * que faz relay de vídeo é disputar memória com o backpressure dos sockets —,
 * então ele é rota do Next. O clientId chega ao navegador pelo HTML que o app
 * renderiza, sem uma ida à rede para descobri-lo.
 *
 * O contrato é o de `.claude/specs/09-protocolo.md`: nomes de campo e de rota são
 * herdados e não mudam.
 */
import crypto from 'node:crypto';

import { fail, json, redirect } from './http.ts';
import type { Context, Handler } from './http.ts';
import { sign, verify } from './tokens.ts';
import * as rooms from './rooms.ts';
import * as discord from './discord.ts';
import {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  PUBLIC_ORIGIN,
  REDIRECT_URI,
  WEB_INSTANCE,
  isProd,
} from './config.ts';
import type { Claims } from './types.ts';

// ---------------------------------------------------------------- identidade

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function issueIdentity(
  instance: string,
  uid: string,
  name: string,
  avatar: string | null,
  ttl = 8 * 60 * 60,
  extra: Partial<Claims> = {}
) {
  return {
    user: { id: uid, name, avatar },
    instance,
    identity: sign({ instance, uid, name, av: avatar, scope: 'identity', ...extra }, ttl),
  };
}

/** Valida o token de identidade que acompanha toda operação de sala. */
function identityOf(ctx: Context): Claims | null {
  const claims = verify(ctx.body.identity);
  if (!claims || claims.scope !== 'identity') {
    fail(ctx.res, 401, 'identidade invalida ou expirada');
    return null;
  }
  return claims;
}

/**
 * Tokens de acesso a uma sala, emitidos depois de passar pela senha.
 *
 * Sem prazo de validade: quem entrou fica. A sala fecha ao esvaziar e o id é
 * aleatório, então o token morre junto com ela.
 *
 * O shareUrl aponta para /share, servido pelo app — a página de captura
 * precisa abrir fora do iframe do Discord, e é o PUBLIC_ORIGIN que garante
 * isso. Ele é o endereço da porta de entrada, não o deste processo.
 */
function roomTokens(roomId: string, me: Claims) {
  const base = { room: roomId, uid: me.uid, name: me.name, av: me.av ?? null };
  return {
    roomId,
    viewerToken: sign({ ...base, role: 'viewer' }),
    shareUrl: `${PUBLIC_ORIGIN}/share?t=${encodeURIComponent(sign({ ...base, role: 'broadcaster' }))}`,
  };
}

/**
 * A sala desta call. É a única sala que existe dentro do Discord: a atividade
 * abre nela direto, sem lista, porque escolher entre uma opção só não é escolha.
 */
const callRoomId = (me: Claims) =>
  me.call ? `call-${me.call}` : `atividade-${me.instance ?? WEB_INSTANCE}`;

const instanceOf = (me: Claims) => me.instance ?? WEB_INSTANCE;

// --------------------------------------------------------------------- OAuth

const exchangeToken: Handler = async ({ res, body }) => {
  const code = str(body.code);
  const clientId = str(body.client_id);
  if (!code) return fail(res, 400, 'code obrigatorio');

  // A metade que autoriza é a aplicação que abriu a atividade; a metade que
  // troca o código é este servidor. Se forem aplicações diferentes, o Discord
  // recusa — e o erro dele não diz qual das duas está errada.
  if (clientId && DISCORD_CLIENT_ID && clientId !== DISCORD_CLIENT_ID) {
    console.error(`[oauth] atividade e da aplicacao ${clientId}, mas o .env tem ${DISCORD_CLIENT_ID}`);
    return fail(
      res,
      409,
      `Esta atividade é da aplicação ${clientId}, mas o servidor está configurado ` +
        `com a ${DISCORD_CLIENT_ID}. As duas precisam ser a mesma.`
    );
  }

  // Sem credencial não há troca possível, e o erro que o Discord devolve nesse
  // caso não deixa isso óbvio para ninguém. Dizer aqui poupa a caçada.
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.error('[oauth] DISCORD_CLIENT_ID ou DISCORD_CLIENT_SECRET ausente no .env');
    return fail(res, 500, 'O servidor está sem as credenciais do Discord. Configure o .env.');
  }

  const accessToken = await discord.exchangeCode(code, REDIRECT_URI);
  if (!accessToken) return fail(res, 502, 'o Discord recusou a troca do codigo');

  json(res, 200, { access_token: accessToken });
};

const session: Handler = async ({ res, body }) => {
  const accessToken = str(body.access_token);
  const instanceId = str(body.instance_id);
  if (!accessToken || !instanceId) {
    return fail(res, 400, 'access_token e instance_id obrigatorios');
  }

  const me = await discord.profileOf(accessToken);
  if (!me) return fail(res, 401, 'token invalido');

  const channelId = str(body.channel_id);
  const presence = await discord.inVoiceChannel(str(body.guild_id), channelId, me.id);
  if (presence === 'out') {
    return fail(res, 403, 'Entre na call antes de abrir a atividade.');
  }

  // O canal entra no token assinado, não fica só na resposta: é o que permite
  // ao endpoint da sala da call confiar sem consultar o Discord de novo.
  const confirmed = presence === 'in' && channelId ? { call: channelId } : {};
  const identity = issueIdentity(instanceId, me.id, me.name, me.avatar, 8 * 60 * 60, confirmed);

  json(res, 200, { ...identity, call: presence === 'in' ? channelId : null });
};

/**
 * Identidade de teste com instância à escolha. Fora do ar em produção: poder
 * escolher a instância permitiria espiar as salas de qualquer canal de voz.
 */
const devSession: Handler = ({ res, body }) => {
  if (isProd) return fail(res, 404, 'rota inexistente');
  const instance = str(body.instance_id) ?? 'dev';
  const name = str(body.name) ?? 'Dev';
  const call = str(body.call);
  json(res, 200, issueIdentity(instance, `dev-${name}`, name, null, 8 * 60 * 60, call ? { call } : {}));
};

/**
 * Identidade de convidado: entra sem conta.
 *
 * O login do Discord é uma melhoria opcional, não um pedágio — exigir conta só
 * para assistir uma tela afastaria justamente quem recebeu um link.
 *
 * Validade longa de propósito: o id do convidado é o que amarra a posse das
 * salas que ele criou, e perder isso no meio do uso seria pior que o risco de
 * um token de convidado antigo, que não dá acesso a nada além do lobby público.
 */
const guestSession: Handler = ({ res, body }) => {
  // str(), e não String(): o corpo vem de fora e `name` pode ser objeto —
  // String({}) viraria o nome "[object Object]" em vez de cair no padrão.
  const raw = (str(body.name) ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
  const name = raw || `Convidado ${Math.floor(Math.random() * 9000 + 1000)}`;
  const uid = `guest-${crypto.randomBytes(8).toString('base64url')}`;
  json(res, 200, issueIdentity(WEB_INSTANCE, uid, name, null, 30 * 24 * 60 * 60));
};

// --------------------------------------------------------------------- salas

/**
 * Listar não exige login: dá para ver o lobby antes de entrar.
 *
 * Criar e entrar continuam exigindo identidade — sem isso não haveria dono de
 * sala nem nome de participante.
 */
const list: Handler = ({ res, body }) => {
  const me = verify(body.identity);
  const instance = me?.scope === 'identity' ? instanceOf(me) : WEB_INSTANCE;
  json(res, 200, { rooms: rooms.listRooms(instance) });
};

const create: Handler = (ctx) => {
  const me = identityOf(ctx);
  if (!me) return;

  const result = rooms.createRoom({
    instance: instanceOf(me),
    name: str(ctx.body.name),
    ownerId: me.uid,
    ownerName: me.name,
    password: str(ctx.body.password) ?? null,
  });
  if ('error' in result) return fail(ctx.res, 400, result.error);

  console.log(`[room ${result.room.id}] criada por ${me.name}: "${result.room.name}"`);
  json(ctx.res, 200, roomTokens(result.room.id, me));
};

const callRoom: Handler = (ctx) => {
  const me = identityOf(ctx);
  if (!me) return;

  const room = rooms.ensureCallRoom(instanceOf(me), callRoomId(me));
  json(ctx.res, 200, roomTokens(room.id, me));
};

const join: Handler = (ctx) => {
  const me = identityOf(ctx);
  if (!me) return;

  const room = rooms.getRoom(ctx.body.roomId);
  if (!room) return fail(ctx.res, 404, 'Sala não existe mais.');

  // A sala da call é avaliada antes da instância: quem manda nela é a presença
  // no canal, confirmada pelo Discord. Checar instância aqui recusaria por
  // motivo errado, já que o id dela vem do canal e não da instância.
  if (room.isCall) {
    if (room.id !== callRoomId(me)) {
      return fail(ctx.res, 403, 'Entre na call para acessar esta sala.');
    }
    return json(ctx.res, 200, roomTokens(room.id, me));
  }

  // Salas comuns: as de um canal de voz não aparecem nem abrem em outro.
  if (room.instance !== instanceOf(me)) return fail(ctx.res, 404, 'Sala não existe mais.');

  const verdict = rooms.checkPassword(room, str(ctx.body.password));
  if (!verdict.ok) {
    const locked = verdict.reason === 'locked';
    return fail(
      ctx.res,
      locked ? 429 : 403,
      locked
        ? `Muitas tentativas. Tente de novo em ${verdict.seconds}s.`
        : 'Senha incorreta.',
      { reason: verdict.reason }
    );
  }

  json(ctx.res, 200, roomTokens(room.id, me));
};

const password: Handler = (ctx) => {
  const me = identityOf(ctx);
  if (!me) return;

  const room = rooms.getRoom(ctx.body.roomId);
  if (!room || room.instance !== instanceOf(me)) {
    return fail(ctx.res, 404, 'Sala não existe mais.');
  }

  const error = rooms.setPassword(room, me.uid, str(ctx.body.password) ?? null);
  if (error) return fail(ctx.res, 403, error);

  json(ctx.res, 200, { ok: true, locked: Boolean(room.password) });
};

// -------------------------------------------- login web (fora do Discord)

const login: Handler = ({ res }) => {
  const url = discord.loginUrl(REDIRECT_URI);
  if (!url) return fail(res, 503, 'login do Discord nao configurado');
  redirect(res, url);
};

const callback: Handler = async ({ res, query }) => {
  const code = query.get('code');
  if (!code) return redirect(res, '/?erro=sem_codigo');

  const accessToken = await discord.exchangeCode(code, REDIRECT_URI);
  if (!accessToken) return redirect(res, '/?erro=troca_falhou');

  const me = await discord.profileOf(accessToken);
  if (!me) return redirect(res, '/?erro=perfil_falhou');

  const { identity } = issueIdentity(WEB_INSTANCE, me.id, me.name, me.avatar);

  // No fragmento, não na query: o fragmento não é enviado ao servidor nem
  // aparece em log de proxy. O cliente lê e limpa da barra de endereço.
  redirect(res, `/#identity=${encodeURIComponent(identity)}`);
};

// -------------------------------------------------------------------- tabela

export const routes: Record<string, Handler> = {
  'POST /api/token': exchangeToken,
  'POST /api/session': session,
  'POST /api/session-dev': devSession,
  'POST /api/session-guest': guestSession,

  'POST /api/rooms/list': list,
  'POST /api/rooms/create': create,
  'POST /api/rooms/call': callRoom,
  'POST /api/rooms/join': join,
  'POST /api/rooms/password': password,

  'GET /auth/login': login,
  'GET /auth/callback': callback,

  // Responder com o estado das salas é de propósito: um processo que responde
  // 200 nesta rota tem servidor e relay de pé, não só a porta aberta.
  'GET /api/health': ({ res }) => json(res, 200, { ok: true, rooms: rooms.stats() }),
};
