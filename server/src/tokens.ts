/**
 * Tokens assinados e curtos, sem dependência externa.
 * Formato: <claims base64url>.<hmac base64url>
 */
import crypto from 'node:crypto';

import type { Claims } from './types.ts';

/**
 * Segredo lido na hora do uso, nunca na importação.
 *
 * Imports são avaliados antes do corpo de quem importa — ou seja, antes de o
 * arquivo de ambiente ser aplicado. Lendo o segredo no topo, o valor do .env
 * nunca chegava: tudo era assinado com o padrão de desenvolvimento, que está
 * publicado neste repositório. Qualquer pessoa poderia forjar um token de sala.
 */
let cached: string | null = null;

function secret(): string {
  if (cached) return cached;

  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  // Em produção não existe padrão aceitável: sem segredo, não há assinatura.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET obrigatorio em producao.');
  }
  console.warn('aviso: SESSION_SECRET ausente — assinando com segredo de desenvolvimento.');
  cached = 'dev-inseguro-troque-isto';
  return cached;
}

const hmac = (data: string) =>
  crypto.createHmac('sha256', secret()).update(data).digest('base64url');

/**
 * `ttlSeconds` é opcional. Tokens de sala não expiram de propósito: a sala
 * fecha quando esvazia e o id dela é aleatório, então a própria vida da sala
 * já limita o token. Um prazo separado só criaria a chance de expirar no meio
 * de uma sessão. Já a identidade, que não está presa a nenhuma sala, expira.
 */
export function sign(claims: Claims, ttlSeconds: number | null = null): string {
  const full: Claims = ttlSeconds
    ? { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
    : claims;

  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verify(token: unknown): Claims | null {
  if (typeof token !== 'string') return null;

  const cut = token.indexOf('.');
  if (cut <= 0) return null;

  const body = token.slice(0, cut);
  const signature = token.slice(cut + 1);
  if (!signature) return null;

  const expected = hmac(body);
  // Comparação em tempo constante — evita vazar o segredo por timing. O
  // timingSafeEqual exige tamanhos iguais, então o comprimento vai antes.
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
  } catch {
    return null;
  }

  // Sem `exp` o token não expira — ver a nota em sign().
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}
