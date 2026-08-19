# Sala de Tela — monorepo

Porte do projeto [`discord-streaming`](https://github.com/marceloedu2/discord-streaming) (Vite + Express
+ WS, JS em DOM na mão) para Next.js 16 + TypeScript + Tailwind v4. O código
de referência fica em `../discord-streaming/`, no mesmo diretório-pai; as
specs em [specs/](specs/) são a fonte da verdade sobre **o que construir**, e
o código antigo sobre **como se comporta**.

**Nomes de identificador em inglês; comentários e texto de interface em
pt-BR.** O contrato do WebSocket e das rotas HTTP é herdado e não muda de nome
— ver [specs/09-protocolo.md](specs/09-protocolo.md).

## A forma do repositório

```
                    porta de entrada (:3000)
                    scripts/proxy.mjs em dev · infra/Caddyfile em produção
                              │
             ┌────────────────┴────────────────┐
             │ roteia por caminho              │
     /ws /api/rooms /api/session        todo o resto
     /api/token /api/health /auth       /  /share  /_next/*  /api/avatar/*
             │                                 │
             ▼                                 ▼
       server/ (:3101)                   app/ (:3100)
       Node + ws, sem framework          Next 16 + TS + Tailwind
```

A divisão não é "API de um lado, interface do outro". O critério é **quem toca
o estado em memória e quem tem um segredo**:

- O relay precisa do evento `upgrade` do servidor HTTP, que Route Handler
  nenhum expõe, e as salas vivem num `Map` que só faz sentido num processo
  único e vivo. Isso fixa o `server/` onde ele está.
- `SESSION_SECRET`, `DISCORD_CLIENT_SECRET` e `DISCORD_BOT_TOKEN` moram junto
  de quem os usa. Emitir token no app significaria o mesmo segredo em dois
  lugares, sem ganho nenhum.
- O que não cumpre nenhum dos dois critérios é do app — `/api/avatar/*`
  inclusive, que no projeto antigo mantinha 200 imagens em cache dentro do
  processo que faz relay de vídeo.

### Por que uma porta de entrada, e não rewrites do Next

1. **Rewrite de Next não repassa o `upgrade` do WebSocket.** O `/ws` é o
   produto inteiro deste projeto, então isso sozinho já decide.
2. O Discord aceita um URL Mapping por prefixo; dois processos sem nada na
   frente seriam dois mapeamentos para manter à mão no portal.
3. Mesma origem para tudo: nenhum CORS, um `PUBLIC_ORIGIN` só.

A lista de caminhos do servidor vive em `infra/server-paths.mjs`, importada
pela porta de entrada e espelhada à mão no `infra/Caddyfile`. Rota nova = estes
dois lugares.

## Comandos

```bash
npm run dev        # entrada + app + servidor, numa janela. Ctrl+C derruba tudo
npm start          # o mesmo, com build de produção
npm run types      # tsc --noEmit nos dois workspaces
npm run lint       # eslint nos dois workspaces
npm run test       # rotas × mobile/tablet/desktop × light/dark, no navegador
npm run test:fast  # só desktop/light, para o ciclo curto
npm run check      # types + lint + test
```

O `server/` roda TypeScript direto em dev (`--experimental-strip-types`), sem
passo de build; o `tsconfig.json` dele cobra `erasableSyntaxOnly` para nada que
o Node não saiba executar entrar no código. `npm run build` compila para
`server/dist/`.

## Verificação obrigatória

Toda mudança de front passa por navegador de verdade antes de ser dada como
pronta — não confie em "compilou". `npm run test` cobre, por combinação:
status HTTP, erros de console, exceções não capturadas, requisições com falha,
auditoria axe-core (contraste, ARIA, semântica), estouro horizontal com o
elemento culpado, alvos de toque abaixo de 24px, indicador de foco visível,
hierarquia de títulos, imagens quebradas ou sem `alt`, e metadados. Fecha com
Core Web Vitals por rota. Relatório e capturas caem em
`../.agent-browser/reports/<carimbo>/`.

Ele bate na **porta de entrada**, não no Next: uma tela que funciona no `:3100`
e quebra pelo `:3000` é o tipo de falha que só o roteamento revela.

### Ao criar uma tela

Registre a rota em [scripts/routes.mjs](../scripts/routes.mjs) — é o que a suíte
percorre, e rota não registrada não é testada por ninguém. Use `expectText`
para provar que a tela renderizou, e `flows` para cobrir a jornada (cada passo
é um comando do agent-browser).

## Hooks (ativos, ver settings.json)

- **PostToolUse** → `scripts/hooks/check-code.sh`: `tsc --noEmit` + `eslint` a
  cada edição, **no workspace a que o arquivo pertence**. Fora de `app/` e
  `server/` (scripts, infra) roda `node --check`. Bloqueia com exit 2.
- **Stop** → `scripts/hooks/validate-frontend.sh`: roda `test:fast` antes de
  encerrar o turno. Bloqueia com exit 2 se achar erro. Pula em silêncio se a
  porta de entrada estiver fora do ar.

## Inspeção manual com o navegador

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i           # árvore de acessibilidade com refs @e1…
agent-browser screenshot --annotate # captura com os refs rotulados
agent-browser console; agent-browser errors
agent-browser vitals http://localhost:3000
agent-browser close
```

## Skills instaladas ([skills/](skills/))

`vercel-react-best-practices`, `vercel-composition-patterns`,
`vercel-react-view-transitions`, `web-design-guidelines`, `writing-guidelines`,
`agent-browser`. Consulte `web-design-guidelines` antes de fechar qualquer UI e
`writing-guidelines` para o texto em pt-BR.
