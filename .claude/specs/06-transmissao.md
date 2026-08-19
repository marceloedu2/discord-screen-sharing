# 06 — Transmissão

## Começar

`RF-TRX-2` · herdado · P0 — O botão "Compartilhar tela" abre um modal com três
escolhas antes de qualquer captura:

| Campo | Opções | Padrão |
|---|---|---|
| Qualidade | Leve 1 Mbps · **Boa 2,5 Mbps** · Alta 5 Mbps · Máxima 8 Mbps | 2,5 Mbps |
| Taxa de quadros | 15 fps · **30 fps** · 60 fps | 30 fps |
| Compartilhar o som | caixa de seleção | desmarcado |

`RN-TRX-6` · herdado · P0 — O clique em "Compartilhar tela" **é** o gesto de
usuário que `getDisplayMedia` exige. Qualquer `await` antes dele o invalida —
por isso a captura é a primeira coisa depois do clique.

`RF-TRX-3` · herdado · P0 — Ordem de tentativa:

1. Capturar **de dentro da Activity** (funciona se o Discord conceder
   `display-capture`; hoje não concede)
2. Cair para a **aba externa** — `/share?t=<token>&q=&fps=&som=`

`RN-TRX-7` · herdado · P1 — As opções escolhidas seguem **na URL** da aba de
captura. A página abre já configurada, sem pedir as mesmas escolhas de novo.

`RN-TRX-8` · herdado · P1 — Dentro do Discord, a aba abre por
`sdk.commands.openExternalLink()`. Resposta `{ opened: false }` é recusa
explícita e vira aviso; clientes antigos devolvem `null`, que **não** é recusa.

`RF-TRX-4` · herdado · P1 — A aba de captura precisa **continuar aberta**
enquanto a transmissão durar. Pode voltar ao Discord normalmente; só não fechar.

## Slots

`RN-TRX-9` · herdado · P0 — Até **4 transmissores simultâneos** por sala. Cada
um recebe um `slot` numérico (0–3), atribuído pelo servidor, que carimba no
**primeiro byte de todo quadro**.

`RN-TRX-10` · herdado · P0 — O servidor **confere o slot carimbado** contra o
slot da conexão, e descarta o que não bate. Sem isso, um cliente adulterado
injetaria quadros no stream de outra pessoa.

`RN-TRX-11` · herdado · P0 — A mesma pessoa **não transmite duas vezes** na
mesma sala. A segunda tentativa recebe "Você já está transmitindo nesta sala."

## Codificação

`RN-TRX-12` · herdado · P0 — Ordem de candidatos de codec, testada com
`VideoEncoder.isConfigSupported`:

1. `avc1.42E01E` com `avc: { format: 'annexb' }`
2. `avc1.42E01E` (avcC)
3. `vp8`
4. `vp09.00.10.08`

H264 vem antes porque costuma ter encoder por hardware; VP8 quase sempre cai em
software, que a 1080p derruba o framerate.

`RN-TRX-13` · herdado · P0 — **Duas passadas**: primeiro com
`latencyMode: 'realtime'`, depois sem. Navegadores que não conhecem
`latencyMode` recusam a configuração inteira por causa dela — mais latência é
melhor que nada.

`RN-TRX-14` · herdado · P0 — Teto de resolução **1920×1080**. A imagem é
reduzida proporcionalmente, **nunca cortada**, e as dimensões finais são sempre
pares. Acima disso banda e CPU disparam sem ganho de legibilidade.

`RN-TRX-15` · herdado · P0 — `track.contentHint = 'text'`. Avisa o encoder que o
conteúdo é tela (texto/UI), não vídeo natural — preserva nitidez de borda em vez
de suavizar.

`RN-TRX-16` · herdado · P0 — **Descartar quadro quando `encodeQueueSize > 2`.**
Fila no encoder vira latência permanente. Melhor perder um quadro do que
carregar o atraso para sempre.

`RN-TRX-17` · herdado · P0 — `frame.close()` **sempre** depois de usar.
`VideoFrame` segura memória de GPU; sem isso a aba trava em segundos.

`RN-TRX-18` · herdado · P1 — O tamanho do encoder acompanha a fonte por
`displayWidth`/`displayHeight`, **nunca** `codedWidth`/`codedHeight` — o
codificado inclui padding de alinhamento do codec, e configurar por ele recorta
as bordas.

## Keyframes

`RN-TRX-19` · herdado · P0 — Keyframe periódico a cada **3 s**, como seguro
barato para quem reconecta fora do fluxo normal.

`RN-TRX-20` · herdado · P0 — **Keyframe sob demanda.** Quando alguém começa a
assistir, o servidor pede um novo (`need-keyframe`) em vez de guardar um antigo.
A tela aparece em ~1 quadro.

`RN-TRX-21` · herdado · P0 — Reconfigurar o encoder (mudança de tamanho, de
qualidade) força keyframe: o decoder do outro lado foi recriado e volta a
precisar de ponto de partida.

## Captura de quadros

`RN-TRX-22` · herdado · P0 — Dois caminhos:

- **Chromium** — `MediaStreamTrackProcessor`, acesso direto aos quadros, sem
  cópia intermediária. É o caminho bom, e o único habilitado (`RN-TRX-4`).
- **Demais** — extrai de um `<video>` alimentado pela stream, via
  `requestVideoFrameCallback` ou `requestAnimationFrame` com intervalo mínimo de
  `1000 / (fps + 2)`.

`RN-TRX-23` · herdado · P1 — No caminho via `<video>`, o elemento fica **no DOM**
mas fora do fluxo (`position: fixed; left: -9999px; 2×2px; opacity: 0`). Alguns
navegadores não decodificam um elemento solto, e `display: none` chega a pausar
a reprodução. O laço também religa a reprodução se o navegador pausar ao trocar
de aba — sem isso a transmissão congela sem erro nenhum.

## Som

`RN-TRX-24` · herdado · P0 — **O som só sai de aba.** É a regra mais importante
desta spec e a que mais custa explicar.

Compartilhar a tela inteira entrega a **mistura do sistema**, com a saída do
Discord dentro — e a call inteira passa a se ouvir de volta, com atraso.
Insuportável em segundos. Não existe API web para tirar um processo dessa
mistura: o áudio é capturado por processo e a relação com uma janela não é
um-para-um. O Windows tem essa API (é assim que o Discord nativo faz), mas
página web não alcança.

O que dá para saber é o `displaySurface` escolhido:

| `displaySurface` | Som |
|---|---|
| `browser` (aba) | **liberado** — o som sai só daquela aba |
| `monitor`, `window` | **barrado na origem**, antes de sair da máquina |

`RF-TRX-5` · herdado · P0 — Som barrado: a faixa é parada e removida, a
transmissão segue **sem som**, e a interface avisa — com a engrenagem de ajustes
piscando em amarelo, porque é atrás dela que está a saída. Um toast que some não
resolve: ninguém acha o caminho depois.

`RF-TRX-6` · herdado · P1 — **"Som de uma aba"** é a saída para quem quer tela
inteira **com** som. Abre um segundo seletor, aproveita **só a faixa de áudio** e
descarta o vídeo daquela escolha. O vídeo continua sendo a tela inteira.

Serve para YouTube, Twitch, jogo de navegador. Para jogo instalado, cujo som não
está em aba nenhuma, não tem como — nem aqui nem em qualquer outro site.

`RN-TRX-25` · herdado · P0 — Restrições da captura de som:

```ts
{
  systemAudio: 'include',
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  restrictOwnAudio: true,  // só quando o navegador suporta
}
```

Os tratamentos de voz ficam **desligados**: existem para microfone e, em som de
aplicativo, cortam justamente o que se queria ouvir. `restrictOwnAudio` tira da
captura o que a própria página está tocando — sem ele, quem transmite enquanto
assiste devolve o som da outra tela para a sala, em laço.

`RN-TRX-26` · herdado · P1 — Pedir áudio **não garante receber**. Em vários
sistemas a caixa "compartilhar o som" fica desmarcada e o navegador devolve a
tela sem faixa de som. O código trata `null` como caso normal.

`RN-TRX-27` · herdado · P1 — Opus estéreo a **96 kbps**. Transparente para som
de aplicativo e de vídeo, e ruído perto dos megabits do vídeo — não vale
economizar aqui.

`RN-TRX-28` · herdado · P1 — Trocar a fonte do som **cancela o laço anterior
antes** de abrir outro. Dois laços alimentando o mesmo encoder estouram a fila.

`RN-TRX-29` · herdado · P1 — Som é acessório: se o `AudioEncoder` cair, a tela
continua no ar. Erro de áudio vira `console.warn`, nunca fim de transmissão.

## Ajustar no ar

`RF-TRX-7` · herdado · P1 — Qualidade e taxa de quadros mudam **com a
transmissão no ar**, sem derrubar quem está assistindo. Reconfigura o encoder e
pede a taxa nova à própria captura via `applyConstraints` — evita gastar CPU
codificando quadros que seriam descartados adiante.

`RF-TRX-8` · herdado · P1 — **Trocar a tela compartilhada** sem parar a
transmissão. Encerra o laço anterior antes de abrir o novo, zera o tamanho
conhecido (a tela nova quase certamente tem outro) e força keyframe.

`RN-TRX-30` · herdado · P1 — A engrenagem de ajustes **só aparece para
transmissão nascida na Activity**. A que roda na aba externa é configurada por
lá, e daqui não dá para mexer nela.

## Parar

`RF-TRX-9` · herdado · P0 — Parar é **funil único**, igual a sair da sala: pelo
botão, ao sair, ou quando a sala fecha, o encerramento é o mesmo.

`RN-TRX-31` · herdado · P0 — A aba externa tem conexão própria, então **só o
servidor consegue mandá-la parar**. O caminho é `stop-broadcast` → o servidor
manda `stop-request` para o socket daquele transmissor. Cada um só encerra a sua.

`RF-TRX-10` · herdado · P1 — Parar a captura pelo botão nativo do navegador
("Parar de compartilhar") encerra a transmissão e avisa: "Você parou o
compartilhamento pelo navegador."

`RN-TRX-32` · herdado · P0 — Encerramento fecha: intervalo de estatísticas,
leitores de vídeo e áudio, ambos os encoders, todas as tracks, o elemento
`<video>` auxiliar e o canvas de redimensionamento. Depois manda `stop` e fecha
o socket.

## Limites conhecidos

`RN-TRX-33` · herdado · P1 — **60 fps não é garantido.** Sem codificação por
hardware, o navegador não dá conta de 60 quadros em tela grande e entrega menos.
A página de captura avisa quando detecta isso.

`RN-TRX-34` · herdado · P1 — Banda de subida cresce **linearmente com o número
de espectadores**: 5 pessoas a 2,5 Mb/s são 12,5 Mb/s; a 8 Mb/s, 40 Mb/s. Isto
precisa estar dito na interface, não só na documentação.
