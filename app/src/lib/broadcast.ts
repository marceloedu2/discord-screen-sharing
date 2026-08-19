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
const LIMIAR_MS = 250;

export type ResultadoTransmissao =
  | { kind: 'iframe'; broadcaster: Broadcaster }
  | { kind: 'aba' }
  | { kind: 'cancelado' }
  | { kind: 'recusado'; message: string };

/** O token de transmissor vive na própria shareUrl, montada pelo servidor. */
function tokenDe(shareUrl: string): string | null {
  try {
    return new URL(shareUrl).searchParams.get('t');
  } catch {
    return null;
  }
}

/** A URL da aba de captura, já configurada (RN-TRX-7). */
export function urlDaAba(tokens: RoomTokens, preset: Preset, sound: boolean): string {
  const url = new URL(tokens.shareUrl);
  url.searchParams.set('q', String(preset.bitrate));
  url.searchParams.set('fps', String(preset.fps));
  url.searchParams.set('som', sound ? '1' : '0');
  url.searchParams.set('preset', preset.id);
  return url.toString();
}

export async function iniciarTransmissao(
  tokens: RoomTokens,
  preset: Preset,
  sound: boolean,
  wsUrl: (path: string) => string,
  handlers: { onEnd?: (reason: string) => void; onAviso?: (m: string) => void } = {}
): Promise<ResultadoTransmissao> {
  const token = tokenDe(tokens.shareUrl);

  if (token) {
    const broadcaster = createBroadcaster({
      wsUrl: wsUrl(`/ws?t=${encodeURIComponent(token)}`),
      bitrate: preset.bitrate,
      fps: preset.fps,
      maxHeight: preset.maxHeight,
      audio: sound,
      ...handlers,
    });

    const started = performance.now();
    try {
      // O clique é o gesto de usuário; nada de await antes dele (RN-TRX-6).
      await broadcaster.start();
      return { kind: 'iframe', broadcaster };
    } catch (err) {
      const instant = performance.now() - started < LIMIAR_MS;
      const denied = err instanceof Error && err.name === 'NotAllowedError';

      // Demorou e foi negado: alguém viu o seletor e desistiu. Não é falha.
      if (denied && !instant) return { kind: 'cancelado' };
      // Negado na hora: é a política do iframe. Cai para a aba.
      if (!denied) {
        return { kind: 'recusado', message: err instanceof Error ? err.message : 'Falhou.' };
      }
    }
  }

  return abrirAba(urlDaAba(tokens, preset, sound));
}

/**
 * Abre a aba de captura.
 *
 * Dentro do Discord isso passa pelo SDK (RN-TRX-8): `{ opened: false }` é
 * recusa explícita e vira aviso; clientes antigos devolvem `null`, que **não** é
 * recusa e não pode ser tratado como uma.
 */
async function abrirAba(url: string): Promise<ResultadoTransmissao> {
  const ativo = sdk();

  if (ativo) {
    const r = (await ativo.commands.openExternalLink({ url })) as { opened?: boolean } | null;
    if (r && r.opened === false) {
      return {
        kind: 'recusado',
        message: 'O Discord recusou abrir a aba de captura. Abra o link manualmente.',
      };
    }
    return { kind: 'aba' };
  }

  window.open(url, '_blank', 'noopener');
  return { kind: 'aba' };
}
