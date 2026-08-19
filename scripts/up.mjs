/**
 * Sobe as três peças: a porta de entrada, o app e o servidor.
 *
 * Três processos porque cada um tem um motivo para existir sozinho — o app é
 * o Next, o servidor precisa de um processo único e vivo para segurar as salas
 * em memória, e a porta de entrada é o que faz os dois aparecerem na mesma
 * origem. Quem só quer rodar não precisa saber de nenhum dos três: é um
 * comando e uma janela, e o Ctrl+C derruba tudo junto.
 */
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * O next e o tsc são chamados pelo arquivo .js, e não por "npm -w app run dev".
 *
 * No Windows o npm é um .cmd, e o Node se recusa a executá-lo sem shell desde
 * a correção do CVE-2024-27980 — spawn devolve EINVAL. Passar shell: true
 * resolveria a execução e criaria outro problema: quem morre no Ctrl+C é o
 * shell, e o filho fica rodando órfão. Chamando o arquivo com o próprio Node,
 * o processo é um só e o kill alcança.
 */
export const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

const children = new Set();
let shuttingDown = false;

/**
 * Repassa a saída de um processo com um prefixo.
 *
 * Por linha inteira, e não por pedaço: o que chega no 'data' é o que coube no
 * buffer, então prefixar direto partiria linhas no meio.
 */
function track(name, child) {
  const tag = `[${name}] `;

  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${tag}${line.replace(/\r$/, '')}\n`);
    });
  }

  child.on('close', (code) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`\n  [${name}] encerrou (código ${code}).`);
    shutdown(code ?? 1);
  });

  children.add(child);
  return child;
}

/**
 * Mata o processo e a descendência dele.
 *
 * O `kill()` do Node alcança só o filho direto, e isso não basta: o
 * `node --watch` roda o servidor num processo separado, então matar o pai
 * deixa o neto vivo segurando a porta — e a próxima execução morre com "porta
 * já está sendo usada" sem que se veja nada rodando. No Windows quem alcança a
 * árvore inteira é o taskkill com /T.
 */
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill();
}

export function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) kill(child);
  // Uma folga para os filhos saírem antes de o processo morrer.
  setTimeout(() => process.exit(code), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));

export function ports() {
  return {
    PORT: String(Number(process.env.PORT) || 3000),
    APP_PORT: String(Number(process.env.APP_PORT) || 3100),
    RELAY_PORT: String(Number(process.env.RELAY_PORT) || 3101),
  };
}

/**
 * @param {{ dev?: boolean, origin?: string | null }} options
 *   `dev` roda `next dev` e o servidor com --watch; `origin` sobrepõe o
 *   PUBLIC_ORIGIN (usado quando ele nasce em tempo de execução, de um túnel).
 */
export function up({ dev = false, origin = null } = {}) {
  const p = ports();
  const base = { ...process.env, ...p };
  if (origin) base.PUBLIC_ORIGIN = origin;

  // A porta de entrada primeiro: ela responde 502 com uma frase legível
  // enquanto os outros dois ainda sobem, em vez de o navegador dar
  // "conexão recusada" sem dizer de quê.
  track(
    'entry',
    spawn(process.execPath, [path.join(ROOT, 'scripts', 'proxy.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
      env: base,
    })
  );

  // O Next lê a porta de PORT, que aqui vale a porta de entrada — por isso a
  // sobreposição explícita. Sem ela os dois disputam o mesmo número e o
  // segundo a subir morre com EADDRINUSE.
  track(
    'app',
    spawn(process.execPath, [NEXT_BIN, dev ? 'dev' : 'start'], {
      cwd: path.join(ROOT, 'app'),
      stdio: 'pipe',
      env: { ...base, PORT: p.APP_PORT },
    })
  );

  // Em dev o TypeScript roda direto, sem passo de build: o `--experimental-
  // strip-types` só remove anotações, e o tsconfig cobra `erasableSyntaxOnly`
  // para nada que ele não saiba executar entrar no código.
  const serverArgs = dev
    ? [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--env-file-if-exists=../.env',
        '--watch',
        'src/index.ts',
      ]
    : ['--env-file-if-exists=../.env', 'dist/index.js'];

  track(
    'server',
    spawn(process.execPath, serverArgs, {
      cwd: path.join(ROOT, 'server'),
      stdio: 'pipe',
      env: base,
    })
  );

  return p;
}

// Executado direto (`npm run dev`, `npm start`), e não importado.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dev = process.argv.includes('--dev');
  console.log('\n  Subindo entrada, app e servidor…  Ctrl+C derruba os três.\n');
  const { PORT } = up({ dev });
  console.log(`\n  Abra  http://localhost:${PORT}\n`);
}
