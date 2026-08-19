# 09 — Protocolo

Contrato entre o app Next e o processo `server/`. **Herdado inteiro** — o porte
é de interface, não de protocolo. Alterar qualquer coisa aqui exige mudar os
dois lados e o `scripts/smoke.mjs` do projeto antigo.

## Rotas HTTP

Todas com prefixo `/.proxy` quando chamadas de dentro da Activity (`RN-PRO-3`).

### No processo `server/`

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/token` | `{ code, client_id }` | `{ access_token }` |
| `POST /api/session` | `{ access_token, instance_id, guild_id, channel_id }` | `{ user, instance, identity, call }` |
| `POST /api/session-guest` | `{ name? }` | `{ user, instance, identity }` |
| `POST /api/session-dev` | `{ instance, name? }` | idem — **404 em produção** |
| `POST /api/rooms/list` | `{ identity? }` | `{ rooms: [...] }` |
| `POST /api/rooms/create` | `{ identity, name?, password? }` | `{ roomId, viewerToken, shareUrl }` |
| `POST /api/rooms/call` | `{ identity }` | idem |
| `POST /api/rooms/join` | `{ identity, roomId, password }` | idem |
| `POST /api/rooms/password` | `{ identity, roomId, password }` | `{ ok, locked }` |
| `GET /auth/login` | — | redirect ao Discord |
| `GET /auth/callback` | `?code` | redirect a `/#identity=...` |
| `GET /api/health` | — | `{ ok, rooms: [...] }` |

`RN-PRO-7` · herdado · P1 — `/api/session-dev` permite escolher a instância, o
que autorizaria espiar as salas de qualquer canal de voz. **Fora do ar em
produção**, sem exceção.

`RN-PRO-8` · herdado · P2 — `/api/health` responde com o estado das salas de
propósito: um processo que responde 200 ali tem servidor **e relay** de pé, não
só a porta aberta. É o `HEALTHCHECK` do Dockerfile.

### No app Next

| Rota | Nota |
|---|---|
| `GET /api/avatar/{id}/{hash}` | espelho do CDN do Discord (`RN-PRO-4`) |
| `GET /termos`, `GET /privacidade` | HTML estático, exigido pelo portal do Discord |

`RN-PRO-9` · herdado · P0 — O espelho de avatar valida `id` e `hash` no formato
exato do Discord (`/^[0-9]{15,21}$/` e `/^(a_)?[0-9a-f]{32}$/`). Sem isso a rota
vira **proxy aberto**, com o servidor buscando qualquer URL que pedirem.

`RN-PRO-10` · herdado · P1 — O `Content-Type` da resposta é fixo em `image/png`,
não o que o upstream disser. Pedimos `.png` e é png que sai. Cache de 1 dia,
`immutable` — o hash muda quando a pessoa troca a foto, então a URL é imutável.
Timeout de 5 s: o CDN fora do ar não pode virar uma sala que não abre.

## Tokens

`RN-PRO-11` · herdado · P0 — Assinados pelo próprio servidor com
`SESSION_SECRET`, sem biblioteca externa. Três escopos:

| Escopo | Campo distintivo | Validade |
|---|---|---|
| Identidade | `scope: 'identity'` | 8 h |
| Espectador | `role: 'viewer'`, `room` | sem prazo (`RN-SAL-21`) |
| Transmissor | `role: 'broadcaster'`, `room` | sem prazo |

`RN-PRO-12` · herdado · P0 — O token de identidade **não dá acesso a sala
nenhuma**. O upgrade do WebSocket exige `payload.room` — sem ele, 401.

`RN-PRO-13` · herdado · P1 — O `shareUrl` aponta para `PUBLIC_ORIGIN/share?t=…`,
não para o endereço deste processo. A página de captura precisa abrir **fora** do
iframe do Discord.

## WebSocket

`GET /ws?t=<token>` — o upgrade valida o token e escolhe o papel por
`payload.role`.

`RN-PRO-14` · herdado · P0 — `maxPayload: 4 MB`. O relay repassa o buffer intacto
para todos os espectadores, então um quadro gigante de um transmissor adulterado
sairia multiplicado por N. Keyframe 1080p a 5 Mbps não passa de algumas centenas
de KB.

`RN-PRO-15` · herdado · P1 — Heartbeat de **30 s** (`ping`/`pong`), derrubando
sockets mortos. Sem isso o contador de espectadores mente.

### Mensagens de controle (JSON)

**Transmissor → servidor**

| Tipo | Corpo | Efeito |
|---|---|---|
| `start` | — | Marca no ar, zera quem assistia |
| `config` | `{ config }` | Guarda e repassa o `decoderConfig` de vídeo |
| `audio-config` | `{ config }` | Guarda e repassa a config de áudio |
| `stop` | — | Encerra a transmissão |

**Espectador → servidor**

| Tipo | Corpo | Efeito |
|---|---|---|
| `watch` | `{ slot }` | Passa a receber os quadros daquele slot |
| `unwatch` | `{ slot }` | Para de receber |
| `rename` | `{ name }` | Troca o nome exibido |
| `stop-broadcast` | — | Pede ao servidor que encerre **a própria** transmissão |

**Servidor → clientes**

| Tipo | Corpo | Quando |
|---|---|---|
| `state` | sala, participantes, streams, quem assiste | qualquer mudança |
| `slot` | `{ slot }` | ao transmissor, na conexão |
| `stream-start` | `{ slot, userId }` | alguém entrou no ar |
| `config` / `audio-config` | `{ slot, config }` | a quem assiste |
| `stream-stop` | `{ slot }` | saiu do ar |
| `need-keyframe` | — | ao transmissor, quando alguém começa a assistir |
| `stop-request` | — | ao transmissor, pedido de parada vindo da Activity |
| `room-gone` | — | a sala fechou entre o token e a conexão |
| `error` | `{ message }` | recusa (limite de slots, já transmitindo, tela lotada) |
| `dropped` | `{ slot }` | descarte por backpressure, ao espectador afetado |

`RN-PRO-20` · novo · P2 — O `dropped` é a única adição ao protocolo herdado, e
ela é de mão única: o servidor avisa, o cliente não responde. Existe porque sem
ele o indicador de qualidade (`RF-AST-17`) não distingue rede de quem assiste de
rede de quem transmite — que é justamente a pergunta que se faz nessa hora. Vai
espaçado em 2 s por espectador: um aviso por quadro perdido seriam dezenas por
segundo, no mesmo socket que já não dá conta.

`RN-PRO-16` · herdado · P0 — `stop-broadcast` só encerra a transmissão **de quem
pediu**, resolvida por `uid`. Ninguém derruba a tela de outra pessoa.

### Quadros (binário)

```
[1B slot][1B tipo][8B timestamp][8B relógio de envio][payload]
 ^ carimbado na origem      ^ float64             ^ float64 (Date.now)
```

| Tipo | Significado |
|---|---|
| `1` | vídeo — keyframe |
| `2` | vídeo — delta |
| `3` | som (Opus) |

`RN-PRO-17` · herdado · P0 — O servidor **repassa o buffer sem tocar nele**. Não
decodifica, não reempacota. O slot vem carimbado na origem justamente para isso,
e quem recebe sabe para qual decodificador mandar.

`RN-PRO-18` · herdado · P0 — O cabeçalho é o **mesmo** para som e imagem. O byte
de tipo é a única coisa que os distingue.

## Ambiente

| Variável | Obrigatória | Nota |
|---|---|---|
| `SESSION_SECRET` | em produção | assina todos os tokens |
| `PORT` | não | padrão 3001 |
| `PUBLIC_ORIGIN` | sim | precisa ser `https://` fora de localhost |
| `DISCORD_CLIENT_ID` | não | vazio = só navegador, sem Discord |
| `DISCORD_CLIENT_SECRET` | não | nunca sai do processo do servidor |
| `DISCORD_BOT_TOKEN` | não | só para confirmar presença na call (`RF-SES-2`) |
| `NODE_ENV` | sim | `production` desliga `/api/session-dev` |
