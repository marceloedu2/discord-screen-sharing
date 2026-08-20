"use client";

import { Avatar } from "./avatar";
import { Screen } from "./screen";
import type { RoomConnection, RoomSnapshot } from "@/lib/room";
import { MAX_VIEWERS_PER_STREAM, type Person } from "@/lib/types";

/**
 * A grade — todo mundo em células iguais, telas e pessoas juntas.
 *
 * É o layout padrão, como o "Exibição em grade" do Discord (RF-AST-13). O outro
 * é o foco, com uma tela grande e as demais numa faixa embaixo.
 *
 * As colunas seguem a contagem (RN-AST-8), aproximando a call do Discord: dar
 * quatro colunas a duas pessoas deixaria dois retângulos perdidos num campo
 * preto.
 */
function columns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-3";
  return "grid-cols-4";
}

export function Grid({
  room,
  connection,
  myId,
  showWithoutVideo,
  onFocus,
  onMenu,
  poppedOut,
}: {
  room: RoomSnapshot;
  connection: RoomConnection;
  myId: string;
  /** "Mostrar participantes sem vídeo" — quem não transmite entra na grade. */
  showWithoutVideo: boolean;
  onFocus: (slot: number) => void;
  onMenu: (slot: number, userId: string, x: number, y: number) => void;
  /** O slot que está na janela destacada, se houver (RF-AST-19). */
  poppedOut: number | null;
}) {
  const watching = new Set(room.watching);
  const drawing = new Set(room.drawing);
  const personOf = (id: string) => room.participants.find((p) => p.id === id) ?? null;

  const withoutScreen = showWithoutVideo
    ? room.participants.filter((p) => !room.streams.some((s) => s.userId === p.id))
    : [];

  const total = room.streams.length + withoutScreen.length;
  if (total === 0) return null;

  return (
    // `auto-rows-fr`: sem isto as fileiras se dimensionam pelo conteúdo, e a que
    // tem vídeo estica enquanto a de avatares encolhe — na captura, 590px contra
    // 160px. Todo mundo do mesmo tamanho é o que a grade promete.
    <div className={`grid h-full w-full auto-rows-fr gap-grade p-respiro ${columns(total)}`}>
      {/* Telas primeiro, pessoas depois: tela é o que se olha, pessoa é o que
          se confere (RN-AST-10). */}
      {room.streams.map((s) => (
        // Uma div, e não um botão: o tile já tem um botão dentro (o convite
        // para assistir), e botão dentro de botão é HTML inválido — o React
        // acusa erro de hidratação. O duplo clique é atalho de mouse; o
        // caminho acessível para trocar de modo é o menu do "…".
        <div
          key={s.slot}
          onDoubleClick={() => onFocus(s.slot)}
          className="min-h-0"
        >
          <Screen
            slot={s.slot}
            person={personOf(s.userId)}
            connection={connection}
            watching={watching.has(s.slot)}
            drawing={drawing.has(s.slot)}
            isMe={s.userId === myId}
            kind={s.kind}
            onWatch={() => connection.watch(s.slot)}
            onStop={() => connection.unwatch(s.slot)}
            occupancy={occupancyOf(s.watchers.length)}
            connectionQuality={room.quality[s.slot]}
            poppedOut={poppedOut === s.slot}
            onMenu={(x, y) => onMenu(s.slot, s.userId, x, y)}
            className="h-full w-full"
          />
        </div>
      ))}

      {withoutScreen.map((p) => (
        <PersonTile key={p.id} person={p} isMe={p.id === myId} />
      ))}
    </div>
  );
}

/** Só mostra a partir de 75% do teto: antes disso é ruído (RF-AST-12). */
export function occupancyOf(count: number): string | null {
  return count >= MAX_VIEWERS_PER_STREAM * 0.75 ? `${count}/${MAX_VIEWERS_PER_STREAM}` : null;
}

/**
 * A pessoa sem tela: avatar ao centro, nome no rodapé.
 *
 * Força avatar mesmo para quem transmite — anexar o canvas aqui o arrancaria do
 * palco, que ficaria preto enquanto a miniatura mostrava a tela (RN-AST-17).
 */
export function PersonTile({
  person,
  isMe,
  compact = false,
  className = "",
}: {
  person: Person;
  isMe: boolean;
  /** Na faixa de miniaturas o tile tem 186x104: o avatar cheio encosta no nome. */
  compact?: boolean;
  className?: string;
}) {
  return (
    // A forma vem de quem usa: na grade o tile preenche a célula; na faixa ele
    // recebe 186×104, que é 16:9. O que não pode é ficar com a altura do
    // conteúdo — é neste retângulo que a webcam vai entrar, e câmera esmagada
    // não tem conserto no CSS de quem assiste.
    <div
      className={
        "relative grid min-h-0 place-items-center overflow-hidden rounded-tile bg-tile " +
        className
      }
    >
      <Avatar
        id={person.id}
        name={person.name}
        avatar={person.avatar}
        className={compact ? "w-10! text-[14px]!" : ""}
      />

      <span
        className={
          "absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded bg-black/65 backdrop-blur-[8px] " +
          (compact ? "px-1.5 py-0.5" : "px-2 py-1")
        }
      >
        <span className={`truncate font-medium text-texto ${compact ? "text-[11px]" : "text-[13px]"}`}>
          {person.name}
          {isMe ? " (você)" : ""}
        </span>
      </span>
    </div>
  );
}
