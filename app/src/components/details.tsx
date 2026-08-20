"use client";

import { useEffect, useState } from "react";

import { Button } from "./button";
import { supportError } from "@/lib/broadcaster";
import type { RoomConnection, RoomSnapshot } from "@/lib/room";

/**
 * O painel de detalhes (RF-AST-9), atualizado a cada segundo.
 *
 * Os números são de **um stream por vez** (RN-AST-23) — o do palco, ou o
 * primeiro. Somar latências de fontes diferentes não significaria nada.
 */
export function Details({
  room,
  connection,
  slot,
  onClose,
}: {
  room: RoomSnapshot;
  connection: RoomConnection;
  /** O slot medido, ou null quando não se está assistindo nada. */
  slot: number | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReturnType<RoomConnection["diagnostics"]>>(null);
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    if (slot === null) return;
    const read = () => setData(connection.diagnostics(slot));
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [connection, slot]);

  const onAir = room.participants.filter((p) => p.broadcasting).map((p) => p.name);

  return (
    <div className="absolute right-4 bottom-[76px] z-20 w-[min(360px,calc(100vw-32px))] rounded-lg border border-linha bg-[#111214] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[.07em] text-suave uppercase">
          Details
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="text-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          ×
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <Row label="Transmitindo" value={onAir.length ? onAir.join(", ") : "ninguém"} />
        <Row label="Latência" value={data ? `${Math.round(data.lag)} ms` : "—"} />
        <Row label="Quadros" value={data ? `${data.fps}/s` : "—"} />
        <Row label="Resolução" value={data ? data.video : "—"} />
        <Row label="Som" value={data ? soundText(data) : "—"} />
      </dl>

      {/* O diagnóstico manual de RF-TRX-1: se um dia o Discord conceder
          display-capture, é por aqui que se descobre antes de o caminho da aba
          sumir sozinho. */}
      <Button
        className="mt-4 w-full"
        onClick={() => void testCapture().then(setTest)}
      >
        Testar captura no iframe
      </Button>
      {test ? <p className="mt-2 text-[13px] text-suave">{test}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-suave">{label}</dt>
      {/* Sem truncar: "a transmissão não tem áudio" cortado vira "não tem áu…",
          e o painel existe justamente para dizer a frase inteira. */}
      <dd className="text-texto">{value}</dd>
    </>
  );
}

/** Os quatro estados de RN-AST-24. */
function soundText(d: { sound: string; volume: number }): string {
  if (d.sound === "sem") return "a transmissão não tem áudio";
  if (d.sound === "aguardando") return "aguardando o áudio…";
  if (d.sound === "mudo") return "silenciado aqui";
  return `tocando · ${Math.round(d.volume * 100)}%`;
}

/**
 * Tenta capturar aqui dentro e diz o que aconteceu.
 *
 * `NotAllowedError` instantâneo é a política do iframe; demorado é alguém que
 * viu o seletor e desistiu (RN-TRX-2).
 */
async function testCapture(): Promise<string> {
  const blocker = supportError({});
  if (blocker) return blocker;

  const started = performance.now();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    return "Funciona — a captura aqui dentro foi liberada.";
  } catch (err) {
    const instant = performance.now() - started < 250;
    if (err instanceof Error && err.name === "NotAllowedError") {
      return instant
        ? "Bloqueado pela política do iframe, como esperado. A captura vai pela aba externa."
        : "Você cancelou o seletor — então a captura aqui dentro está liberada.";
    }
    return err instanceof Error ? err.message : "Falhou por motivo desconhecido.";
  }
}
