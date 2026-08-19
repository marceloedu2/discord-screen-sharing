import { notFound } from "next/navigation";

import { Room } from "@/components/room";

/**
 * A sala de um servidor do Discord: `/<id do servidor>`.
 *
 * A galera abre este endereço, o app confere pelo Discord em qual call ela
 * está, e entra na sala daquele canal — criando na primeira pessoa que chega.
 * Não há lista nem criação manual: quem define a sala é a call.
 *
 * Estas salas **não aparecem** para quem chega pela raiz: elas são `isCall`, e
 * `listRooms` não lista `isCall` (RN-SAL-5).
 */
export default async function GuildPage({ params }: PageProps<"/[guild]">) {
  const { guild } = await params;

  // Um segmento dinâmico na raiz pega qualquer coisa. Sem esta guarda, um
  // endereço digitado errado viraria uma tentativa de entrar num servidor
  // inexistente, com mensagem de call em vez de 404.
  if (!/^[0-9]{15,21}$/.test(guild)) notFound();

  return <Room guild={guild} />;
}
