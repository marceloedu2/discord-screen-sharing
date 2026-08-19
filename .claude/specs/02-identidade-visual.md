# 02 — Identidade visual

O core visual herdado de `discord-streaming`. **Não é uma paleta nova**: é a
paleta do Discord, escolhida de propósito para que a Activity não pareça um
corpo estranho dentro do cliente onde ela roda. Manter isso é requisito, não
preferência.

`RNF-UI-1` · herdado · P0 — A interface usa a paleta abaixo. Uma tela que
destoa do Discord dentro do próprio Discord lê como site de terceiro invadindo
a call, e a percepção de confiança cai junto.

## Paleta

Extraída de `client/src/style.css:1-11`, verbatim.

| Token | Valor | Onde | Equivalente Discord |
|---|---|---|---|
| `--bg` | `#000000` | fundo da aplicação | preto do palco de vídeo |
| `--panel` | `#1e1f22` | dock, modais, lobby | Dark Secondary |
| `--tile` | `#2b2d31` | tiles, botões neutros | Dark Tertiary |
| `--line` | `#35373c` | bordas, divisores | separador |
| `--text` | `#f2f3f5` | texto principal | Text Normal |
| `--muted` | `#b5bac1` | texto secundário, ícones | Text Muted |
| `--accent` | `#5865f2` | ação primária | **Blurple** |
| `--danger` | `#f23f43` | erro, sair, toast de erro | vermelho |
| `--live` | `#23a55a` | transmitindo, borda do tile | **verde de "no ar"** |

Dois valores aparecem fora dos tokens e precisam virar token no porte:

- `#202225` — fundo mais escuro (usado no dock)
- `#43454b` — hover de botão neutro
- `rgba(0, 0, 0, 0.65)` + `backdrop-filter: blur(8px)` — as pílulas flutuantes

`RN-UI-1` · refinado · P1 — Tema escuro é o único tema. O Discord não expõe a
Activity ao tema claro do cliente, e um tema claro que ninguém vê custaria o
dobro de superfície para testar. As specs de validação (`npm run test`)
verificam `light` e `dark` mesmo assim: o resultado deve ser **idêntico**, o que
prova que nada depende de `prefers-color-scheme` por acidente.

## Tipografia

```
font: 15px/1.5 "gg sans", "Segoe UI", system-ui, sans-serif;
```

`RN-UI-2` · herdado · P1 — `gg sans` é a fonte do Discord. Ela **não é
carregada por nós** — dentro da Activity ela já está disponível no cliente, e
fora dele o fallback assume. Nada de `next/font` para ela: baixar uma fonte que
o contexto principal já tem é banda desperdiçada, e redistribuí-la é problema de
licença.

Escala herdada:

| Uso | Tamanho | Peso |
|---|---|---|
| Corpo | 15px / 1.5 | 400 |
| Botão | 14px / 1 | 500 |
| Pílula, metadados | 13px | 500 |
| Rótulo de seção (caixa alta, `letter-spacing: .07em`) | 11px | 600 |
| Badge do tile | 11.5px | 500 |

## Formas e medidas

| Token | Valor | Uso |
|---|---|---|
| Raio do tile | `8px` | tiles de vídeo e avatar |
| Raio de botão e pílula | `999px` | tudo que é clicável no dock |
| Altura do botão | `46px` (mín. largura `46px`) | dock |
| Espaço da grade | `10px` | entre tiles |
| Respiro da grade | `16px` | nas quatro bordas |
| Divisor do palco | `10px` | coluna arrastável |
| Lateral do palco | `300px` padrão, `200px` mínimo, teto de 45% da grade | `RN-AST-8` |

`RN-UI-3` · herdado · P1 — Ícones são SVG traçado, `stroke-width` 1.8 (botão) ou
2 (pílula), `fill: none`, `stroke: currentColor`, pontas e junções arredondadas.
É o que casa com o conjunto de ícones do Discord. Nada de biblioteca de ícones
preenchidos.

`RN-UI-4` · herdado · P0 — Quem transmite ganha **borda verde** (`--live`) de
2px no tile, e fundo preto em vez de `--tile`. É o sinal que o Discord usa e o
que quem assiste procura sem pensar.

## Tema Tailwind v4

Já aplicado em `app/src/app/globals.css`. Os nomes seguem os do projeto
antigo para o diff contra o CSS original continuar legível.

```css
@import "tailwindcss";

@theme {
  --color-fundo: #000000;
  --color-painel: #1e1f22;
  --color-painel-fundo: #202225;
  --color-tile: #2b2d31;
  --color-tile-hover: #43454b;
  --color-linha: #35373c;
  --color-texto: #f2f3f5;
  --color-suave: #b5bac1;
  --color-acento: #5865f2;
  --color-perigo: #f23f43;
  --color-vivo: #23a55a;

  --font-sans: "gg sans", "Segoe UI", system-ui, sans-serif;

  --radius-tile: 8px;

  --spacing-grade: 10px;
  --spacing-respiro: 16px;
}

:root {
  color-scheme: dark;
}

body {
  background: var(--color-fundo);
  color: var(--color-texto);
  font-size: 15px;
  line-height: 1.5;
  /* A sala ocupa a janela e não rola: quem rola é a lateral do palco. */
  overflow: hidden;
}
```

`RNF-UI-2` · novo · P1 — O `overflow: hidden` no `body` é herdado e correto para
a sala, mas **não pode valer para as páginas de política** (`/termos`,
`/privacidade`), que são texto longo. No porte isso vira escopo de layout, não
regra global.

## Componentes que o porte precisa

Inventário do que existe hoje em DOM na mão e vira componente React. Cada um
entra em [11-roadmap.md](11-roadmap.md) com fase.

| Componente | Origem | Nota |
|---|---|---|
| `Pilula` | `.pill` | fundo translúcido + blur, lista ao passar o mouse |
| `Botao` | `.btn`, `.btn.go`, `.btn.live`, `.btn.wide` | variantes explícitas, não booleanos soltos |
| `Tile` | `.tile` | três estados: vídeo, convite, avatar |
| `Avatar` | `.avatar` | imagem com fallback para iniciais em cor estável |
| `Modal` | `.modal` + `.modal-card` | fecha no fundo e no `Esc` |
| `Toast` | `.toast` | `role="status"`, `aria-live="polite"`, some em 6 s |
| `MenuContexto` | `.tile-menu` | botão direito no tile |
| `Dock` | `.dock` | ocupa espaço no layout, **não** flutua sobre o vídeo |
| `Divisor` | `.divider` | arrastável, duplo clique restaura |

`RN-UI-5` · herdado · P1 — O dock **ocupa espaço no layout** em vez de flutuar
sobre a tela. Sobrepor comeria justamente a parte de baixo do que está sendo
mostrado, que é onde costuma ficar barra de tarefas e legenda.

`RN-UI-6` · herdado · P0 — Todo texto vindo de terceiro (nome de pessoa do
Discord, nome de sala escrito por outra pessoa) é inserido como texto, nunca
como HTML. No React isso é o padrão; a regra existe para ninguém alcançar
`dangerouslySetInnerHTML` ao portar os `innerHTML` do código antigo.

## Cor por pessoa

`RN-UI-7` · herdado · P2 — Quem não tem avatar recebe um círculo com as
iniciais, colorido por hash estável do id:

```ts
function corDe(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
}
```

Mesma pessoa, mesma cor, em qualquer sessão e em qualquer máquina. Saturação e
luminosidade fixas garantem contraste legível contra `--tile` em todos os matizes.
