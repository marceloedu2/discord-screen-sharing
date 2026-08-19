# 11 — Roadmap

Ordem de implementação. O critério de cada fase é **ter algo que funciona de
ponta a ponta ao final dela** — nada de "a fase 3 é quando volta a abrir".

Cada fase termina com as rotas novas registradas em
[`scripts/routes.mjs`](../scripts/routes.mjs) e `npm run test` limpo.

---

## Fase 0 — Fundação *(feito)*

- [x] Next.js 16 + TypeScript + Tailwind v4
- [x] agent-browser + suíte de validação + hooks
- [x] Skills da Vercel no escopo do projeto
- [x] Paleta e metadados do produto

---

## Fase 1 — Esqueleto navegável *(feito)*

Objetivo: as rotas existem, sobem, e a diferença entre "ainda não escrevi" e
"quebrou" é visível. É o papel do componente `Pendente`, herdado do esqueleto de migração do projeto antigo.

- [x] Tema Tailwind com a paleta de [02](02-identidade-visual.md)
- [x] Monorepo `app/` + `server/`, com `tsconfig.base.json` estrito
- [x] Rota `/` com o marcador `Pendente`
- [x] Rota `/share` com o marcador `Pendente`
- [x] Rotas `/termos` e `/privacidade`, em JSX sob o grupo `(politicas)`
- [x] `RN-PRO-5` — CSP `frame-ancestors`
- [x] `RN-SES-4` — Client ID pelo HTML renderizado no servidor
- [x] `RN-PRO-4` — `/api/avatar/{id}/{hash}` (porte direto do projeto antigo)
- [x] `RN-PRO-3` — prefixo `/.proxy` como contexto, não variável global
- [x] Componentes base desta fase: `Avatar`, `Botao`

`Pilula`, `Modal` e `Toast` saíram desta fase para a 2. Nenhum dos três tem
consumidor antes do lobby, e componente sem consumidor é API adivinhada — a
suíte não consegue exercitá-lo, então o acerto só apareceria na primeira tela
que o usasse, que é justamente onde ele seria reescrito.

**Pronto quando:** as quatro rotas abrem, o CSP está no cabeçalho, e o avatar de
um id real carrega.

---

## Fase 2 — Identidade e sala, sem vídeo *(feito)*

Objetivo: entrar numa sala e ver quem está nela. Nenhum pixel de vídeo ainda.

- [x] `RN-SES-1` — detecção de contexto
- [x] `RF-SES-3`, `RF-SES-4` — convidado e login web
- [x] `RF-SES-1` — login pelo Discord na Activity
- [x] `RF-SES-5` — renovação automática do crachá
- [x] `RF-SAL-3`, `RF-SAL-4` — lobby com lista e recarga de 4 s
- [x] `RF-SAL-2`, `RF-SAL-5` — criar e entrar, com o modal de senha
- [x] `RF-SAL-1` — sala da call
- [x] WebSocket: conectar, `state`, `rename`, reconexão com backoff
- [x] Grade de pessoas (`RN-AST-8`, primeiro caso)
- [x] `RF-SES-7` — perfil e apelido
- [x] Componentes `Pilula`, `Modal` e `Toast`
- [x] `RF-SAL-6` — trocar a senha da sala depois de criada

**Pronto quando:** duas janelas entram na mesma sala, se veem na grade, e o
apelido de uma aparece na outra.

---

## Fase 3 — Assistir *(feito)*

Objetivo: vídeo na tela. É aqui que o produto passa a existir.

- [x] Porte de `player.ts` e `audio.ts` (tipagem por cima, lógica intacta)
- [x] `RN-AST-2` — opt-in, com o tile de convite
- [x] `RF-AST-1`, `RN-AST-3` — `watch` e keyframe sob demanda
- [x] Palco + lateral + divisor (`RN-AST-8` a `RN-AST-12`)
- [x] `RF-AST-4` — tela cheia por layout
- [x] `RF-AUD-1` — volume geral e por pessoa
- [x] `RF-AST-5` — "Conectando…" até o primeiro quadro
- [x] `RF-AST-8` — menu de contexto, com o volume por pessoa
- [x] `RF-AST-9` — painel de detalhes

**Pronto quando:** com o servidor antigo transmitindo, este cliente assiste,
ouve, ajusta volume e alterna tela cheia.

> **Verificado com vídeo real** em 19/08/2026: uma pessoa transmitindo a janela
> do Discord, outra assistindo, 89 ms de latência medidos pelo painel de
> detalhes. Captura → codificação → relay → decodificação → canvas, o caminho
> inteiro.

---

## Fase 4 — Transmitir *(feito)*

Objetivo: fecha o ciclo. O projeto passa a não depender do antigo.

- [x] Porte de `broadcaster.ts`
- [x] `RF-TRX-2` — modal de qualidade, fps e som *(já com os presets de `RF-TRX-11`)*
- [x] `RF-TRX-3` — tenta no iframe, cai para a aba
- [x] Página `/share` completa
- [x] `RN-TRX-24` a `RN-TRX-29` — regras de som
- [x] `RF-TRX-6` — "Som de uma aba"
- [x] `RF-TRX-7`, `RF-TRX-8` — ajustar e trocar no ar
- [x] `RF-TRX-9`, `RN-TRX-31` — parada como funil único

`RF-TRX-5` (som barrado) fica na aba de captura, e não numa engrenagem: a
página é dedicada, então o aviso vai **junto da saída** — um bloco amarelo com o
botão "Som de uma aba" dentro. `RN-TRX-30` continua valendo para a transmissão
nascida na Activity, que se configura de lá.

**Pronto quando:** este projeto transmite para ele mesmo, com som, e o
`smoke.mjs` do projeto antigo passa contra ele.

---

## Fase 5 — Paridade barata *(feito)*

Tudo de [10](10-paridade-discord.md) marcado como custo baixo. Ordenado por
retorno.

- [x] `RF-TRX-11` — presets por resolução
- [x] `RF-AST-11` — teto de espectadores, com a ocupação no tile (`RF-AST-12`)
- [x] `RF-AST-13` — alternar Grade ↔ Foco
- [x] `RF-UI-1` — atalhos de teclado
- [x] `RF-AST-15` — aviso de início de transmissão
- [x] `RF-AST-14` — ocultar participantes
- [x] `RF-AST-16` — fixar tela no palco
- [x] `RF-UI-2` — controles somem em tela cheia

---

## Fase 6 — Paridade cara *(feito)*

- [x] `RF-TRX-12` — prévia antes de ir ao ar
- [x] `RF-AST-17`, `RF-AST-18` — indicador de qualidade de conexão
- [x] `RF-AST-19` — janela destacada (Document PiP)

---

## Fase 7 — Além do Discord *(avaliar antes)*

Nada aqui está aprovado. Entram só se a fase 6 fechar e alguém pedir.

- [ ] `RF-UI-3` — reações em emoji
- [ ] `RF-UI-5` — assistir pelo celular
- [ ] `RF-UI-4` — chat de texto *(só fora do Discord, ver `RN-UI-14`)*

---

## Riscos

| Risco | Onde aparece | Mitigação |
|---|---|---|
| Regressão no pipeline de mídia ao tipar | Fases 3 e 4 | Portar sem reescrever; comparar com o antigo lado a lado |
| Retângulo branco na Activity | Fase 1 | Testar dentro do Discord já na fase 1, não no fim |
| `smoke.mjs` cobrir só o servidor | Fase 4 | Ele valida o protocolo, que não muda — é rede de segurança, não cobertura de front |
| Estado de sala em React virar cascata de re-render | Fase 2 | Estado de mídia fora do React; ver `vercel-react-best-practices` |
| Canvas único brigar com o ciclo de vida do React | Fase 3 | `RN-AST-17` é a regra; o canvas não é filho de componente que remonta |

---

## O que medir a cada fase

`npm run test` já cobre console, rede, axe, estouro horizontal e vitals.
Acrescentar por fase:

| Fase | Fluxo a registrar em `scripts/routes.mjs` |
|---|---|
| 1 | as quatro rotas abrem sem erro |
| 2 | criar sala → entrar → aparecer na lista |
| 3 | pedir para assistir → primeiro quadro em < 1 s |
| 4 | transmitir → assistir a própria tela |
| 5+ | um fluxo por recurso novo |
