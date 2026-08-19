import { Pendente } from "@/componentes/pendente";

/**
 * A sala: lobby, grade de telas, barra de controles.
 *
 * Ainda por portar de ../discord-streaming/client/src/main.js. O que vem junto
 * sem reescrita, porque não é interface, está em specs/01-produto.md.
 */
export default function Page() {
  return (
    <Pendente
      titulo="Sala"
      origem="client/src/main.js"
      fase="Fase 2 — Identidade e sala"
      itens={[
        "lobby e lista de salas",
        "grade de pessoas e barra de controles",
        "conexão do WebSocket em /ws",
        "login pelo Discord e sessão de convidado",
      ]}
    />
  );
}
