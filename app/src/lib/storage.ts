/**
 * `localStorage` que nunca derruba a página.
 *
 * Dentro de um iframe de terceiro o armazenamento pode estar particionado ou
 * bloqueado (RN-SES-2). Todo acesso vai em try/catch, e falhar significa
 * "sessão só em memória" — nunca "a página não abre". Vale para o apelido, o
 * volume, a largura da lateral e o crachá.
 */

/** @returns null quando a chave não existe ou o armazenamento está fechado. */
export function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento a sessão vale só enquanto a aba estiver aberta.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // idem
  }
}
