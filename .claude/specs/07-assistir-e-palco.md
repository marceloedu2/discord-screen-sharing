# 07 — Assistir e palco

## Assistir é opt-in

`RN-AST-2` · herdado · P0 — **O servidor não manda os quadros de uma tela para
ninguém que não tenha pedido explicitamente.** É o que segura a banda: filtrar só
na exibição gastaria a mesma saída de rede.

Consequência de interface: cada tela aparece primeiro como um **convite**
("Assistir tela" / "Ver minha tela" quando é a sua), não como vídeo tocando.

`RF-AST-1` · herdado · P0 — Ao pedir para assistir (`watch`), o servidor:

1. Marca o slot como assistido por aquele socket
2. Manda `config` de vídeo, se já tiver
3. Manda `audio-config`, se já tiver
4. **Pede um keyframe novo** ao transmissor
5. Reemite o estado da sala (a contagem de quem assiste mudou)

`RN-AST-3` · herdado · P0 — Keyframe **sob demanda**, não guardado. Quem chega
no meio não decodifica nada até receber um quadro completo; pedir um novo faz a
tela aparecer em ~1 quadro em vez de esperar o periódico.

`RN-AST-4` · herdado · P0 — O servidor **barra quadros parciais** para quem
ainda não recebeu um completo. Alimentar decoder frio com delta só produz erro.
Áudio não passa por esse controle (`RN-AUD-1`).

`RN-AST-5` · herdado · P1 — Pedir para assistir o que já se assiste **não faz
nada**. Sem essa guarda, um cliente em laço faria o servidor inundar a sala
inteira de `state`.

`RF-AST-2` · herdado · P1 — "Parar de assistir" existe em **dois lugares**:
botão × no canto do tile e botão direito no tile. O clique direito pode ser
capturado pelo cliente do Discord antes de chegar até nós, então o botão visível
é o caminho garantido.

`RN-AST-6` · herdado · P0 — Transmissão nova **zera todo mundo**: ninguém
assiste até pedir de novo. Vale para `stream-start` e para reconfiguração.

## Backpressure

`RN-AST-7` · herdado · P0 — Se o socket de um espectador acumula mais de **2 MB**
(4 MB para keyframe), o servidor **descarta quadros para essa pessoa** em vez de
enfileirar. Sem isso, um espectador com internet ruim derruba o processo por
consumo de memória.

Keyframe tem tolerância dobrada de propósito: descartá-lo deixa a pessoa presa
sem imagem até o próximo.

## Os dois layouts

`RN-AST-8` · herdado · P0 — O que decide o layout é **ter alguém transmitindo**:

**Sem transmissão — grade de pessoas.** A sala de espera. Colunas por contagem,
aproximando a call do Discord:

| Pessoas | Colunas |
|---|---|
| 1 | 1 |
| 2–4 | 2 |
| 5–9 | 3 |
| 10+ | 4 |

**Com transmissão — palco.** A tela escolhida ocupa a área principal e, ao lado,
uma barra com as **outras telas em cima** e as **pessoas embaixo**.

Dar a grade inteira à tela esconderia quem está junto, e é a call que se perde
nisso. Deixar tudo igual numa grade condena a tela que importa ao tamanho de um
avatar. A barra resolve as duas, e quem decide o equilíbrio é quem assiste.

`RN-AST-9` · herdado · P1 — **Sempre há uma tela em destaque quando existe
transmissão.** Chegar numa sala com tela no ar e ver só avatares esconderia o
que importa. Se a do palco sai, a próxima assume na renderização seguinte.

`RN-AST-10` · herdado · P1 — Telas primeiro na lateral, pessoas depois: tela é o
que se olha, pessoa é o que se confere. Cada uma no formato que merece — a tela
como miniatura, a pessoa como linha, que cabe muito mais gente no mesmo espaço.

## O divisor

`RF-AST-3` · herdado · P2 — A largura da lateral é arrastável. Duplo clique
restaura o padrão.

| Parâmetro | Valor |
|---|---|
| Padrão | 300 px |
| Mínimo | 200 px |
| Teto | 45% da largura da grade |

`RN-AST-11` · herdado · P1 — A largura vive no `localStorage`: é preferência de
quem assiste, não estado da sala. O teto acompanha a janela — uma largura
guardada grande demais engoliria o palco depois de alguém encolher o Discord.

`RN-AST-12` · herdado · P1 — Os ouvintes do arrasto vão na **janela**, não no
divisor. A grade é reconstruída a cada mudança de estado da sala, e o arrasto
não pode morrer no meio disso.

## Tela cheia

`RF-AST-4` · herdado · P1 — Clique no tile do palco alterna tela cheia. `Esc`
sai. O botão do dock faz o mesmo e só aparece quando há tela no palco.

`RN-AST-13` · herdado · P0 — Tela cheia é **layout, não Fullscreen API**
(`RN-UI-8`): a grade colapsa para uma coluna, o padding vai a zero e o raio do
tile some. Funciona mesmo com a Permissions Policy `fullscreen` negada ao iframe.

`RN-AST-14` · herdado · P1 — **A barra de controles fica** em tela cheia. Sem
ela não haveria saída visível — sair por tecla é atalho, não é caminho.

`RN-AST-15` · herdado · P1 — O rótulo e o `aria-label` do botão mudam com o
estado ("Tela cheia" / "Sair da tela cheia"). O botão faz duas coisas conforme o
estado, e anunciar sempre a mesma coisa mentiria para quem usa leitor de tela.

## O tile

`RN-AST-16` · herdado · P0 — Um tile tem **três estados**, nesta ordem de
precedência:

1. **Vídeo** — a transmissão está sendo assistida
2. **Convite** — está no ar mas não foi pedida ("Assistir tela")
3. **Avatar** — a pessoa não transmite

`RN-AST-17` · herdado · P0 — O canvas de cada transmissão é **um nó de DOM só**.
Ele vive fora do documento entre renderizações e é movido para dentro do tile —
detachar não apaga o conteúdo nem invalida o contexto 2D. Por isso o tile da
lista de pessoas força avatar mesmo para quem transmite: anexar o canvas ali o
arrancaria do palco, que ficaria preto enquanto a miniatura mostrava a tela.

`RN-AST-18` · herdado · P1 — O canvas mantém **sempre o tamanho nativo do vídeo**
no buffer interno. Isso lhe dá proporção intrínseca, e o CSS só o limita com
`max-width`/`max-height`. Dimensionar o buffer pelo tamanho de exibição faz a
proporção depender do container e distorce a imagem durante o redimensionamento.

`RN-AST-19` · herdado · P1 — O tile do palco recebe a `aspect-ratio` do vídeo,
para a moldura abraçar a imagem. Sem isso, uma tela 16:9 num palco largo e baixo
encolhia até caber na altura e sobrava um retângulo preto ocupando metade da área.

`RF-AST-5` · herdado · P1 — Entre pedir para assistir e o primeiro quadro chegar
existe uma espera real. O tile mostra **"Conectando…"** com spinner até o primeiro
quadro ser desenhado. Sem isso a espera é indistinguível de um travamento.

`RF-AST-6` · herdado · P2 — Cada tile de transmissão mostra **quantas pessoas
assistem**, com a lista (avatar + nome) ao passar o mouse. Vazio diz "Ninguém
assistindo".

`RF-AST-7` · herdado · P2 — O próprio usuário aparece marcado com "você" no
canto do tile, e na lista de pessoas como "Nome (você)".

## Menu de contexto

`RF-AST-8` · herdado · P2 — Botão direito num tile de transmissão abre menu com:

- **Volume de \<pessoa\>** — cursor de 0 a 200%, passo de 5
- **Parar de assistir \<pessoa\>**

`RN-AST-20` · herdado · P1 — O cursor de volume **só aparece onde há som para
ajustar**. Oferecer um controle que não faz nada é pior que não oferecer nenhum.

`RN-AST-21` · herdado · P1 — O menu se mantém dentro da janela quando o clique
acontece perto das bordas.

`RN-AST-22` · herdado · P1 — O fechamento por `pointerdown` **ignora cliques
dentro do próprio menu**. `pointerdown` dispara antes de `click`; sem a guarda, o
menu saía do DOM e o `click` nunca chegava ao botão — era por isso que "parar de
assistir" não fazia nada.

## Painel de detalhes

`RF-AST-9` · herdado · P2 — O botão ⓘ abre um painel com, atualizado a cada
segundo:

| Linha | Conteúdo |
|---|---|
| Transmitindo | nomes de quem está no ar, ou "ninguém" |
| Latência | ms, medido pelo relógio de envio |
| Quadros | fps desenhados no último segundo |
| Resolução | tamanho do vídeo recebido |
| Som | um de quatro estados (abaixo) |
| — | botão "Testar captura no iframe" |

`RN-AST-23` · herdado · P1 — Os números são de **um stream por vez** — o do
palco, ou o primeiro. Somar latências de fontes diferentes não significaria nada.

`RN-AST-24` · herdado · P1 — A linha "Som" distingue quatro estados que, sem
ela, parecem todos "sem som":

1. `a transmissão não tem áudio`
2. `aguardando o áudio…`
3. `silenciado aqui`
4. `tocando · <n>%`

`RN-AST-25` · herdado · P2 — O relógio de envio serve **só para medir atraso**. É
exato na mesma máquina; entre máquinas diferentes, aproximado.

## Reconexão

`RF-AST-10` · herdado · P0 — Queda do WebSocket reconecta com backoff
exponencial: 1 s, dobrando, teto de 15 s. Enquanto isso o painel diz
"Reconectando… A conexão com a sala caiu."

`RN-AST-26` · herdado · P0 — Sair da sala de propósito **não reconecta**. A
diferença é `roomTokens` ainda existir ou não.

`RN-AST-27` · herdado · P1 — O `state` limpa o que sumiu sem `stream-stop`
(queda abrupta): tudo que não está na lista de streams vivos é removido de
`available`, `streams` e `watching`.
