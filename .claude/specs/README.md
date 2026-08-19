# Specs — Sala de Tela

Requisitos do porte de `discord-streaming` (Vite + Express + WS, JS puro em DOM
na mão) para este projeto (Next.js 16 + TypeScript + Tailwind v4).

O código antigo continua em `../discord-streaming/` e é a fonte da verdade
sobre **comportamento**. Estas specs são a fonte da verdade sobre **o que
construir** — incluindo o que muda e o que passa a existir.

## Como ler

| Arquivo | Assunto |
|---|---|
| [01-produto.md](01-produto.md) | Visão, personas, escopo, não-objetivos |
| [02-identidade-visual.md](02-identidade-visual.md) | Paleta, tipografia, tokens — o "core" visual herdado |
| [03-restricoes-tecnicas.md](03-restricoes-tecnicas.md) | O que o Discord impõe e por quê o desenho é este |
| [04-identidade-e-sessao.md](04-identidade-e-sessao.md) | Login, convidado, crachá, renovação |
| [05-lobby-e-salas.md](05-lobby-e-salas.md) | Criar, listar, entrar, senha, ciclo de vida |
| [06-transmissao.md](06-transmissao.md) | Captura, qualidade, slots, som de aba |
| [07-assistir-e-palco.md](07-assistir-e-palco.md) | Opt-in, palco, lateral, tela cheia |
| [08-audio.md](08-audio.md) | Opus, colchão, volume geral e por pessoa |
| [09-protocolo.md](09-protocolo.md) | Contrato HTTP e WebSocket (herdado, não muda) |
| [10-paridade-discord.md](10-paridade-discord.md) | **O que o Discord tem hoje e nós não** |
| [11-roadmap.md](11-roadmap.md) | Ordem de implementação por fases |

## Onde as coisas moram

Monorepo npm. A divisão entre `app/` e `server/` **não é escolha nossa** —
está imposta pelo Discord, e a justificativa está em
[03-restricoes-tecnicas.md](03-restricoes-tecnicas.md) (`RN-PRO-6`).

```
app/       tudo que o navegador vê — Next.js 16, App Router
server/    relay WebSocket e estado das salas (ainda vazio; Fase 4)
scripts/   ferramental de validação, fora dos workspaces
specs/     este diretório
```

O projeto antigo fica em `../discord-streaming/`, com o código de referência
em `client/`, `server/` e `shared/`. Ele também já tem um esqueleto de
migração em `app/`, cujas decisões estas specs incorporam.

## Convenções

**Identificadores.** Todo requisito tem um id estável, citável em commit, teste
e PR:

- `RF-<área>-<n>` — requisito funcional (o que o sistema faz)
- `RN-<área>-<n>` — regra de negócio (a restrição que governa o comportamento)
- `RNF-<área>-<n>` — requisito não funcional (desempenho, segurança, a11y)

Áreas: `SES` sessão · `SAL` sala · `TRX` transmissão · `AST` assistir ·
`AUD` áudio · `UI` interface · `PRO` protocolo.

**Origem.** Cada requisito declara de onde veio:

- `herdado` — existe hoje em `discord-streaming` e vai igual
- `refinado` — existe hoje, mas a regra muda (o texto diz o quê e por quê)
- `novo` — não existe hoje; entra por paridade com o Discord ou por lacuna

**Prioridade.** `P0` sem isto não há produto · `P1` paridade com o que existe
hoje · `P2` melhoria que o Discord tem · `P3` desejável.

## Regra de ouro do porte

Comportamento herdado **não se reinventa sem motivo escrito**. O projeto antigo
tem uma quantidade enorme de decisão deliberada documentada em comentário —
latência, keyframe, backpressure, eco de áudio. Quando uma spec diz `herdado`,
a implementação copia a regra; quando diz `refinado`, o texto justifica.

Toda tela nova entra em [scripts/routes.mjs](../scripts/routes.mjs) e passa por
`npm run test` antes de ser considerada pronta.
