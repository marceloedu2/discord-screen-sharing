"use client";

import { useState } from "react";

import { Button } from "./button";
import { Modal } from "./modal";
import { PRESETS, DEFAULT_PRESET, type Preset } from "@/lib/presets";

/**
 * As duas escolhas antes de qualquer captura (RF-TRX-2).
 *
 * O mesmo modal serve para começar e para ajustar no ar: em `ajuste` os campos
 * vêm com os valores atuais e o botão aplica em vez de iniciar (RF-TRX-7).
 *
 * Som não é escolha daqui (RN-TRX-24c): o pedido de áudio é sempre feito
 * (`audioConstraints()`, incondicional), e quem decide se aquela transmissão
 * leva som é o seletor **nativo** do navegador — o checkbox que já vem com
 * ele. Um segundo checkbox neste modal, do lado de fora, só duplicava a
 * pergunta com o risco de os dois discordarem.
 *
 * "60 fps não é garantido" está dito aqui, e não escondido na documentação: sem
 * codificação por hardware o navegador não dá conta de 60 quadros em tela
 * grande e entrega menos (RN-TRX-33).
 */
export function BroadcastModal({
  adjust = false,
  currentPreset = DEFAULT_PRESET,
  onClose,
  onConfirm,
}: {
  adjust?: boolean;
  currentPreset?: Preset;
  onClose: () => void;
  onConfirm: (preset: Preset) => void;
}) {
  const [preset, setPreset] = useState(currentPreset);

  return (
    <Modal
      title={adjust ? "Ajustes da transmissão" : "Compartilhar sua tela"}
      sub={
        adjust
          ? "Vale na hora, sem derrubar quem está assistindo."
          : "Escolha a qualidade e comece a transmitir."
      }
      onClose={onClose}
    >
      <fieldset className="mb-4">
        <legend className="mb-2 text-[11px] font-semibold tracking-[.07em] text-suave uppercase">
          Qualidade
        </legend>
        <div className="flex flex-col gap-1.5">
          {PRESETS.map((p) => (
            <label
              key={p.id}
              className={
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors" +
                (p.id === preset.id
                  ? " border-acento bg-acento/10"
                  : " border-linha hover:bg-tile")
              }
            >
              <input
                type="radio"
                name="preset"
                checked={p.id === preset.id}
                onChange={() => setPreset(p)}
                className="accent-acento"
              />
              <span className="flex-1">
                <span className="block text-[14px] font-medium text-texto">{p.name}</span>
                <span className="block text-[13px] text-suave">
                  {p.summary} · {(p.bitrate / 1_000_000).toLocaleString("pt-BR")} Mb/s
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mb-4 text-[13px] text-suave">
        60 fps não é garantido: sem codificação por hardware o navegador entrega menos.
      </p>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" wide onClick={() => onConfirm(preset)}>
          {adjust ? "Aplicar" : "Compartilhar tela"}
        </Button>
      </div>
    </Modal>
  );
}
