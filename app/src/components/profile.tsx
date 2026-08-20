"use client";

import { useState } from "react";

import { Avatar } from "./avatar";
import { Button } from "./button";
import { Modal } from "./modal";
import { MAX_NAME, normalizeName } from "@/lib/name";
import type { Person } from "@/lib/types";

/**
 * O perfil: avatar, nome e de onde a identidade veio (RF-SES-7).
 *
 * O apelido vive no `localStorage`, não no servidor (RN-SES-13) — é preferência
 * de quem assiste, e o servidor não tem cadastro. Ele é reenviado a cada
 * conexão do WebSocket, inclusive nas reconexões: sem isso o nome volta ao do
 * Discord sozinho.
 */
export function Profile({
  user,
  source,
  onSave,
  onLogout,
  onClose,
}: {
  user: Person;
  /** `Discord · <id>` ou `modo local`. */
  source: string;
  onSave: (name: string) => void;
  /** Só existe para quem entrou com o Discord; convidado não tem o que sair. */
  onLogout?: (() => void) | undefined;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);

  function save() {
    const clean = normalizeName(name);
    // Nome vazio depois da normalização é ignorado — não zera o anterior
    // (RN-SES-14).
    if (clean) onSave(clean);
    onClose();
  }

  return (
    <Modal title="Seu perfil" onClose={onClose}>
      <div className="mb-5 flex items-center gap-3">
        <Avatar
          id={user.id}
          name={user.name}
          avatar={user.avatar}
          className="w-12! text-lg!"
        />
        <div className="min-w-0">
          <p className="truncate font-medium text-texto">{user.name}</p>
          <p className="truncate text-[13px] text-suave">{source}</p>
        </div>
      </div>

      <label className="mb-1.5 block text-[13.5px] text-suave" htmlFor="nickname">
        Nome exibido
      </label>
      <input
        id="nickname"
        value={name}
        maxLength={MAX_NAME}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="mb-5 w-full rounded-md border border-linha bg-[#111214] px-2.5 py-2 text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      />

      <div className="flex items-center justify-end gap-2">
        {/* Sair volta a pessoa para convidado — a sessão do Discord fica
            guardada por 30 dias, e este é o caminho de desfazer isso. */}
        {onLogout ? (
          <Button variant="end" onClick={onLogout} className="mr-auto">
            Sair da conta
          </Button>
        ) : null}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save}>
          Salvar
        </Button>
      </div>
    </Modal>
  );
}
