# 01 — Produto

## Visão

Mostrar sua tela para quem está na mesma call do Discord. Uma pessoa
compartilha, todo mundo assiste **sem sair do Discord**.

O mesmo produto funciona como site normal, fora do Discord, com salas criadas e
compartilhadas por link.

## Os dois contextos

O produto roda em dois lugares, com regras diferentes, e essa diferença atravessa
quase toda spec deste diretório:

| | **Activity** (dentro do Discord) | **Site** (fora) |
|---|---|---|
| Como entra | Foguete 🚀 no canal de voz | Abre a URL |
| Identidade | OAuth do Discord, automático | Convidado, ou login opcional |
| Salas | Não há lista — cai direto na sala da call | Lista de salas, criadas por quem quiser |
| Controle de acesso | Presença no canal de voz | Senha opcional por sala |
| Sair da sala | Fechando a Activity | Botão de sair, volta ao lobby |
| Detecção | `frame_id` presente na query | Ausente |

O detector é `RN-SES-1`. Tudo que difere entre os dois deriva dele.

## Personas

**Quem mostra.** Precisa de desktop com navegador Chromium. Quer clicar em um
botão e estar no ar em segundos, com som quando faz sentido. Não quer descobrir
depois que a call inteira está se ouvindo em eco.

**Quem assiste.** Está na call e quer ver a tela sem perder de vista quem está
junto. Qualquer navegador desktop serve. Controla o próprio volume, escolhe qual
tela olhar e não quer gastar banda com transmissão que não pediu.

**Dono da sala** (só fora do Discord). Criou a sala, define se tem senha e pode
trocá-la depois. É a única pessoa com esse poder.

## Escopo do porte

Entra tudo que hoje existe em `discord-streaming`, reescrito em React +
TypeScript + Tailwind, mais o que está em [10-paridade-discord.md](10-paridade-discord.md).

**Vem sem reescrita** — não é interface, é pipeline de mídia, e reescrever só
introduziria regressão:

| Módulo antigo | Destino | Observação |
|---|---|---|
| `client/src/player.js` | `app/src/lib/player.ts` | decodifica vídeo e desenha no canvas |
| `client/src/audio.js` | `app/src/lib/audio.ts` | decodifica Opus e agenda a reprodução |
| `shared/broadcaster.js` | `app/src/lib/broadcaster.ts` | captura + codificação |

Os três só rodam no navegador (WebCodecs, canvas, `getDisplayMedia`), então quem
os importar é obrigatoriamente Client Component. A tipagem entra por cima; a
lógica não muda.

**Fica fora do app Next** — precisa do evento `upgrade` do servidor HTTP e de
estado em memória num processo só:

- `server/relay.js` + `server/rooms.js` + `server/tokens.js` — o relay WebSocket
  e o registro de salas seguem como processo separado.

Ver [03-restricoes-tecnicas.md](03-restricoes-tecnicas.md) e
[09-protocolo.md](09-protocolo.md).

## Não-objetivos

Registrados para ninguém tentar de novo:

- **Compartilhar do celular.** Nenhum navegador móvel expõe `getDisplayMedia`.
- **Som de programa instalado em captura de tela inteira.** O navegador entrega
  a mistura do sistema, com o Discord dentro. Não existe API web para tirar um
  processo dela. A saída é `RF-TRX-9` (som de uma aba).
- **WebRTC / P2P / SFU.** A documentação do Discord diz que Activities só
  suportam WebSocket.
- **Gravar a transmissão.** Fora do escopo do produto.
- **Escala de broadcast.** Cada espectador consome a qualidade escolhida
  inteira. 5 pessoas a 2,5 Mb/s são 12,5 Mb/s de subida no transmissor.

## Métricas de sucesso

| | Alvo | Como medir |
|---|---|---|
| Latência de vídeo | < 300 ms na mesma rede | painel de detalhes, linha "Latência" |
| Tempo até o primeiro quadro | < 1 s após "Assistir" | keyframe sob demanda (`RN-AST-3`) |
| Erros de console em produção | zero | `npm run test` |
| Estouro horizontal em 390px | zero | `npm run test` |
| Violações axe sérias/críticas | zero | `npm run test` |
