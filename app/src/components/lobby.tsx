"use client";

import { useState } from "react";

import { Button } from "./button";
import { Modal } from "./modal";
import { MAX_ROOM_NAME, normalizeName } from "@/lib/name";
import type { RoomSummary } from "@/lib/types";

const CAMPO =
  "w-full rounded-md border border-linha bg-[#111214] px-2.5 py-2 text-texto" +
  " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento";

/**
 * O lobby — a lista de salas, que só existe fora do Discord.
 *
 * Dentro da Activity não há lobby (RN-SAL-1): ela entra direto na sala daquela
 * call, e oferecer uma lista ali seria oferecer uma escolha entre uma opção.
 * Fora dele o lobby é obrigatório (RN-SAL-2) — não há call para herdar, então a
 * lista é a única forma de as pessoas se encontrarem.
 *
 * As salas de servidor (`/<id>`) não aparecem aqui: elas são `isCall`, e a
 * listagem do servidor não lista `isCall` (RN-SAL-5).
 *
 * A recarga de 4 s e a pausa enquanto há modal aberto (RF-SAL-4, RN-SAL-13)
 * vivem em quem chama, que é quem sabe se algum modal está aberto.
 */
export function Lobby({
  rooms,
  loading,
  onEnter,
  onCreate,
  onModalOpen,
}: {
  rooms: RoomSummary[];
  loading: boolean;
  onEnter: (room: RoomSummary) => void;
  onCreate: (name: string, password: string) => void;
  /** Avisa quem controla a recarga que um modal abriu ou fechou. */
  onModalOpen: (open: boolean) => void;
}) {
  const [creating, setCreating] = useState(false);

  function openCreate(open: boolean) {
    setCreating(open);
    onModalOpen(open);
  }

  return (
    // O lobby vive em --painel, não no preto: pela spec 02 o preto é o palco de
    // vídeo, e o painel é a superfície de dock, modal e lobby.
    <div className="h-full w-full overflow-y-auto bg-painel">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-respiro py-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-texto">Salas</h1>
          <Button variant="primario" wide onClick={() => openCreate(true)}>
            Criar sala
          </Button>
        </div>

        {rooms.length === 0 ? (
          <p className="text-suave">
            {loading ? "Carregando…" : "Nenhuma sala aberta. Crie a primeira."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => onEnter(room)}
                  className="flex w-full items-center gap-3 rounded-tile border border-linha bg-tile px-4 py-3 text-left transition-colors hover:bg-tile-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-texto">
                      {room.locked ? "🔒 " : ""}
                      {room.name}
                    </span>
                    <span className="block truncate text-[13px] text-suave">de {room.owner}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-suave">
                    {room.people} {room.people === 1 ? "pessoa" : "pessoas"}
                    {room.streams > 0 ? ` · ${room.streams} no ar` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {creating ? <CreateModal onClose={() => openCreate(false)} onCreate={onCreate} /> : null}
      </div>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Modal
      title="Criar sala"
      // Nome vazio vira "Sala de <quem criou>", e quem decide isso é o
      // servidor, não o cliente (RN-SAL-7).
      sub="O nome é opcional. A senha também — sem ela, qualquer pessoa entra."
      onClose={onClose}
    >
      <label className="mb-1.5 block text-[13.5px] text-suave" htmlFor="nomeSala">
        Nome
      </label>
      <input
        id="nomeSala"
        value={name}
        maxLength={MAX_ROOM_NAME}
        placeholder="Sala de teste"
        onChange={(e) => setName(e.target.value)}
        className={`${CAMPO} mb-4`}
      />

      <label className="mb-1.5 block text-[13.5px] text-suave" htmlFor="senhaSala">
        Senha <span className="text-suave">(opcional)</span>
      </label>
      <input
        id="senhaSala"
        type="password"
        value={password}
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
        className={`${CAMPO} mb-5`}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="primario"
          onClick={() => onCreate(normalizeName(name, MAX_ROOM_NAME), password)}
        >
          Criar
        </Button>
      </div>
    </Modal>
  );
}

/**
 * A senha da sala, para quem a criou (RF-SAL-6).
 *
 * Campo vazio **remove** a senha. Só o dono muda, e o servidor confere de novo
 * mesmo com o botão escondido no cliente (RN-SAL-15) — esconder é conveniência,
 * não controle de acesso.
 */
export function ChangePasswordModal({
  hasPassword,
  onClose,
  onSave,
}: {
  hasPassword: boolean;
  onClose: () => void;
  onSave: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <Modal
      title="Senha da sala"
      sub={
        hasPassword
          ? "Deixe em branco para remover a senha."
          : "Deixe em branco para a sala continuar aberta."
      }
      onClose={onClose}
    >
      <input
        id="novaSenha"
        type="password"
        value={password}
        autoFocus
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSave(password)}
        className={CAMPO}
      />

      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primario" onClick={() => onSave(password)}>
          Salvar
        </Button>
      </div>
    </Modal>
  );
}

/**
 * O pedido de senha, aberto quando entrar responde 403 ou 429 (RF-SAL-5).
 *
 * `error` carrega o texto do freio de força bruta (RN-SAL-17), que diz quantos
 * segundos faltam — sem isso a recusa parece a mesma de senha errada, e a
 * pessoa continua tentando.
 */
export function PasswordModal({
  room,
  error,
  onClose,
  onSubmit,
}: {
  room: RoomSummary;
  error: string | null;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <Modal title={room.name} sub="Esta sala pede senha." onClose={onClose}>
      <input
        id="senhaEntrar"
        type="password"
        value={password}
        autoFocus
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit(password)}
        className={CAMPO}
      />

      {error ? <p className="mt-2 text-[13.5px] text-perigo">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primario" onClick={() => onSubmit(password)}>
          Entrar
        </Button>
      </div>
    </Modal>
  );
}
