# 03 — Restrições técnicas

Nada aqui é escolha nossa. São limites impostos pelo Discord e pelos navegadores
que **definiram o desenho inteiro** do produto. Portar sem entendê-los produz
uma reescrita que não funciona dentro do Discord — que é o único lugar onde ela
precisa funcionar.

## As duas restrições fundadoras

`RN-PRO-1` · herdado · P0 — **A Activity roda num iframe de outro domínio, e
nesse contexto o navegador nega `getDisplayMedia()`.** Só seria liberado se o
Discord marcasse o iframe com `allow="display-capture"`, o que ele não faz.

`RN-PRO-2` · herdado · P0 — **WebRTC não existe em Activities.** A documentação
do Discord diz que só WebSocket é suportado. Sem P2P, sem SFU, sem
`RTCPeerConnection`.

Consequência das duas juntas, e razão de existir de metade deste projeto:

```
QUEM MOSTRA                        SERVIDOR              QUEM ASSISTE
aba normal do navegador                                  Activity (iframe)
  getDisplayMedia  ✅                                          │
  VideoEncoder                                                 │
  └──── WebSocket binário ────►  repassa sem                   │
                                 abrir o quadro ───────────────►
                                                          VideoDecoder → canvas
```

Quem assiste nunca sai do Discord. Só quem mostra passa por uma aba externa.

`RF-TRX-1` · herdado · P0 — Antes de cair para a aba externa, a Activity
**tenta capturar internamente**. Se um dia o Discord conceder
`display-capture`, o caminho já existe e a aba some sozinha. O botão "Testar
captura no iframe", no painel de detalhes, é o diagnóstico manual disso.

`RN-TRX-2` · herdado · P0 — `NotAllowedError` é ambíguo: vale para "a plataforma
bloqueou" e para "a pessoa cancelou o seletor". O que separa os dois é o
**tempo** — bloqueio de política falha instantaneamente, sem nunca desenhar o
seletor; cancelar exige que alguém tenha visto a janela e clicado. O limiar
herdado é **250 ms**.

## Por que WebCodecs, e não MediaRecorder

`RN-TRX-3` · herdado · P0 — A primeira versão usava `MediaRecorder` + Media
Source Extensions e ficava em **~3 segundos** de atraso. O container impõe um
piso: o pedaço só sai depois de fechado, e o player precisa acumular buffer.
WebCodecs elimina os dois — cada quadro é codificado, enviado e desenhado
individualmente. E, ao contrário de `display-capture`, **WebCodecs não é
bloqueado dentro do iframe**.

## O que o proxy do Discord faz com o tráfego

`RN-PRO-3` · herdado · P0 — Dentro da Activity, **todo** `fetch` e WebSocket
precisa do prefixo `/.proxy/`. Fora dela, prefixo vazio. O código antigo resolve
com uma constante:

```ts
const inDiscord = new URLSearchParams(location.search).has('frame_id');
const P = inDiscord ? '/.proxy' : '';
```

No porte isso vira contexto/hook, não uma variável global de módulo — mas a
regra é a mesma, e vale para `/api/*` e para `/ws`.

`RN-PRO-4` · herdado · P0 — O CSP da Activity **bloqueia `cdn.discordapp.com`**,
e o proxy do Discord só repassa domínios mapeados no portal do desenvolvedor.
Por isso os avatares passam por rota própria: `/api/avatar/{id}/{hash}`. A mesma
URL funciona dentro e fora da Activity. A rota já está portada em
`../discord-streaming/app/app/api/avatar/[id]/[hash]/route.js` e vem junto.

`RN-PRO-5` · herdado · P0 — A resposta HTML precisa declarar a cadeia de
iframes, ou o navegador se recusa a desenhar:

```
Content-Security-Policy: frame-ancestors 'self' https://discord.com
  https://*.discord.com https://*.discordsays.com
```

**Armadilha conhecida:** se a borda da hospedagem carimbar
`X-Frame-Options: SAMEORIGIN`, não há nada a fazer daqui — o proxy do Discord
repassa o `X-Frame-Options` da origem e substitui o CSP pelo dele. O sintoma é
cruel: retângulo branco no Discord, log limpo, e o mesmo endereço funcionando
quando aberto direto.

## O que o iframe tira de nós

`RN-UI-8` · herdado · P0 — A **Fullscreen API é negada** ao iframe da Activity
por Permissions Policy. Por isso "tela cheia" é **layout**, não
`requestFullscreen()`: a grade colapsa para uma coluna só e o padding vai a
zero. Funciona nos dois contextos e não depende de permissão nenhuma.

`RN-SES-2` · herdado · P0 — O `localStorage` pode estar **particionado ou
bloqueado** dentro de um iframe de terceiro. Todo acesso vai em `try/catch`, e
falhar significa "sessão só em memória" — nunca "a página não abre". Vale para
apelido, volume, largura da lateral e crachá.

`RN-SES-3` · herdado · P1 — Dentro do Discord a página **não pode se
recarregar sozinha**: o iframe pede a página de novo à hospedagem, e basta ela
devolver `X-Frame-Options` para virar o retângulo branco. Quando há versão
desatualizada, o caminho é **pedir para fechar e reabrir a atividade**, não
`location.reload()`.

## O que precisa continuar fora do Next

`RN-PRO-6` · herdado · P0 — O relay WebSocket **não pode virar Route Handler**.
Um socket binário de longa duração precisa do evento `upgrade` do servidor HTTP,
que Route Handler nenhum expõe, e o estado das salas vive em memória — o que
exige um processo único que não morre entre requisições.

Divisão de responsabilidade, já decidida no projeto antigo e mantida:

| Mora no app Next | Mora no processo `server/` |
|---|---|
| Todo HTML e toda a interface | `/ws` (relay binário) |
| `/api/avatar/*` (espelho, sem segredo) | `/api/rooms/*` (estado em memória) |
| `/termos`, `/privacidade` | `/api/token`, `/api/session*` (segredos) |
| | `/auth/login`, `/auth/callback` |

Quem separa os dois é a porta de entrada — Caddy em produção, proxy de
desenvolvimento localmente — roteando **por caminho**. Sem `rewrites` do Next
de propósito: a porta de entrada já decide o roteamento antes de o Next ver o
pedido, e ela também precisa repassar o `upgrade` do WebSocket, coisa que
rewrite de Next não faz. Duas regras de roteamento em dois lugares divergem.

`RN-SES-4` · herdado · P1 — O **Client ID chega ao navegador pelo HTML
renderizado no servidor**, nunca embutido no bundle. Embutir obrigava a
rebuildar a cada troca de credencial, e esquecer o build não dava erro: a
atividade abria e só quebrava no login, longe da causa. O Client ID é público
por natureza (aparece em toda URL de OAuth); o secret nunca sai do servidor.

## Navegadores

`RN-TRX-4` · herdado · P0 — **Transmitir** exige Chromium (Chrome, Edge, Brave,
Opera). O caminho via `<video>` funciona em Firefox e Safari, mas a captura sai
visivelmente pior — é exigência de produto, não de capacidade. O detector é
`window.MediaStreamTrackProcessor`.

`RN-AST-1` · herdado · P0 — **Assistir** exige apenas `VideoDecoder`
(WebCodecs). Qualquer navegador desktop moderno serve.

`RN-TRX-5` · herdado · P0 — **Celular não transmite**, em nenhum navegador.
`getDisplayMedia` não existe. A mensagem precisa dizer isso, não um erro genérico.
