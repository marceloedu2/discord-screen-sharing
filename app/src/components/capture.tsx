"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "./button";
import { PRESETS, presetDe, type Preset } from "@/lib/presets";
import {
  createBroadcaster,
  supportError,
  type BroadcastStats,
  type BroadcastStatus,
  type Broadcaster,
} from "@/lib/broadcaster";

/**
 * A aba de captura, que roda FORA do Discord.
 *
 * Duas restrições fundadoras a colocaram aqui: a Activity roda num iframe de
 * outro domínio, onde o navegador nega `getDisplayMedia()` (RN-PRO-1), e WebRTC
 * não existe em Activities (RN-PRO-2). Por isso a captura acontece numa aba
 * normal e os quadros vão por WebSocket.
 *
 * As opções chegam na URL (RN-TRX-7): a página abre já configurada, sem pedir
 * as mesmas escolhas de novo.
 */
export function Capture() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<BroadcastStatus | null>(null);
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  const [onAir, setNoAr] = useState(false);
  const [soundBlocked, setSomBloqueado] = useState(false);
  const [hasSound, setTemSom] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [preview, setPrevia] = useState<{ width: number; height: number; hasSound: boolean } | null>(
    null
  );
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const broadcaster = useRef<Broadcaster | null>(null);
  const params = useSearchParams();

  /**
   * "Já estamos no navegador?", sem efeito e sem setState.
   *
   * A checagem de suporte lê `navigator` e `window`, que não existem na
   * renderização do servidor. Este é o padrão do próprio React para a pergunta:
   * o snapshot do servidor diz false, o do cliente diz true, e a troca acontece
   * na hidratação sem passar por um efeito que dispara re-render em cascata.
   */
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const options = useMemo(
    () => ({
      token: params.get("t") ?? "",
      // Os padrões são os da spec: Boa, 2,5 Mbps, 30 fps (RF-TRX-2).
      bitrate: Number(params.get("q")) || 2_500_000,
      fps: Number(params.get("fps")) || 30,
      som: params.get("som") === "1",
      preset: presetDe(params.get("preset")),
    }),
    [params]
  );

  // Transmitir exige Chromium (RN-TRX-4). Celular não transmite em navegador
  // nenhum (RN-TRX-5), e a mensagem precisa dizer isso — não um error genérico.
  const blocker = !inBrowser
    ? null
    : !options.token
      ? "Link de transmissão inválido ou expirado."
      : supportError({ requireChromium: true });

  const begin = useCallback(async () => {
    const opts = options;

    setError(null);
    setNotice(null);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const b = createBroadcaster({
      wsUrl: `${proto}://${location.host}/ws?t=${encodeURIComponent(opts.token)}`,
      bitrate: opts.bitrate,
      fps: opts.fps,
      maxHeight: opts.preset.maxHeight,
      audio: opts.som,
      onStatus: setStatus,
      onStats: setStats,
      onAviso: setNotice,
      onEnd: (reason) => {
        setNoAr(false);
        setStats(null);
        setSomBloqueado(false);
        setTemSom(false);
        if (reason) setNotice(reason);
      },
    });

    broadcaster.current = b;
    try {
      // O clique É o gesto de usuário que getDisplayMedia exige; qualquer await
      // antes dele o invalida (RN-TRX-6).
      const p = await b.preparar();
      setPrevia({ width: p.width, height: p.height, hasSound: p.hasSound });
      setSomBloqueado(p.soundBlocked);
      setPreset(opts.preset);
    } catch (err) {
      broadcaster.current = null;
      // Cancelar o seletor não é error que mereça alarde.
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Não consegui começar a transmissão.");
    }
  }, [options]);

  /** Confirma a preview: é daqui em diante que sai byte (RN-TRX-38). */
  const goLive = useCallback(async () => {
    try {
      await broadcaster.current?.goLive();
      setPrevia(null);
      setNoAr(true);
      setTemSom(broadcaster.current?.hasSound() ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui entrar no ar.");
    }
  }, []);

  const discard = useCallback(() => {
    broadcaster.current?.stop();
    broadcaster.current = null;
    setPrevia(null);
    setSomBloqueado(false);
  }, []);

  const stopBroadcast = useCallback(() => broadcaster.current?.stop(), []);

  /**
   * "Som de uma aba" (RF-TRX-6) — a saída para quem quer tela inteira **com**
   * som. Abre um segundo seletor, aproveita só a faixa de áudio e descarta o
   * vídeo daquela escolha. O vídeo continua sendo a tela inteira.
   */
  const tabSound = useCallback(async () => {
    setError(null);
    try {
      await broadcaster.current?.trocarSom();
      setSomBloqueado(false);
      setTemSom(true);
      setNotice("Som ligado, vindo da aba escolhida.");
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Não consegui pegar o som.");
    }
  }, []);

  /** Trocar a tela sem derrubar a transmissão (RF-TRX-8). */
  const swapScreen = useCallback(async () => {
    setError(null);
    try {
      await broadcaster.current?.changeScreen();
      setSomBloqueado(broadcaster.current?.soundBlocked() ?? false);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Não consegui trocar a tela.");
    }
  }, []);

  /**
   * Ajustar a qualidade com a transmissão no ar (RF-TRX-7), sem derrubar quem
   * está assistindo: reconfigura o encoder e pede a taxa nova à própria
   * captura.
   */
  const adjustQuality = useCallback((p: Preset) => {
    setPreset(p);
    broadcaster.current?.setQuality({ bitrate: p.bitrate, fps: p.fps, maxHeight: p.maxHeight });
  }, []);

  /**
   * Pinta a preview a cada ~500 ms (RN-TRX-38).
   *
   * Um `VideoFrame` por vez num canvas pequeno, e nada disso passa pelo
   * encoder: enquanto a preview está na tela, nenhum byte saiu daqui.
   */
  useEffect(() => {
    if (!preview) return;
    const canvas = previewCanvas.current;
    const track = broadcaster.current;
    if (!canvas || !track) return;

    const ctx = canvas.getContext("2d");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([broadcaster.current?.faixaPreparada() as MediaStreamTrack]);
    void video.play().catch(() => {});

    const pintar = () => {
      if (!ctx || !video.videoWidth) return;
      canvas.width = 320;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * 320);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    };

    const t = setInterval(pintar, 500);
    return () => {
      clearInterval(t);
      video.srcObject = null;
    };
  }, [preview]);

  // A aba precisa continuar aberta enquanto a transmissão durar (RF-TRX-4).
  useEffect(() => {
    if (!onAir) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [onAir]);

  if (!inBrowser) return null;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 rounded-xl border border-linha bg-painel p-8">
      <div>
        <h1 className="text-2xl font-semibold text-texto">Compartilhar tela</h1>
        <p className="mt-1 text-suave">
          Esta aba precisa continuar aberta enquanto você transmite. Você pode goBack ao Discord
          normalmente.
        </p>
      </div>

      {blocker ? (
        <p className="rounded-lg border border-perigo bg-perigo/10 px-4 py-3 text-[14px] text-texto">
          {blocker}
        </p>
      ) : (
        <>
          {/* A prévia: a imagem capturada, o que se detectou dela, e a decisão.
              Nada foi enviado ainda (RF-TRX-12). */}
          {preview ? (
            <div className="flex flex-col gap-3 rounded-lg border border-linha bg-tile p-4">
              <canvas
                ref={previewCanvas}
                aria-label="Prévia do que será transmitido"
                className="w-full rounded-md bg-fundo"
              />
              <p className="text-[13.5px] text-suave">
                {preview.width}×{preview.height} ·{" "}
                {preview.hasSound ? "com som" : "sem som"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primario" wide onClick={() => void goLive()}>
                  Entrar no ar
                </Button>
                <Button
                  onClick={() => {
                    discard();
                    void begin();
                  }}
                >
                  Trocar de tela
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {onAir ? (
              <Button variant="encerrar" wide onClick={stopBroadcast}>
                Parar de transmitir
              </Button>
            ) : preview ? null : (
              <Button variant="primario" wide onClick={() => void begin()}>
                Escolher tela e transmitir
              </Button>
            )}
            {onAir ? (
              <span className="flex items-center gap-2 text-[13px] text-suave">
                <span className="size-2 rounded-full bg-vivo" aria-hidden="true" />
                No ar
              </span>
            ) : null}
          </div>

          {error ? <p className="text-[14px] text-perigo">{error}</p> : null}

          {/* Som barrado: a faixa foi parada na origem e a transmissão segue sem
              som (RF-TRX-5). O aviso fica **junto da saída**, e não num toast
              que some — ninguém acha o caminho depois. */}
          {soundBlocked ? (
            <div className="rounded-lg border border-atencao bg-atencao/10 px-4 py-3">
              <p className="text-[14px] text-texto">
                A tela inteira carrega o som do Discord junto, e a call se ouviria em eco. Está no
                ar <strong>sem som</strong>.
              </p>
              <Button variant="atencao" wide className="mt-3" onClick={() => void tabSound()}>
                Som de uma aba
              </Button>
            </div>
          ) : null}

          {notice && !soundBlocked ? (
            <p className="rounded-lg border border-linha bg-tile px-4 py-3 text-[14px] text-suave">
              {notice}
            </p>
          ) : null}

          {onAir ? (
            <div className="flex flex-col gap-3 rounded-lg border border-linha bg-tile p-4">
              <label className="flex items-center justify-between gap-3 text-[13.5px] text-suave">
                Qualidade
                <select
                  value={preset?.id ?? "boa"}
                  onChange={(e) => adjustQuality(presetDe(e.target.value))}
                  className="max-w-[210px] flex-1 rounded-md border border-linha bg-[#111214] px-2.5 py-2 texto-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.resumo}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[13px] text-suave">
                Vale na hora, sem derrubar quem está assistindo.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void swapScreen()}>Trocar de tela</Button>
                {soundBlocked || hasSound ? null : (
                  <Button onClick={() => void tabSound()}>Som de uma aba</Button>
                )}
              </div>
            </div>
          ) : null}

          {status ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Linha label="Codec" value={status.codec} />
              <Linha label="Resolução" value={`${status.width}×${status.height}`} />
              <Linha label="Capture" value={status.direct ? "direta (Chromium)" : "via vídeo"} />
              {stats ? (
                <>
                  <Linha label="Assistindo" value={String(stats.viewers)} />
                  <Linha label="Quadros" value={`${stats.fps}/s`} />
                  <Linha label="Banda" value={`${stats.mbps.toFixed(1)} Mb/s`} />
                </>
              ) : null}
            </dl>
          ) : null}

          {/* A banda de subida cresce linearmente com o número de espectadores, e
              isto precisa estar dito na interface, não só na documentação
              (RN-TRX-34). */}
          <p className="text-[13px] text-suave">
            A banda de subida cresce com quem assiste: cinco pessoas a 2,5 Mb/s são 12,5 Mb/s saindo
            daqui.
          </p>
        </>
      )}
    </div>
  );
}

function Linha({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-suave">{label}</dt>
      <dd className="text-texto">{value}</dd>
    </>
  );
}
