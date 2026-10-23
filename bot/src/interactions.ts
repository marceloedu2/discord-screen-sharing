/**
 * Respostas às interações recebidas pelo Gateway.
 */
import { API, DISCORD_BOT_TOKEN } from './config.ts';
import { ROOM_COMMAND } from './commands.ts';

const APPLICATION_COMMAND = 2;
const PRIMARY_ENTRY_POINT = 4;
const LAUNCH_ACTIVITY = 12;

export interface Interaction {
  id: string;
  token: string;
  type: number;
  data?: { name?: string; type?: number };
}

/**
 * Abre a Activity no canal de voz de quem chamou.
 *
 * O comando de entrada (tipo 4) também cai aqui. Com o tratador padrão
 * (`DISCORD_LAUNCH_ACTIVITY`) o Discord abre a Activity sozinho e nunca nos
 * avisa; se o portal estiver em `APP_HANDLER`, a interação chega e, sem esta
 * resposta, o botão de Atividades mostraria "o aplicativo não respondeu".
 */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.type !== APPLICATION_COMMAND) return;

  const isRoom = interaction.data?.name === ROOM_COMMAND;
  const isEntryPoint = interaction.data?.type === PRIMARY_ENTRY_POINT;
  if (!isRoom && !isEntryPoint) return;

  const r = await fetch(`${API}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: LAUNCH_ACTIVITY }),
  });

  if (!r.ok) console.error(`[interação] abrir a Activity falhou (${r.status}): ${await r.text()}`);
}
