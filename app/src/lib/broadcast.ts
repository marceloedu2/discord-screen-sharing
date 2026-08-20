import { createBroadcaster, type Broadcaster } from './broadcaster';
import type { Preset } from './presets';
import { sdk } from './session';
import type { RoomTokens } from './types';

/**
 * Como uma transmissão começa, nos dois caminhos que ela tem (RF-TRX-3).
 *
 *   1. Capturar **de dentro da Activity** — funciona se o Discord conceder
 *      `display-capture`, o que hoje ele não faz. O caminho existe para o dia
 *      em que conceder: a aba some sozinha, sem mudança de código (RF-TRX-1).
 *   2. Cair para a **aba externa**, com as opções na URL (RN-TRX-7).
 */

/**
 * O limiar que separa "a plataforma bloqueou" de "a pessoa cancelou"
 * (RN-TRX-2).
 *
 * `NotAllowedError` vale para os dois. O que os distingue é o tempo: bloqueio
 * de política falha instantaneamente, sem nunca desenhar o seletor; cancelar
 * exige que alguém tenha visto a janela e clicado.
 */
const THRESHOLD_MS = 250;

export type BroadcastResult =
  | { kind: 'iframe'; broadcaster: Broadcaster }
  | { kind: 'tab' }
  | { kind: 'cancelled' }
  | { kind: 'refused'; message: string };

/** O token de transmissor vive na própria shareUrl, montada pelo servidor. */
function tokenOf(shareUrl: string): string | null {
  try {
    return new URL(shareUrl).searchParams.get('t');
  } catch {
    return null;
  }
}

/**
 * A URL da aba de captura, já configurada (RN-TRX-7).
 *
 * Sem `?sound=`: o pedido de áudio é sempre feito, e quem decide se aquela
 * transmissão leva som é o checkbox nativo do seletor do navegador
 * (RN-TRX-24c) — não sobra parâmetro nenhum para carregar essa escolha.
 *
 * `?source=` (RF-CAM-1) diz à aba se é `getDisplayMedia` ou `getUserMedia`
 * que ela deve chamar — vem só aqui porque só a aba externa precisa saber
 * disso antes de decidir o que pedir; o caminho de dentro da Activity recebe
 * `source` direto, por argumento.
 */
export function tabUrl(tokens: RoomTokens, preset: Preset, source: 'screen' | 'camera'): string {
  const url = new URL(tokens.shareUrl);
  url.searchParams.set('q', String(preset.bitrate));
  url.searchParams.set('fps', String(preset.fps));
  url.searchParams.set('preset', preset.id);
  url.searchParams.set('source', source);
  return url.toString();
}

export async function startBroadcast(
  tokens: RoomTokens,
  preset: Preset,
  source: 'screen' | 'camera',
  wsUrl: (path: string) => string,
  handlers: { onEnd?: (reason: string) => void; onNotice?: (m: string) => void } = {}
): Promise<BroadcastResult> {
  const token = tokenOf(tokens.shareUrl);

  if (token) {
    const broadcaster = createBroadcaster({
      // `kind` na URL do WS, não `source`: é o nome que o protocolo usa do
      // lado do servidor (RF-CAM-3) — a checagem de duplicata por pessoa
      // precisa saber qual das duas transmissões é essa antes de `start`
      // chegar.
      wsUrl: wsUrl(`/ws?t=${encodeURIComponent(token)}&kind=${source}`),
      bitrate: preset.bitrate,
      fps: preset.fps,
      maxHeight: preset.maxHeight,
      source,
      ...handlers,
    });

    const started = performance.now();
    try {
      // O clique é o gesto de usuário; nada de await antes dele (RN-TRX-6).
      await broadcaster.start();
      return { kind: 'iframe', broadcaster };
    } catch (err) {
      const instant = performance.now() - started < THRESHOLD_MS;
      const denied = err instanceof Error && err.name === 'NotAllowedError';

      // Demorou e foi negado: alguém viu o seletor e desistiu. Não é falha.
      if (denied && !instant) return { kind: 'cancelled' };
      // Negado na hora: é a política do iframe. Cai para a aba.
      if (!denied) {
        return { kind: 'refused', message: err instanceof Error ? err.message : 'Falhou.' };
      }
    }
  }

  return openTab(tabUrl(tokens, preset, source));
}

/**
 * Abre a aba de captura.
 *
 * Dentro do Discord isso passa pelo SDK (RN-TRX-8): `{ opened: false }` é
 * recusa explícita e vira aviso; clientes antigos devolvem `null`, que **não** é
 * recusa e não pode ser tratado como uma.
 */
async function openTab(url: string): Promise<BroadcastResult> {
  const active = sdk();

  if (active) {
    const r = (await active.commands.openExternalLink({ url })) as { opened?: boolean } | null;
    if (r && r.opened === false) {
      return {
        kind: 'refused',
        message: 'O Discord recusou abrir a aba de captura. Abra o link manualmente.',
      };
    }
    return { kind: 'tab' };
  }

  window.open(url, '_blank', 'noopener');
  return { kind: 'tab' };
}
