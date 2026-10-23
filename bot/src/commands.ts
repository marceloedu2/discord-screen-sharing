/**
 * Os comandos de barra do bot.
 *
 * O registro é um POST por comando, e não o PUT em massa. O PUT substitui a
 * lista inteira, e a lista inclui o comando de entrada da Activity (o
 * "Launch" do menu de Atividades, que o Discord cria sozinho): sobrescrevê-la
 * sem ele apagaria o jeito atual de abrir a sala. O POST só cria ou atualiza
 * o comando de mesmo nome e não toca nos outros.
 */
import { API, DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID } from './config.ts';

const CHAT_INPUT = 1;
// Em servidor e em DM com o bot; o comando só faz sentido em servidor, mas a
// restrição fica a cargo do Discord (contexts) para não depender de resposta.
const GUILD_CONTEXT = 0;

export const ROOM_COMMAND = 'sala';

const commands = [
  {
    name: ROOM_COMMAND,
    type: CHAT_INPUT,
    description: 'Abre a Sala de Tela no canal de voz em que você está',
    contexts: [GUILD_CONTEXT],
  },
];

export async function registerCommands(): Promise<void> {
  for (const command of commands) {
    const r = await fetch(`${API}/applications/${DISCORD_CLIENT_ID}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });

    if (!r.ok) {
      console.error(`[comandos] /${command.name} falhou (${r.status}): ${await r.text()}`);
      continue;
    }
    console.log(`[comandos] /${command.name} registrado`);
  }
}
