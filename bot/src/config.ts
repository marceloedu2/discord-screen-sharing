/**
 * Ambiente do bot.
 *
 * É a mesma aplicação do portal do Discord que o `server/` usa, então o
 * `.env` é o mesmo: o `DISCORD_CLIENT_ID` identifica a aplicação e o
 * `DISCORD_BOT_TOKEN` é o token do bot dela. Não há segundo bot.
 */
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || null;
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;

// Sem as duas coisas não há o que fazer, e subir mudo só esconderia o motivo.
if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
  console.error('ERRO: o bot precisa de DISCORD_CLIENT_ID e DISCORD_BOT_TOKEN no .env.');
  process.exit(1);
}

export const API = 'https://discord.com/api/v10';
