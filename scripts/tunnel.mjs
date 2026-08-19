/**
 * Sobe o túnel que deixa este computador acessível de fora.
 *
 * Dois modos, e quem decide é o `.env`:
 *
 * - Com `TUNNEL_CONFIG` apontando para um túnel próprio, o endereço é fixo. É o
 *   que evita ter que trocar o "Target" no portal do Discord a cada reinício.
 *   Cria-se com `npm run tunnel:create`.
 * - Sem ele, um túnel descartável, com endereço novo a cada execução. O
 *   endereço é gravado no `.env` na hora: copiá-lo à mão era o passo mais fácil
 *   de esquecer, e com o sintoma mais enganoso de todos — tudo abre normalmente
 *   e só o botão de compartilhar leva a uma aba morta.
 *
 * O binário é resolvido por ./cloudflared.mjs, que baixa o release oficial se
 * ainda não houver nenhum. Ninguém precisa instalar nada antes.
 *
 * `abrirTunel` é exportada para o dia em que o `npm run dev` subir o túnel
 * junto — ele precisaria do endereço antes do servidor, e `up()` já aceita um
 * `origin` justamente para isso.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lerEnv, gravarEnv, cor } from './env.mjs';
import { garantirCloudflared, PASTA } from './cloudflared.mjs';

const ENDERECO = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/**
 * Abre o túnel e devolve o processo do cloudflared.
 *
 * `aoEndereco` é chamado uma vez, com o endereço público — imediatamente no
 * modo de endereço fixo, e assim que o cloudflared o anuncia no descartável.
 *
 * `rapido` ignora o `TUNNEL_CONFIG` e força o túnel descartável. Nesse caso o
 * `.env` não é tocado: o endereço fixo é a configuração da pessoa, e um túnel
 * que vale enquanto a janela está aberta não pode apagá-la.
 *
 * @param {{aoEndereco?: (origem: string | null) => void, rapido?: boolean}} opcoes
 */
export async function abrirTunel({ aoEndereco = () => {}, rapido = false } = {}) {
  const env = lerEnv();
  // A porta de entrada, nunca APP_PORT nem RELAY_PORT: é ela que roteia por
  // caminho e repassa o upgrade do WebSocket.
  const porta = env.PORT || '3000';
  const config = rapido ? '' : env.TUNNEL_CONFIG || '';
  const escrever = !rapido;

  // --no-autoupdate: o cloudflared se atualiza sozinho e reinicia no meio do
  // caminho, derrubando o túnel sem explicação. Quem manda na versão aqui é o
  // ./cloudflared.mjs.
  const args = config
    ? ['--config', config, 'tunnel', '--no-autoupdate', 'run']
    : [
        '--config',
        configNeutro(),
        'tunnel',
        '--no-autoupdate',
        '--url',
        `http://localhost:${porta}`,
      ];

  const cloudflared = await garantirCloudflared();

  // Sem shell: o caminho do binário vem resolvido, então não há .cmd no meio.
  const tunel = spawn(cloudflared, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  tunel.porta = porta;
  tunel.fixo = Boolean(config);

  if (config) {
    // Endereço fixo: quem sabe qual é ele é o arquivo de configuração do túnel,
    // não o `.env`. Ali o endereço é só uma cópia, e cópia sai de sincronia —
    // bastava um túnel descartável no meio do caminho para o PUBLIC_ORIGIN
    // virar o endereço daquela execução, e o túnel nomeado passar a subir
    // anunciando um endereço que já morreu. Lendo o hostname do ingress, o modo
    // fixo se corrige sozinho.
    const doArquivo = hostnameDoConfig(config);
    const origem = doArquivo || env.PUBLIC_ORIGIN || '';

    if (origem && origem !== env.PUBLIC_ORIGIN) {
      gravarEnv({ PUBLIC_ORIGIN: origem });
      linha(`${cor.amarelo}  O .env apontava para outro endereço — corrigi para o do túnel.${cor.fim}`);
    }

    linha(`${cor.verde}  ${origem || '(endereço definido no config do túnel)'}${cor.fim}\n`);
    aoEndereco(origem || null);
    return tunel;
  }

  let achado = null;
  const procurar = (pedaco) => {
    const url = pedaco.toString().match(ENDERECO)?.[0];
    if (!url || url === achado) return;

    achado = url;
    if (escrever) gravarEnv({ PUBLIC_ORIGIN: url });
    anunciar(url, escrever, env.DISCORD_CLIENT_ID);
    aoEndereco(url);
  };

  tunel.stdout.on('data', procurar);
  tunel.stderr.on('data', procurar);
  return tunel;
}

const linha = (t = '') => console.log(t);

/**
 * O endereço público declarado no config de um túnel nomeado.
 *
 * Um parser de YAML inteiro seria exagero para uma linha: o que interessa é a
 * primeira regra de ingress com hostname, que é por onde o mundo chega aqui. As
 * outras, quando existem, são o catch-all de 404.
 *
 * @returns {string} vazio quando o arquivo sumiu ou não declara hostname.
 */
function hostnameDoConfig(caminho) {
  try {
    const host = fs
      .readFileSync(caminho, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .find((l) => /^-?\s*hostname:\s*\S/.test(l))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim();

    return host ? `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : '';
  } catch {
    return '';
  }
}

/**
 * Um arquivo de configuração vazio, só para o túnel descartável não herdar o
 * `~/.cloudflared/config.yml` da máquina.
 *
 * Sem isto, quem já usa cloudflared para outra coisa tem o `tunnel:` e as
 * credenciais daquele outro túnel injetados num túnel que, por definição, não
 * tem dono nem credencial. O registro sai pela metade e o endereço anunciado
 * responde 404 — sem erro no log, sem nada que aponte para a causa.
 */
function configNeutro() {
  const caminho = path.join(PASTA, 'quick-tunnel.yml');
  fs.mkdirSync(PASTA, { recursive: true });
  // Uma chave inócua, e não um arquivo só com comentário: vazio o cloudflared
  // reclama com um ERR no log, que assusta sem significar nada.
  fs.writeFileSync(
    caminho,
    ['# Vazio de propósito — ver configNeutro() em scripts/tunnel.mjs.', 'no-autoupdate: true', ''].join('\n')
  );
  return caminho;
}

function anunciar(url, escreveu, temDiscord) {
  const dominio = url.replace('https://', '');
  linha(`\n${cor.verde}${cor.forte}  Endereço do túnel: ${url}${cor.fim}`);
  linha(
    escreveu
      ? `${cor.fraco}  Já guardei no .env — não precisa copiar.${cor.fim}\n`
      : `${cor.fraco}  Modo de teste: não mexi no .env, vale só nesta execução.${cor.fim}\n`
  );

  // Sem credencial do Discord o programa é só um site: falar de URL Mappings
  // ali seria instrução para um lugar onde a pessoa não tem o que fazer.
  if (!temDiscord) {
    linha(`${cor.fraco}  Abra esse endereço no navegador para usar de qualquer lugar.${cor.fim}\n`);
    return;
  }

  linha('  No portal do Discord, em Activities → URL Mappings, o "Target" é:');
  linha(`\n      ${cor.verde}${dominio}${cor.fim}\n`);
  linha('  E em OAuth2 → Redirects:');
  linha(`\n      ${cor.verde}${url}/auth/callback${cor.fim}\n`);
  linha(`${cor.fraco}  (esse endereço muda toda vez que este comando reinicia)${cor.fim}\n`);
}

// ------------------------------------------------------------------ comando

// Só quando chamado direto. Importado por outro script, nada disto roda.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  const porta = lerEnv().PORT || '3000';
  linha(`\n${cor.fraco}  Abrindo o túnel para a porta de entrada, em localhost:${porta}…${cor.fim}`);
  linha(`${cor.fraco}  Deixe esta janela aberta enquanto estiver usando.${cor.fim}\n`);

  let tunel;
  try {
    tunel = await abrirTunel({ rapido: process.argv.includes('--fast') });
  } catch (err) {
    linha(`\n${cor.vermelho}  ${err.message}${cor.fim}\n`);
    process.exit(1);
  }

  // O cloudflared escreve o essencial no stderr; sem repassar, um erro de rede
  // aqui vira uma janela parada sem explicação nenhuma.
  tunel.stdout.on('data', (p) => process.stderr.write(p));
  tunel.stderr.on('data', (p) => process.stderr.write(p));

  tunel.on('error', (err) => {
    linha(`\n${cor.vermelho}  Não consegui executar o cloudflared: ${err.message}${cor.fim}\n`);
    process.exit(1);
  });

  tunel.on('close', (codigo) => {
    if (!tunel.fixo) {
      linha(`\n${cor.vermelho}  O túnel fechou (código ${codigo}).${cor.fim}`);
      linha(`${cor.fraco}  Verifique sua conexão e rode "npm run tunnel" de novo.${cor.fim}\n`);
    }
    process.exit(codigo ?? 0);
  });

  // Ctrl+C fecha os dois juntos; sem isto o cloudflared fica rodando escondido.
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => tunel.kill());
}
