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

## Fase 1 — Esqueleto navegável *(em andamento)*

Objetivo: as rotas existem, sobem, e a diferença entre "ainda não escrevi" e
"quebrou" é visível. É o papel do componente `Pendente`, herdado do esqueleto de migração do projeto antigo.

- [x] Tema Tailwind com a paleta de [02](02-identidade-visual.md)
- [x] Monorepo `app/` + `server/`, com `tsconfig.base.json` estrito
- [x] Rota `/` com o marcador `Pendente`
- [ ] Rotas `/share`, `/termos`, `/privacidade`
- [ ] `RN-PRO-5` — CSP `frame-ancestors`
- [ ] `RN-SES-4` — Client ID pelo HTML renderizado no servidor
- [ ] `RN-PRO-4` — `/api/avatar/{id}/{hash}` (porte direto do projeto antigo)
- [ ] `RN-PRO-3` — prefixo `/.proxy` como contexto, não variável global
- [ ] Componentes base: `Botao`, `Pilula`, `Modal`, `Toast`, `Avatar`

**Pronto quando:** as quatro rotas abrem, o CSP está no cabeçalho, e o avatar de
um id real carrega.

---

## Fase 2 — Identidade e sala, sem vídeo

Objetivo: entrar numa sala e ver quem está nela. Nenhum pixel de vídeo ainda.

- [ ] `RN-SES-1` — detecção de contexto
- [ ] `RF-SES-3`, `RF-SES-4` — convidado e login web
- [ ] `RF-SES-1` — login pelo Discord na Activity
- [ ] `RF-SES-5` — renovação automática do crachá
- [ ] `RF-SAL-3`, `RF-SAL-4` — lobby com lista e recarga de 4 s
- [ ] `RF-SAL-2`, `RF-SAL-5`, `RF-SAL-6` — criar, entrar, senha
- [ ] `RF-SAL-1` — sala da call
- [ ] WebSocket: conectar, `state`, `rename`, reconexão com backoff
- [ ] Grade de pessoas (`RN-AST-8`, primeiro caso)
- [ ] `RF-SES-7` — perfil e apelido

**Pronto quando:** duas janelas entram na mesma sala, se veem na grade, e o
apelido de uma aparece na outra.

---

## Fase 3 — Assistir

Objetivo: vídeo na tela. É aqui que o produto passa a existir.

- [ ] Porte de `player.ts` e `audio.ts` (tipagem por cima, lógica intacta)
- [ ] `RN-AST-2` — opt-in, com o tile de convite
- [ ] `RF-AST-1`, `RN-AST-3` — `watch` e keyframe sob demanda
- [ ] Palco + lateral + divisor (`RN-AST-8` a `RN-AST-12`)
- [ ] `RF-AST-4` — tela cheia por layout
- [ ] `RF-AUD-1` — volume geral e por pessoa
- [ ] `RF-AST-5` — "Conectando…" até o primeiro quadro
- [ ] `RF-AST-8` — menu de contexto
- [ ] `RF-AST-9` — painel de detalhes

**Pronto quando:** com o servidor antigo transmitindo, este cliente assiste,
ouve, ajusta volume e alterna tela cheia.

---

## Fase 4 — Transmitir

Objetivo: fecha o ciclo. O projeto passa a não depender do antigo.

- [ ] Porte de `broadcaster.ts`
- [ ] `RF-TRX-2` — modal de qualidade, fps e som
- [ ] `RF-TRX-3` — tenta no iframe, cai para a aba
- [ ] Página `/share` completa
- [ ] `RN-TRX-24` a `RN-TRX-29` — regras de som
- [ ] `RF-TRX-6` — "Som de uma aba"
- [ ] `RF-TRX-7`, `RF-TRX-8` — ajustar e trocar no ar
- [ ] `RF-TRX-9`, `RN-TRX-31` — parada como funil único

**Pronto quando:** este projeto transmite para ele mesmo, com som, e o
`smoke.mjs` do projeto antigo passa contra ele.

---

## Fase 5 — Paridade barata

Tudo de [10](10-paridade-discord.md) marcado como custo baixo. Ordenado por
retorno.

- [ ] `RF-TRX-11` — presets por resolução
- [ ] `RF-AST-11` — teto de espectadores
- [ ] `RF-AST-13` — alternar Grade ↔ Foco
- [ ] `RF-UI-1` — atalhos de teclado
- [ ] `RF-AST-15` — aviso de início de transmissão
- [ ] `RF-AST-14` — ocultar participantes
- [ ] `RF-AST-16` — fixar tela no palco
- [ ] `RF-UI-2` — controles somem em tela cheia

---

## Fase 6 — Paridade cara

- [ ] `RF-TRX-12` — prévia antes de ir ao ar
- [ ] `RF-AST-17`, `RF-AST-18` — indicador de qualidade de conexão
- [ ] `RF-AST-19` — janela destacada (Document PiP)

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
