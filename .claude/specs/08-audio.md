# 08 — Áudio

O som viaja pelo **mesmo socket e pelo mesmo cabeçalho** do vídeo, distinguido
só pelo byte de tipo. Um canal, um formato, e o servidor continua repassando o
buffer sem abrir nada.

## As três premissas do desenho

`RN-AUD-1` · herdado · P0 — **Áudio não tem keyframe.** Cada pacote Opus se
decodifica sozinho, então ele **não passa** pelo bloqueio que barra vídeo sem
ponto de partida (`RN-AST-4`). Se passasse, quem entra no meio ficaria mudo até
o próximo keyframe de vídeo — que não tem relação nenhuma com o som.

`RN-AUD-2` · herdado · P0 — **Buraco em áudio é audível.** Um quadro de vídeo
perdido não se nota; um intervalo sem amostra é um estalo. Por isso a reprodução
mantém um **colchão de 80 ms**: o som toca um pouco atrás do vivo, e essa folga
absorve o solavanco da rede.

`RN-AUD-3` · herdado · P0 — Passando de **320 ms** acumulados (4× o colchão), a
reprodução **corta e volta ao vivo**. Atraso somado não se recupera sozinho, e
continuar empilhando só afasta mais o som da tela.

`RN-AUD-4` · herdado · P1 — **Sincronia é aceitável, não exata.** O vídeo é
desenhado assim que chega; o som carrega o colchão. A diferença fica em algumas
dezenas de milissegundos, abaixo do que se percebe em tela de computador. Casar
os dois exigiria atrasar o vídeo até o áudio — mais latência para resolver um
problema que não aparece fora de rosto falando.

## Reprodução

`RN-AUD-5` · herdado · P1 — Cada pedaço é agendado num `AudioBufferSourceNode`,
**sem `AudioWorklet`**. O worklet daria precisão por amostra, mas exige um
arquivo carregado por URL — e dentro da Activity toda URL passa pelo proxy do
Discord, um caminho a mais para dar errado, em troca de precisão que pacotes de
20 ms não pedem.

> Se aparecer estalo com rede ruim, o passo seguinte é um `AudioWorklet` com
> ring buffer. Está registrado como caminho conhecido, não como pendência.

`RN-AUD-6` · herdado · P1 — O `AudioContext` nasce com `sampleRate` **igual ao da
origem**. Deixar o navegador reamostrar acrescenta latência e artefato sem ganho
nenhum. `latencyHint: 'interactive'`.

`RN-AUD-7` · herdado · P1 — Pacote corrompido é um estalo, não o fim da
transmissão: o próximo se decodifica sozinho, então não há o que reiniciar. Erro
de decodificação vira `console.warn`.

`RN-AUD-8` · herdado · P1 — A `audio-config` é guardada pelo servidor e reenviada
a quem começa a assistir. Ao contrário do vídeo, aqui **não existe keyframe para
servir de ponto de partida**: sem a config, nenhum pacote de som é aproveitável.

`RN-AUD-9` · herdado · P1 — `audio-config` pode chegar **antes** de o cliente
pedir para assistir. Nesse caso não há o que ligar, e o servidor reenvia assim
que o pedido chegar.

## Volume

`RF-AUD-1` · herdado · P1 — Dois controles independentes, **como no Discord**:

| Controle | Faixa | Onde vive | Escopo |
|---|---|---|---|
| Volume geral | 0–100% | `localStorage: volume` | tudo que chega |
| Volume por pessoa | 0–200% | `localStorage: volumePessoa` | uma transmissão |

O que sai no alto-falante é o **produto dos dois**.

`RN-AUD-10` · herdado · P1 — O volume por pessoa é guardado **por pessoa, não por
sessão**: quem sempre chega alto demais continua ajustado amanhã.

`RN-AUD-11` · herdado · P1 — 100% é o padrão e **não é guardado**. Não ter
registro significa "nunca foi mexido", e é o que mantém o armazenamento pequeno
depois de muita gente passar pela sala.

`RN-AUD-12` · herdado · P1 — O mudo é **zero no volume geral** — um número só, em
vez de dois estados que precisam concordar. O botão guarda o valor anterior para
desmutar voltar ao ajuste que a pessoa tinha feito, não a 100%.

`RN-AUD-13` · herdado · P1 — O volume geral **sobrevive a trocar de sala**: é
preferência de quem assiste, não estado de uma transmissão.

`RN-AUD-14` · herdado · P1 — O controle de som no dock **só existe quando há som
para controlar** — ao menos um stream assistido com áudio.

`RF-AUD-2` · herdado · P2 — Passar o mouse no alto-falante abre o cursor de
volume; clicar silencia e devolve.
