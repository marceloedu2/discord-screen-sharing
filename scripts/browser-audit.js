/**
 * Roda dentro da página, uma vez por combinação rota × viewport × tema.
 * Espera que o axe-core já tenha sido injetado. Devolve um objeto plano —
 * quem interpreta e classifica a severity é scripts/test-frontend.mjs.
 */
(async () => {
  const doc = document;
  const root = doc.documentElement;
  const viewportWidth = root.clientWidth;

  const rotulo = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const classe = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const text = (el.textContent || '').trim().slice(0, 40);
    return tag + id + classe + (text ? ' "' + text + '"' : '');
  };

  const todos = Array.from(doc.querySelectorAll('*'));

  // --- Estouro horizontal: o sintoma clássico de layout quebrado no mobile.
  const pageOverflows = root.scrollWidth > viewportWidth + 1;
  const overflowingElements = todos
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const estilo = getComputedStyle(el);
      if (estilo.position === 'fixed') return false;
      return r.right > viewportWidth + 1 || r.left < -1;
    })
    .slice(0, 12)
    .map((el) => ({
      element: rotulo(el),
      right: Math.round(el.getBoundingClientRect().right),
      esquerda: Math.round(el.getBoundingClientRect().left),
    }));

  // --- Alvos de toque abaixo de 24x24 (WCAG 2.2 AA, critério 2.5.8).
  const interactiveSelector = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
  const smallTargets = Array.from(doc.querySelectorAll(interactiveSelector))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (getComputedStyle(el).display === 'contents') return false;
      // Links dentro de um parágrafo são isentos do critério.
      if (el.tagName === 'A' && el.closest('p')) return false;
      return r.width < 24 || r.height < 24;
    })
    .slice(0, 12)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { element: rotulo(el), width: Math.round(r.width), height: Math.round(r.height) };
    });

  // --- Imagens sem alternativa textual declarada.
  const imagesWithoutAlt = Array.from(doc.querySelectorAll('img'))
    .filter((el) => !el.hasAttribute('alt'))
    .slice(0, 12)
    .map((el) => ({ element: rotulo(el), src: el.currentSrc || el.src }));

  // --- Imagens que chegaram quebradas ou não carregaram.
  const brokenImages = Array.from(doc.querySelectorAll('img'))
    .filter((el) => el.complete && el.naturalWidth === 0)
    .slice(0, 12)
    .map((el) => ({ element: rotulo(el), src: el.currentSrc || el.src }));

  // --- Controles interativos sem nome acessível.
  const withoutAccessibleName = Array.from(doc.querySelectorAll('a[href],button,[role="button"],[role="link"]'))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const nome = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (nome) return false;
      const img = el.querySelector('img[alt]');
      return !(img && img.getAttribute('alt').trim());
    })
    .slice(0, 12)
    .map((el) => ({ element: rotulo(el) }));

  // --- Hierarquia de títulos: um h1 por tela, sem pular níveis.
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .map((el) => ({ level: Number(el.tagName[1]), text: (el.textContent || '').trim().slice(0, 60) }));
  const headingJumps = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) {
      headingJumps.push({ from: 'h' + headings[i - 1].level, to: 'h' + headings[i].level, text: headings[i].text });
    }
  }

  // --- Metadados da página.
  const meta = {
    lang: root.getAttribute('lang') || null,
    title: (doc.title || '').trim() || null,
    description: doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || null,
    viewport: doc.querySelector('meta[name="viewport"]')?.getAttribute('content') || null,
  };

  // --- Foco visível: percorre os interativos e compara o outline no :focus.
  const withoutVisibleFocus = [];
  const interativos = Array.from(doc.querySelectorAll(interactiveSelector)).slice(0, 25);
  for (const el of interativos) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const before = getComputedStyle(el);
    const marcaAntes = before.outlineWidth + '|' + before.outlineStyle + '|' + before.boxShadow + '|' + before.borderColor;
    el.focus({ preventScroll: true });
    const depois = getComputedStyle(el);
    const marcaDepois = depois.outlineWidth + '|' + depois.outlineStyle + '|' + depois.boxShadow + '|' + depois.borderColor;
    if (marcaAntes === marcaDepois) withoutVisibleFocus.push({ element: rotulo(el) });
    el.blur();
  }

  // --- axe-core: contraste, ARIA, semântica, formulários.
  let violations = [];
  let axeError = null;
  try {
    const r = await axe.run(doc, { resultTypes: ['violations'] });
    violations = r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.help,
      doc: v.helpUrl,
      targets: v.nodes.slice(0, 5).map((n) => ({ selector: n.target.join(' '), resumo: (n.failureSummary || '').split('\n').slice(0, 3).join(' ') })),
    }));
  } catch (e) {
    axeError = String(e && e.message ? e.message : e);
  }

  return {
    meta,
    pageOverflows,
    documentWidth: root.scrollWidth,
    viewportWidth,
    overflowingElements,
    smallTargets,
    imagesWithoutAlt,
    brokenImages,
    withoutAccessibleName,
    headingJumps,
    h1Count: headings.filter((t) => t.level === 1).length,
    withoutVisibleFocus: withoutVisibleFocus.slice(0, 8),
    violations,
    axeError,
  };
})()
