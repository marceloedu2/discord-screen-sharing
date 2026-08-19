# 04 — Identidade e sessão

## Detecção de contexto

`RN-SES-1` · herdado · P0 — Estamos dentro do Discord se, e somente se, a query
string tem `frame_id`. O Discord injeta `frame_id` e `instance_id` na URL do
iframe. Sem eles, é navegador comum.

## Dentro do Discord

`RF-SES-1` · herdado · P0 — O login é automático, sem tela. Sequência:

1. `new DiscordSDK(clientId)` → `sdk.ready()`
2. `sdk.commands.authorize({ response_type: 'code', prompt: 'none', scope: ['identify'] })`
3. `POST /api/token` com o `code` → o servidor troca pelo `access_token`
4. `sdk.commands.authenticate({ access_token })`
5. `POST /api/session` com `access_token`, `instance_id`, `guild_id`, `channel_id`
   → devolve o crachá

`RN-SES-5` · herdado · P0 — O escopo pedido é **só `identify`**. Menos escopo,
menos atrito na tela de consentimento, e não precisamos de mais nada.

`RN-SES-6` · herdado · P1 — O `client_id` vem preferencialmente de
`params.get('client_id')`, que o Discord injeta na URL. A config do servidor
entra apenas como reserva. Depender da ida ao servidor deixava a atividade parada
sem nada para mostrar quando ela demorava.

`RN-SES-7` · herdado · P1 — Se a Activity e o servidor forem de aplicações
diferentes, `POST /api/token` responde **409** com as duas ids no texto. O erro
que o Discord devolve nesse caso não diz qual das duas está errada, e a caçada
custa horas.

### Confirmação de presença na call

`RF-SES-2` · herdado · P2 — Com `DISCORD_BOT_TOKEN` configurado, o servidor
confirma **com o Discord** que a pessoa está conectada ao canal de voz. O
resultado tem três estados:

| Resultado | Efeito |
|---|---|
| `ok` | O `channel_id` entra no crachá assinado (campo `call`) |
| `fora` | **403** — "Entre na call antes de abrir a atividade." |
| indeterminado (sem bot token) | Segue sem `call`; o escopo cai para a instância |

`RN-SES-8` · herdado · P2 — O canal entra no **token assinado**, não só na
resposta. É o que permite ao endpoint da sala da call confiar sem consultar o
Discord de novo a cada entrada.

## Fora do Discord

`RF-SES-3` · herdado · P0 — Sem identidade nenhuma, a pessoa entra como
**convidado**: `POST /api/session-guest` emite um crachá com id `guest-*`. O
login do Discord é uma melhoria opcional, não um pedágio para assistir uma tela.

`RF-SES-4` · herdado · P1 — O botão "Entrar com Discord" leva a `/auth/login`.
O callback devolve o crachá **no fragmento da URL** (`/#identity=...`), não na
query.

`RN-SES-9` · herdado · P0 — O fragmento não é enviado ao servidor nem aparece em
log de proxy. O cliente lê, guarda e **limpa a barra de endereço** com
`history.replaceState` — o token não fica visível nem no histórico.

`RN-SES-10` · herdado · P1 — Subir de convidado para conta do Discord
**substitui** a identidade. As salas criadas como convidado ficam sem dono. É
aceito e documentado; o alternativo seria migrar propriedade de sala entre ids,
o que não vale a complexidade para salas que vivem minutos.

## O crachá

`RN-SES-11` · herdado · P0 — O crachá é um token assinado pelo servidor
(`SESSION_SECRET`), sem biblioteca externa, com validade de **8 horas**. Carrega:
`{ instance, uid, name, av, scope: 'identity', call? }`.

`RN-SES-12` · herdado · P0 — O cliente **decodifica sem validar** apenas para
descartar o que já venceu, e não tentar usar um token morto. Quem valida a
assinatura é sempre o servidor.

`RF-SES-5` · herdado · P0 — **Renovação automática.** Um `401` numa chamada que
levava `identity` significa crachá morto, não falta de permissão. O cliente
descarta, emite um novo e **repete a chamada uma vez**. A chamada de renovação
não pode cair nela mesma — daí o parâmetro `retry: false`.

Motivo: o segredo que assina muda em reinstalação, troca de máquina ou rotação.
Quando isso acontece, todo crachá guardado vira inválido de uma vez, e sem a
renovação a pessoa ficava presa em "sessão inválida" sem nada na interface que
resolvesse.

`RF-SES-6` · herdado · P1 — Se o WebSocket **fecha sem nunca ter aberto**, o
token de sala foi recusado. O cliente descarta o token guardado, avisa "Sua
sessão expirou. Entrando de novo…" e recomeça — na call, dentro do Discord; no
lobby, fora dele. Reconectar com o mesmo token repetiria o 401 para sempre.

## Perfil e apelido

`RF-SES-7` · herdado · P1 — A pessoa pode trocar o **nome exibido**, até 32
caracteres. O modal mostra avatar, nome, e a origem da identidade
(`Discord · <id>` ou `modo local`).

`RN-SES-13` · herdado · P1 — O apelido vive no **`localStorage`, não no
servidor**. Ele é reenviado a cada conexão do WebSocket — inclusive nas
reconexões, senão o nome volta ao do Discord sozinho.

`RN-SES-14` · herdado · P1 — Normalização do nome, em qualquer entrada:
colapsa espaços consecutivos, remove das pontas, corta em 32 caracteres. Nome
vazio depois disso é ignorado — não zera o anterior.

## Tempo limite e diagnóstico

`RN-SES-15` · herdado · P1 — Todo `POST` tem prazo de **15 s**; a busca de
config, **6 s**. Um pedido pendurado é pior que um que falha: o que falha diz
alguma coisa, o pendurado só deixa a tela parada.

`RF-SES-8` · herdado · P1 — Se o arranque não terminar em **8 s**, o painel
inicial troca para "Está demorando… Sem resposta do servidor. Ele está no ar?".
Sem esse vigia, qualquer espera que não termina fica com cara de "Conectando…"
para sempre.

`RN-SES-16` · herdado · P2 — Nem o client id nem o diagnóstico de versão podem
impedir a sala de abrir. `loadConfig()` falha em silêncio e devolve `{}`.
