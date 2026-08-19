/**
 * Tudo que fala com a API do Discord.
 *
 * Junto num arquivo porque é aqui que moram os dois segredos — o da aplicação
 * e o do bot. Concentrá-los deixa óbvio, de fora, o que não pode sair deste
 * processo: nada disto tem versão no `app/`.
 */
import { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from './config.ts';
import type { Person } from './types.ts';

const API = 'https://discord.com/api';

/** Troca o code do OAuth pelo access_token. O secret nunca sai daqui. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return null;

  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });

  const data = (await r.json().catch(() => null)) as { access_token?: string } | null;
  return data?.access_token ?? null;
}

/** Perfil de quem autorizou. @returns null se o token não vale mais. */
export async function profileOf(accessToken: string): Promise<Person | null> {
  const me = (await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
    .then((r) => r.json())
    .catch(() => null)) as { id?: string; global_name?: string; username?: string; avatar?: string | null } | null;

  if (!me?.id) return null;
  return { id: me.id, name: me.global_name || me.username || me.id, avatar: me.avatar ?? null };
}

export function loginUrl(redirectUri: string): string | null {
  if (!DISCORD_CLIENT_ID) return null;
  const url = new URL(`${API}/oauth2/authorize`);
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  return url.toString();
}

export type Presence = 'in' | 'out' | 'unknown';

/**
 * Confirma pelo Discord que a pessoa está mesmo naquela call.
 *
 * Sem isto o escopo por canal é obscuridade, não segurança: o `instance_id`
 * vem do cliente, e um cliente adulterado pode alegar qualquer canal. Aqui
 * quem responde é o Discord, com o token do bot.
 */
export async function inVoiceChannel(
  guildId: string | undefined,
  channelId: string | undefined,
  userId: string
): Promise<Presence> {
  if (!DISCORD_BOT_TOKEN || !guildId || !channelId) return 'unknown';

  try {
    const r = await fetch(`${API}/v10/guilds/${guildId}/voice-states/${userId}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });

    if (r.status === 404) {
      // Dois 404 bem diferentes chegam aqui, e tratá-los igual trancava a
      // atividade para fora.
      //
      // "Unknown Guild" (10004) quer dizer que o BOT não está neste servidor —
      // o caso de quem instalou a atividade na própria conta, sem adicionar bot
      // nenhum. Isso não diz nada sobre a pessoa estar em call: é falta de
      // visibilidade nossa, não ausência dela. Antes virava "fora", o que
      // devolvia 403 e a atividade abria em "Não foi possível entrar".
      //
      // Qualquer outro 404 é o que o nome sugere: não há estado de voz para
      // essa pessoa neste servidor, então ela está fora da call.
      const err = (await r.json().catch(() => null)) as { code?: number } | null;
      if (err?.code === 10004) {
        console.warn('[voz] o bot nao esta neste servidor — escopo cai para a instancia');
        return 'unknown';
      }
      return 'out';
    }

    if (!r.ok) {
      console.warn(`[voz] Discord respondeu ${r.status} — verificação ignorada`);
      return 'unknown';
    }

    const state = (await r.json()) as { channel_id?: string };
    return state?.channel_id === channelId ? 'in' : 'out';
  } catch (err) {
    // Falha de rede não pode trancar todo mundo para fora.
    console.warn('[voz] falhou:', err instanceof Error ? err.message : err);
    return 'unknown';
  }
}
