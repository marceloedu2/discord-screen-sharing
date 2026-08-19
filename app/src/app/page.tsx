import { Room } from "@/components/room";

/**
 * A sala: lobby, grade de pessoas e barra de controles.
 *
 * A rota é a mesma nos dois contextos, e o que muda é o estado — dentro do
 * Discord ela entra direto na sala da call; fora, abre o lobby (RN-SAL-1,
 * RN-SAL-2). Quem decide é o `frame_id` na query (RN-SES-1), lido pelo contexto
 * que o layout monta.
 *
 * O componente é cliente porque tudo aqui depende de coisas que só existem no
 * navegador: WebSocket, localStorage e o SDK do Discord.
 */
export default function Page() {
  return <Room />;
}
