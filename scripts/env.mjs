/**
 * Leitura e escrita do `.env` da raiz, para o túnel.
 *
 * A escrita é por chave, remendando o arquivo linha a linha em vez de recriá-lo:
 * o `.env` deste projeto tem comentários explicando cada bloco, e reescrevê-lo
 * inteiro significaria manter aqui uma segunda cópia do texto do `.env.example`
 * — que sairia de sincronia na primeira vez que alguém editasse um dos dois.
 * O túnel troca o endereço público e nada mais; o resto do arquivo sai daqui
 * byte por byte como entrou.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARQUIVO = path.join(ROOT, '.env');

// Uma linha de atribuição de verdade. O `#` na frente não casa de propósito:
// chave comentada é chave desligada, e religá-la sozinho seria surpresa.
const ATRIBUICAO = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** @returns {Record<string,string>} vazio se o arquivo ainda não existe. */
export function lerEnv() {
  try {
    const pares = fs
      .readFileSync(ARQUIVO, 'utf8')
      .split('\n')
      .filter((linha) => ATRIBUICAO.test(linha))
      .map((linha) => {
        const corte = linha.indexOf('=');
        return [linha.slice(0, corte).trim(), linha.slice(corte + 1).trim()];
      });
    return Object.fromEntries(pares);
  } catch {
    return {};
  }
}

/** Grava as chaves recebidas, preservando todo o resto do arquivo. */
export function gravarEnv(novos) {
  const pendentes = new Map(Object.entries(novos));
  const linhas = fs.existsSync(ARQUIVO) ? fs.readFileSync(ARQUIVO, 'utf8').split('\n') : [];

  const saida = linhas.map((linha) => {
    const casa = ATRIBUICAO.exec(linha);
    if (!casa || !pendentes.has(casa[2])) return linha;
    const valor = pendentes.get(casa[2]);
    pendentes.delete(casa[2]);
    return `${casa[1]}${casa[2]}=${valor}`;
  });

  // O que não existia no arquivo entra no fim, com um respiro antes.
  if (pendentes.size) {
    if (saida.at(-1)?.trim() !== '') saida.push('');
    for (const [chave, valor] of pendentes) saida.push(`${chave}=${valor}`);
    saida.push('');
  }

  fs.writeFileSync(ARQUIVO, saida.join('\n'));
}

export const cor = {
  fim: '\x1b[0m',
  forte: '\x1b[1m',
  fraco: '\x1b[2m',
  azul: '\x1b[38;5;69m',
  verde: '\x1b[32m',
  vermelho: '\x1b[31m',
  amarelo: '\x1b[33m',
};
