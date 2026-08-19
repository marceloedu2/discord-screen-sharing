"use client";

import { useEffect, useRef, useState } from "react";

import type { RoomConnection } from "@/lib/room";
import { saveVolumeDe } from "@/lib/volume";

/**
 * O menu do botão direito num tile de transmissão (RF-AST-8).
 *
 * Duas coisas só: o volume daquela pessoa e parar de assistir. O clique direito
 * pode ser capturado pelo cliente do Discord antes de chegar até nós, então o ×
 * no canto do tile continua sendo o caminho garantido (RF-AST-2).
 */
export function TileMenu({
  name,
  userId,
  connection,
  hasSound,
  x,
  y,
  pinned,
  onPin,
  onClose,
  onStop,
}: {
  name: string;
  userId: string;
  connection: RoomConnection;
  hasSound: boolean;
  x: number;
  y: number;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  onStop: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(() => connection.volumeDe(userId));
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // O menu se mantém dentro da janela quando o clique acontece perto das
    // bordas (RN-AST-21).
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    // Ignora o que acontece dentro do próprio menu: `pointerdown` dispara antes
    // de `click`, e sem essa guarda o menu saía do DOM e o clique nunca chegava
    // ao botão (RN-AST-22).
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-30 w-[min(260px,calc(100vw-24px))] rounded-lg border border-linha bg-[#111214] py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
    >
      {/* O cursor só aparece onde há som para ajustar: oferecer um controle que
          não faz nada é pior que não oferecer nenhum (RN-AST-20). */}
      {hasSound ? (
        <label className="block px-3 py-2">
          <span className="mb-1.5 block text-[13px] text-suave">
            Volume de {name} — {Math.round(volume * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              saveVolumeDe(userId, v);
              connection.setVolumeDe(userId, v);
            }}
            className="w-full accent-acento"
          />
        </label>
      ) : null}

      <button
        type="button"
        role="menuitem"
        onClick={onPin}
        className="w-full px-3 py-2 text-left text-[14px] text-texto hover:bg-tile focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-acento"
      >
        {pinned ? "Soltar do palco" : "Fixar no palco"}
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onStop}
        className="w-full px-3 py-2 text-left text-[14px] text-texto hover:bg-perigo hover:text-white focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-acento"
      >
        Parar de assistir {name}
      </button>
    </div>
  );
}
