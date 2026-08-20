# 10 — Paridade com o Discord

Levantamento do que a tela de transmissão do Discord tem hoje e este projeto
não. O critério de entrada foi estreito de propósito: **só o que pertence à
experiência de compartilhar e assistir tela**. Microfone, soundboard,
mensagens e Activities são o Discord em volta — não este produto.

Câmera **entrou**, revertendo a exclusão original — ver "Por que entrou" em
`06-transmissao.md`.

Cada item traz o que existe lá, o que existe aqui e como fica.

## Resumo

| # | Item | Prioridade | Custo |
|---|---|---|---|
| 1 | Presets de qualidade por resolução | P1 | baixo |
| 2 | Teto de espectadores por transmissão | P1 | baixo |
| 3 | Alternar Grade ↔ Foco explicitamente | P2 | baixo |
| 4 | Ocultar participantes | P2 | baixo |
| 5 | Atalhos de teclado | P2 | baixo |
| 6 | Controles somem em tela cheia | P2 | baixo |
| 7 | Aviso quando alguém entra no ar | P2 | baixo |
| 8 | Fixar uma tela no palco | P2 | baixo |
| 9 | Prévia antes de ir ao ar | P2 | médio |
| 10 | Indicador de qualidade de conexão | P2 | médio |
| 11 | Janela destacada (pop-out / PiP) | P2 | médio |
| 12 | Reações em emoji sobre a tela | P3 | médio |
| 13 | Chat de texto da sala | P3 | alto |
| 14 | Assistir pelo celular | P3 | alto |

---

## 1. Presets de qualidade por resolução

**No Discord.** A qualidade é escolhida por **resolução e taxa de quadros** —
720p/1080p/1440p/4K × 30/60 fps —, com o teto amarrado ao nível de Nitro. O
padrão é 720p 30 fps.

**Aqui.** Escolhe-se **bitrate em Mbps** (1 / 2,5 / 5 / 8) e fps (15 / 30 / 60).
A resolução é sempre a da fonte, limitada a 1080p (`RN-TRX-14`).

`RF-TRX-11` · novo · P1 — Os presets passam a ser nomeados por resolução, com o
bitrate como consequência e não como escolha:

| Preset | Resolução máx. | fps | Bitrate |
|---|---|---|---|
| Leve | 720p | 15 | 1 Mbps |
| **Boa** (padrão) | 1080p | 30 | 2,5 Mbps |
| Alta | 1080p | 60 | 5 Mbps |
| Máxima | 1080p | 60 | 8 Mbps |

`RN-TRX-35` · novo · P1 — O preset continua **ajustável no ar** (`RF-TRX-7`), e
o modo avançado mantém bitrate e fps separados para quem quiser. A troca é de
rótulo e de modelo mental, não de capacidade: "720p" diz mais do que "1 Mbps"
para quem só quer escolher.

`RN-TRX-36` · novo · P2 — A redução para 720p usa o mesmo caminho de `fitWithin`
(proporcional, nunca cortada) — só muda o teto.

> **Não copiar:** o escalonamento por Nitro. Não há níveis pagos aqui.

---

## 2. Teto de espectadores por transmissão

**No Discord.** Go Live aceita **50 espectadores simultâneos** por transmissão.

**Aqui.** Não há teto nenhum. A banda de subida cresce linearmente
(`RN-TRX-34`), então a 8 Mbps o décimo espectador já pede 80 Mb/s de upload —
que ninguém tem. O sintoma não é uma recusa clara: é a transmissão de todo mundo
degradando junto, e o backpressure (`RN-AST-7`) descartando quadros sem que
ninguém entenda por quê.

`RF-AST-11` · novo · P1 — Teto configurável de espectadores **por transmissão**,
padrão **12**. Ao estourar, o `watch` é recusado com `error` explicando:
"Esta tela já está no limite de espectadores."

`RN-AST-28` · novo · P1 — O teto é por transmissão, não por sala: quatro telas
com doze espectadores cada é banda de quatro transmissores diferentes.

`RF-AST-12` · novo · P2 — O tile mostra a ocupação quando passa de 75% do teto
("9/12 assistindo"), para a recusa não chegar de surpresa.

---

## 3. Alternar Grade ↔ Foco explicitamente

**No Discord.** Um botão no canto superior direito alterna entre **Grade** e
**Foco**. Quem assiste decide.

**Aqui.** O layout é decidido pelo sistema: existe transmissão, vira palco
(`RN-AST-8`). Não há como voltar à grade sem parar de assistir todo mundo.

`RF-AST-13` · novo · P2 — Botão de alternar layout no dock, com dois modos:

- **Foco** (padrão quando há transmissão) — palco + lateral, como hoje
- **Grade** — todas as telas e pessoas em células iguais, como a sala de espera

`RN-AST-29` · novo · P2 — A escolha vive no `localStorage`, como a largura da
lateral (`RN-AST-11`): é preferência de quem assiste. O padrão continua sendo
Foco na primeira transmissão da sessão.

`RN-AST-30` · novo · P2 — Em Grade, várias telas assistidas ao mesmo tempo
significam vários decodificadores ativos. O teto de 4 transmissores por sala
(`RN-TRX-9`) já limita isso; nenhuma mudança adicional é necessária.

---

## 4. Ocultar participantes

**No Discord.** "Hide Members" recolhe a faixa de participantes e devolve o
espaço para a tela. "Show Members" traz de volta.

**Aqui.** A lateral só some em tela cheia, que também esconde as outras telas.
Não existe meio-termo.

`RF-AST-14` · novo · P2 — Botão para recolher **só a lista de pessoas** da
lateral, mantendo as outras telas visíveis. Estado no `localStorage`.

`RN-AST-31` · novo · P2 — Recolher pessoas não é o mesmo que tela cheia: a
lateral continua existindo com as miniaturas, e o divisor continua arrastável.

---

## 5. Atalhos de teclado

**No Discord.** Atalhos globais e por contexto, todos remapeáveis.

**Aqui.** Só `Esc` — fecha o modal mais recente, ou sai da tela cheia.

`RF-UI-1` · novo · P2 — Conjunto mínimo, sem remapeamento:

| Tecla | Ação |
|---|---|
| `Esc` | fecha modal / sai da tela cheia *(já existe)* |
| `F` | alterna tela cheia |
| `M` | silencia e devolve o som geral |
| `G` | alterna Grade ↔ Foco |
| `P` | recolhe / mostra as pessoas |
| `1`–`4` | põe a tela daquele slot no palco |
| `?` | abre a lista de atalhos |

`RN-UI-9` · novo · P2 — Atalho **nunca dispara com foco em campo de texto**, nem
com modal aberto (exceto `Esc`). O apelido tem `M` e `F` como qualquer palavra.

`RN-UI-10` · novo · P2 — Dentro da Activity, o cliente do Discord captura alguns
atalhos antes de chegarem ao iframe. Os que sobrarem funcionam; nenhum atalho
pode ser o **único** caminho para uma ação — todos têm botão visível.

---

## 6. Controles somem em tela cheia

**No Discord.** Em tela cheia os controles somem após alguns segundos parados e
voltam ao mover o mouse.

**Aqui.** A barra fica permanentemente (`RN-AST-14`).

`RF-UI-2` · novo · P2 — Em tela cheia, o dock some após **3 s** sem movimento de
mouse ou tecla, e volta a qualquer um dos dois.

`RN-UI-11` · novo · P2 — O dock **não some** enquanto houver foco de teclado
dentro dele, nem com `prefers-reduced-motion`. Sumir sob o foco de quem navega
por `Tab` é perder a pessoa dentro da própria interface.

`RN-UI-12` · novo · P2 — Fora de tela cheia o dock nunca some — ele ocupa espaço
no layout (`RN-UI-5`), e recolher mudaria a altura da grade a cada movimento.

---

## 7. Aviso quando alguém entra no ar

**No Discord.** A tile da pessoa ganha o selo LIVE e o canal mostra a prévia.
A mudança é visível mesmo para quem estava olhando para outro lugar.

**Aqui.** O tile muda, mas quem está com o palco em tela cheia não vê nada.

`RF-AST-15` · novo · P2 — Toast quando alguém **começa** a transmitir:
"\<Nome\> começou a compartilhar a tela", com ação "Assistir" que já pede o
stream.

`RN-AST-32` · novo · P2 — Só para transmissão que **começa** com a pessoa na
sala. Entrar numa sala com três telas no ar não dispara três toasts — o palco já
mostra uma e as outras estão na lateral.

`RN-AST-33` · novo · P3 — Sem som de notificação. Um aviso sonoro numa página
que já está tocando o áudio de outra pessoa é ruído em cima de ruído.

---

## 8. Fixar uma tela no palco

**No Discord.** Dá para fixar um participante para ele não sair do destaque.

**Aqui.** O palco é reatribuído sozinho sempre que a tela atual some
(`RN-AST-9`), e a escolha manual se perde.

`RF-AST-16` · novo · P2 — Fixar a tela do palco. Fixada, ela não é substituída
automaticamente; se sair do ar, o palco fica vazio com "A tela fixada saiu do
ar" e um botão de soltar.

`RN-AST-34` · novo · P2 — A fixação é da sessão, não guardada: ela se refere a
uma transmissão específica, que não existe mais na próxima visita.

---

## 9. Prévia antes de ir ao ar

**No Discord.** Depois de escolher a fonte, aparece uma prévia do que será
transmitido, com um botão de confirmar. Há também "Hide stream preview", que
controla se os outros veem a miniatura antes de entrar.

**Aqui.** A escolha vai direto para o ar. Só a aba externa mostra prévia, e
depois de já estar transmitindo.

`RF-TRX-12` · novo · P2 — Depois do seletor do navegador e **antes** de anunciar
a transmissão, mostrar prévia com: a imagem capturada, a resolução detectada, se
há faixa de som, e dois botões — "Entrar no ar" e "Trocar de tela".

`RN-TRX-37` · novo · P2 — É aqui que o aviso de som barrado (`RF-TRX-5`) fica
mais barato de resolver: a pessoa ainda não está no ar, e "Som de uma aba"
(`RF-TRX-6`) resolve antes de alguém ver a tela errada.

`RN-TRX-38` · novo · P2 — A prévia é local: nada é enviado até "Entrar no ar".
Consome um `VideoFrame` a cada ~500 ms num canvas pequeno, não o encoder.

> **Não copiar:** "Hide stream preview". Aqui a miniatura só aparece depois de a
> pessoa pedir para assistir (`RN-AST-2`) — o problema que essa opção resolve
> não existe neste desenho.

---

## 10. Indicador de qualidade de conexão

**No Discord.** Ícone de qualidade por participante, e um overlay de métricas
para diagnóstico.

**Aqui.** O painel ⓘ tem latência, fps e resolução (`RF-AST-9`), mas de **um
stream por vez**, escondido atrás de um botão, e sem nada no tile.

`RF-AST-17` · novo · P2 — Indicador de três estados no canto de cada tile de
transmissão assistida, derivado do que já é medido:

| Estado | Critério |
|---|---|
| Boa | latência < 300 ms e fps ≥ 80% do alvo |
| Instável | latência 300–800 ms, ou fps entre 50% e 80% |
| Ruim | latência > 800 ms, ou fps < 50%, ou descarte por backpressure |

`RF-AST-18` · novo · P2 — O servidor passa a informar o descarte por
backpressure ao espectador afetado (hoje só incrementa `droppedChunks` no log).
Sem isso, "ruim" não distingue rede de quem assiste de rede de quem transmite —
que é justamente a pergunta que se faz nessa hora.

`RN-AST-35` · novo · P2 — O painel ⓘ continua existindo para o número exato. O
indicador é o resumo; o painel é o detalhe.

---

## 11. Janela destacada (pop-out / PiP)

**No Discord.** "Pop Out View" abre a transmissão numa janela própria,
redimensionável, com "Stay On Top". Serve para quem quer assistir enquanto
trabalha em outra coisa.

**Aqui.** Não existe. Sair da aba da Activity é perder a imagem de vista.

`RF-AST-19` · novo · P2 — Botão "Destacar" na tela do palco, usando a
**Document Picture-in-Picture API** (Chromium): abre uma janela sempre-no-topo
com o canvas e um controle mínimo de volume e fechar.

`RN-AST-36` · novo · P2 — O canvas é **um nó só** (`RN-AST-17`), então destacar
o move para a janela e o palco passa a mostrar "Assistindo na janela destacada"
com um botão de trazer de volta. Duplicar o decodificador para pintar nos dois
lugares dobraria CPU por nada.

`RN-AST-37` · novo · P2 — Sem suporte à API, o botão **não aparece**. Nada de
fallback com `window.open`: uma janela sem sempre-no-topo não resolve o problema
que a pessoa tinha.

`RN-AST-38` · novo · P3 — Dentro da Activity a API pode estar indisponível por
Permissions Policy. Vale a mesma detecção; o botão some sozinho.

---

## 12. Reações em emoji sobre a tela

**No Discord.** Reações em emoji flutuam sobre o vídeo durante a call, visíveis
para todos.

**Aqui.** Não existe canal nenhum de expressão entre quem assiste.

`RF-UI-3` · novo · P3 — Barra com 6 emojis fixos. Clicar envia; todos veem a
animação subindo sobre o palco por ~2 s.

`RN-PRO-19` · novo · P3 — Vai por mensagem JSON no socket já existente
(`{ type: 'reaction', emoji, userId }`), com **limite de 1 por segundo por
pessoa** no servidor. Sem o freio, um cliente em laço vira inundação para a sala
inteira.

`RN-UI-13` · novo · P3 — Conjunto **fixo**, não o seletor inteiro de emoji.
Seletor completo pede busca, skin tones e emoji customizado do servidor — é um
produto próprio, e não é este.

---

## 13. Chat de texto da sala

**No Discord.** Todo canal de voz tem chat de texto integrado, ao lado da tela.

**Aqui.** Não existe. Quem está na call usa o chat do próprio Discord.

`RF-UI-4` · novo · P3 — Chat efêmero na lateral, vivendo na memória da sala e
morrendo com ela.

`RN-UI-14` · novo · P3 — **Dentro da Activity isto é redundante e provavelmente
errado**: o canal de voz já tem chat, dois centímetros acima, e um segundo chat
que ninguém lê depois é pior que nenhum. Faz sentido **só fora do Discord**,
onde não há chat nenhum.

`RN-UI-15` · novo · P3 — Se entrar: sem histórico, sem persistência, sem edição,
sem anexo. Limite de 500 caracteres, 1 mensagem por segundo por pessoa, e o
mesmo tratamento de texto de terceiro (`RN-UI-6`).

---

## 14. Assistir pelo celular

**No Discord.** O app móvel assiste transmissões normalmente.

**Aqui.** "Assistir pelo celular também costuma falhar" — o suporte a WebCodecs
em navegador móvel é irregular, e o layout de palco assume desktop.

`RF-UI-5` · novo · P3 — Layout responsivo para assistir em telas estreitas:
palco em cima, lateral vira faixa horizontal rolável embaixo, dock com alvos de
toque de 44 px.

`RN-UI-16` · novo · P3 — **Transmitir do celular continua fora de escopo**
(`RN-TRX-5`) — é limite do navegador, não do layout.

`RN-UI-17` · novo · P3 — Onde `VideoDecoder` não existir, a mensagem precisa
dizer que é o navegador, e sugerir o desktop. Uma tela preta sem explicação lê
como produto quebrado.

---

## O que deliberadamente não entra

| Recurso do Discord | Por quê não |
|---|---|
| Microfone, mudo, ensurdecer | Não há voz aqui — a call é do Discord, ao lado |
| Soundboard | Depende de voz |
| Supressão de ruído (Krisp) | É de microfone |
| Níveis de Nitro | Não há níveis pagos |
| Prévia da transmissão no canal | Fora do nosso alcance — é UI do Discord |
| Convidar pessoas para a call | É o Discord que convida |
| Moderação (expulsar, silenciar) | A sala vive minutos; o poder de moderar mora no canal |
