/**
 * Arranque do bot.
 *
 * Processo à parte do `server/`: aquele precisa ficar de pé para segurar as
 * salas em memória, e este só abre a Activity quando alguém pede. Reiniciar um
 * não derruba o outro.
 */
import { registerCommands } from './commands.ts';
import { DISCORD_CLIENT_ID } from './config.ts';
import { connectGateway } from './gateway.ts';

console.log('');
console.log(`  Bot da aplicação ${DISCORD_CLIENT_ID}`);
console.log('');

// Antes do Gateway e sem travar nele: comando que falha ao registrar não
// impede o resto de funcionar, e o erro já fica no log.
await registerCommands().catch((err: unknown) => console.error('[comandos] erro:', err));
connectGateway();
