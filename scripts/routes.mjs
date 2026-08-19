/**
 * Mapa do front-end que a suíte de validação percorre.
 *
 * Ao criar uma tela nova, registre-a aqui — é isto que o hook de validação lê.
 * Uma rota não registrada não é testada por ninguém.
 *
 * `flows` descreve interações encadeadas (cada passo é um comando do
 * agent-browser); use para cobrir jornada, não só a pintura da tela.
 *
 * Registre a rota **quando ela passar a existir**, não antes: rota planejada
 * que ainda devolve 404 quebraria a validação de tudo o mais.
 */

export const ROUTES = [
  {
    name: 'home',
    path: '/',
    // Texto que precisa existir depois do load — prova que a tela renderizou
    // de verdade, e não só devolveu 200 com body vazio.
    expectText: null,
    flows: [],
  },

  // ------------------------------------------------------------------ fase 1
  // { name: 'share', path: '/share', expectText: 'Compartilhar tela', flows: [] },
  // { name: 'terms', path: '/termos', expectText: 'Termos', flows: [] },
  // { name: 'privacy', path: '/privacidade', expectText: 'Privacidade', flows: [] },
  //
  // ------------------------------------------------------------------ fase 2
  // A sala é a mesma rota "/" em outro estado; o que muda é o fluxo:
  // {
  //   name: 'room',
  //   path: '/',
  //   expectText: 'Salas',
  //   flows: [
  //     {
  //       name: 'criar sala e entrar',
  //       steps: [
  //         ['find', 'role', 'button', 'click', '--name', 'Criar sala'],
  //         ['fill', '#createName', 'Sala de teste'],
  //         ['find', 'role', 'button', 'click', '--name', 'Criar'],
  //       ],
  //       expectText: 'Sala de teste',
  //     },
  //   ],
  // },
];

export const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * Tema escuro é o único que o produto entrega (specs/02, RN-UI-1). Os dois são
 * testados de propósito: o resultado deve ser idêntico, o que prova que nada
 * depende de `prefers-color-scheme` por acidente.
 */
export const THEMES = ['light', 'dark'];

/** Rotas que devem responder 404 (guarda contra catch-all acidental). */
export const MISSING_ROUTES = ['/rota-que-nao-existe-9f2a'];
