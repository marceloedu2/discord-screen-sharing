import { read, remove, store } from './storage';

/**
 * O crachá: o token de identidade que o servidor assina.
 *
 * Formato herdado de server/src/tokens.ts — `<claims base64url>.<hmac
 * base64url>`. O cliente **decodifica sem validar** (RN-SES-12), e só para
 * descartar o que já venceu: quem confere a assinatura é sempre o servidor.
 * Validar aqui exigiria o segredo no navegador, que é o oposto do ponto.
 */

const CHAVE = 'identity';

export type Claims = {
  instance: string;
  uid: string;
  name: string;
  av: string | null;
  scope?: string;
  call?: string;
  /** Segundos desde a época. Ausente em token de sala, que não expira. */
  exp?: number;
};

/** As claims de um token, sem conferir a assinatura. @returns null se ilegível. */
export function decode(token: string): Claims | null {
  try {
    const body = token.slice(0, token.indexOf('.'));
    if (!body) return null;
    // atob espera base64 comum; o token é base64url, e sem padding.
    const base64 = body.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Claims;
  } catch {
    return null;
  }
}

/** Já venceu? Token sem `exp` não expira — ver a nota em tokens.ts. */
export function expired(claims: Claims): boolean {
  return Boolean(claims.exp && claims.exp < Math.floor(Date.now() / 1000));
}

/**
 * O crachá guardado, se ainda servir.
 *
 * Descartar o vencido aqui evita uma ida ao servidor que só voltaria 401 — e
 * evita a tela parada enquanto ela acontece.
 */
export function stored(): string | null {
  const token = read(CHAVE);
  if (!token) return null;

  const claims = decode(token);
  if (!claims || expired(claims)) {
    remove(CHAVE);
    return null;
  }
  return token;
}

export const save = (token: string) => store(CHAVE, token);
export const discard = () => remove(CHAVE);
