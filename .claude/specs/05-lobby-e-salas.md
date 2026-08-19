# 05 — Lobby e salas

## Onde há lobby, e onde não há

`RN-SAL-1` · herdado · P0 — **Dentro do Discord não existe lobby.** A Activity
entra direto na sala daquela call. Oferecer uma lista ali seria oferecer uma
escolha entre uma opção.

`RN-SAL-2` · herdado · P0 — **Fora do Discord o lobby é obrigatório.** Não há
call para herdar, então a lista de salas é a única forma de as pessoas se
encontrarem.

## A sala da call

`RF-SAL-1` · herdado · P0 — `POST /api/rooms/call` devolve (criando na primeira
pessoa que chega) a sala fixa daquela call.

`RN-SAL-3` · herdado · P0 — O id é **derivado do canal**, não da instância:
`call-<channel_id>` quando a presença foi confirmada, `atividade-<instance_id>`
quando não. A instância muda a cada relançamento no mesmo canal; o canal é
estável. Sem isso, a sala sumiria a cada relaunch.

`RN-SAL-4` · herdado · P0 — A sala da call **não tem dono nem senha**. Quem
controla o acesso é a própria call: só entra quem o Discord confirmou estar
conectado ao canal.

`RN-SAL-5` · herdado · P1 — A sala da call **não aparece na lista**. Dentro do
Discord a atividade entra nela direto; no site ela nunca poderia ser aberta.
Listá-la seria mostrar uma porta que não abre.

`RN-SAL-6` · herdado · P0 — Ao entrar numa sala `isCall`, a validação é
`room.id === salaDaCall(me)` — a presença no canal manda, **antes** da checagem
de instância. Checar instância aqui recusaria por motivo errado, já que o id vem
do canal.

## Criar

`RF-SAL-2` · herdado · P0 — `POST /api/rooms/create` com `name` (opcional) e
`password` (opcional). Exige crachá válido.

`RN-SAL-7` · herdado · P1 — Nome vazio vira `Sala de <nome de quem criou>`. O
**servidor** decide isso, não o cliente.

`RN-SAL-8` · herdado · P1 — Nome de sala: colapsa espaços, corta em **40**
caracteres. Nome de pessoa: **32**.

`RN-SAL-9` · herdado · P0 — Teto de **20 salas abertas por instância**. Sala é
objeto em memória criado por qualquer pessoa autenticada; sem teto, um laço de
"criar sala" consome a RAM do processo. Estourado, a resposta é **400** com
"Limite de salas abertas atingido. Feche uma antes de criar outra."

`RN-SAL-10` · herdado · P1 — O id da sala é `crypto.randomBytes(6)` em
base64url. Aleatório e curto o bastante para caber num link.

## Listar

`RF-SAL-3` · herdado · P0 — `POST /api/rooms/list` devolve as salas da
instância, ordenadas por criação, **sem exigir login**. Dá para ver o lobby
antes de entrar; criar e entrar é que pedem identidade.

`RN-SAL-11` · herdado · P0 — A lista **nunca vaza o hash da senha**, só se ela
existe (`locked: boolean`). Cada item traz: `id`, `name`, `owner`, `locked`,
`people`, `streams`.

`RN-SAL-12` · herdado · P1 — `people` conta **ids distintos**, não sockets. A
mesma pessoa pode ter a sala aberta em mais de uma aba.

`RF-SAL-4` · herdado · P1 — O lobby recarrega sozinho a cada **4 s**. Salas
abrem, enchem e fecham enquanto alguém olha a lista parada.

`RN-SAL-13` · herdado · P1 — A recarga **pausa enquanto houver modal aberto**
(criar, senha). Recarregar sob o cursor tiraria o card do lugar no meio de um
clique.

## Entrar

`RF-SAL-5` · herdado · P0 — `POST /api/rooms/join` com `roomId` e `password`.
Devolve os tokens da sala.

`RN-SAL-14` · herdado · P0 — Salas de uma instância **não aparecem nem abrem em
outra**. Instância errada responde **404** ("Sala não existe mais."), não 403 —
não confirmamos a existência de sala de outro canal.

Mapa de erros, que o cliente usa para decidir o que fazer:

| Status | Significado | Reação do cliente |
|---|---|---|
| `403` | Senha incorreta (ou ausente) | Abre o modal de senha |
| `429` | Bloqueado por tentativas | Modal de senha com o texto do bloqueio |
| `404` | Sala fechou | Toast, limpa o token guardado, recarrega a lista |
| `401` | Crachá morto | Renova e repete uma vez (`RF-SES-5`) |

## Senha

`RF-SAL-6` · herdado · P1 — Senha é opcional, definida na criação e alterável
depois. Campo vazio **remove** a senha.

`RN-SAL-15` · herdado · P0 — **Só o dono muda a senha.** O servidor confere de
novo, mesmo com o botão escondido no cliente.

`RN-SAL-16` · herdado · P0 — Senha guardada como `scrypt` com salt de 16 bytes,
hash de 32. Comparação com `timingSafeEqual`.

`RN-SAL-17` · herdado · P0 — **Freio de força bruta**, por sala:

| Parâmetro | Valor |
|---|---|
| Tentativas antes do bloqueio | 5 |
| Janela de contagem | 60 s |
| Duração do bloqueio | 30 s |

Sem isso uma senha curta cai em segundos, porque o endpoint responde tão rápido
quanto a rede permite. A resposta de bloqueio diz **quantos segundos faltam**.

`RN-SAL-18` · herdado · P1 — Acerto zera as tentativas. Trocar a senha também
zera tentativas e bloqueio.

## Ciclo de vida

`RN-SAL-19` · herdado · P0 — Salas vivem **em memória** e somem no restart do
processo. É aceito: elas duram minutos e o id é aleatório.

`RN-SAL-20` · herdado · P0 — Sala vazia fecha **12 segundos** depois de esvaziar,
verificado a cada 4 s. A carência existe porque recarregar a atividade
desconecta e reconecta — sem ela, quem estivesse sozinho perderia a sala a cada
F5. Vazia = zero espectadores **e** zero transmissores.

`RF-SAL-7` · herdado · P1 — Quando a sala some, o servidor manda `room-gone`. No
Discord o cliente **recria e volta para a sala da call**; no site, avisa
"A sala foi fechada." e volta ao lobby.

## Link e recarga

`RF-SAL-8` · herdado · P1 — A sala atual fica em `?sala=<id>` na barra de
endereço, preservando os parâmetros do Discord. Serve para recarregar estando
numa sala e para abrir link que alguém mandou.

`RF-SAL-9` · herdado · P2 — Os tokens da sala são guardados em
`localStorage` sob `sala:<id>`. Numa visita seguinte, entra **sem pedir a senha
de novo**. Se o token guardado falhar, o fluxo normal assume e pede a senha.

`RN-SAL-21` · herdado · P1 — Tokens de sala **não têm prazo**: quem entrou fica.
A sala fecha ao esvaziar e o id é aleatório, então o token morre junto com ela.

## Sair

`RF-SAL-10` · herdado · P0 — Sair da sala é um **funil único**: sair pelo botão,
a sala fechar sozinha e o arranque precisam deixar exatamente o mesmo estado
para trás.

`RN-SAL-22` · herdado · P0 — **Parar a transmissão vem primeiro.** A captura da
aba externa só para se o servidor avisar, e depois do `close()` não sobra por
onde avisar. Deixar a captura viva depois de sair é vazamento de tela, não
detalhe de interface.

Ordem da limpeza: parar transmissão → fechar streams → limpar `available`,
`watching`, `participants` → apagar token guardado → zerar palco e tela cheia →
fechar o socket.

`RN-SAL-23` · herdado · P1 — Dentro do Discord **não há botão de sair**: quem
fecha a atividade é o próprio Discord, e não há lista para onde voltar.
