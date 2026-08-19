/** Nome de pessoa: 32 caracteres (RN-SAL-8). */
export const MAX_NAME = 32;

/** Nome de sala: 40 caracteres (RN-SAL-8). */
export const MAX_ROOM_NAME = 40;

/**
 * Normalização de nome, em qualquer entrada (RN-SES-14).
 *
 * Colapsa espaços consecutivos, remove das pontas, corta no limite. Nome vazio
 * depois disso é ignorado por quem chama — não zera o anterior.
 */
export function normalizeName(raw: string, max = MAX_NAME): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Duas primeiras palavras do nome, uma letra de cada. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Cor estável por pessoa (RN-UI-7).
 *
 * Mesma pessoa, mesma cor, em qualquer sessão e em qualquer máquina. O hash é o
 * do projeto antigo, byte a byte: trocá-lo mudaria a cor de todo mundo.
 *
 * A luminosidade, porém, caiu de 42% para 32%, e o motivo é medição. Sobre
 * `hsl(H 45% 42%)` as iniciais em branco davam 2,93:1 no amarelo (matiz 60°) —
 * abaixo do mínimo de 4,5:1, e o axe reprovava. Como o matiz sai de um hash,
 * a reprovação aparecia ou não conforme o id sorteado, o que é pior do que
 * falhar sempre: a suíte ficava intermitente. A 32% o pior matiz dá 4,75:1, e
 * os 360 passam. A saturação herdada fica onde estava.
 */
export function colorOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 45% 32%)`;
}
