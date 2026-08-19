#!/usr/bin/env node
/**
 * Validação de front-end ponta a ponta via agent-browser.
 *
 * Percorre cada rota de scripts/routes.mjs em todos os viewports e temas,
 * e em cada combinação coleta: status HTTP, erros de console, exceções não
 * capturadas, requisições que falharam, audit axe-core, estouro
 * horizontal, alvos de toque, foco visível e metadados. Fecha com Core Web
 * Vitals por rota e com os fluxos de interação declarados.
 *
 *   node scripts/test-frontend.mjs               # tudo
 *   node scripts/test-frontend.mjs --fast      # só desktop/light
 *   node scripts/test-frontend.mjs --route /login # uma rota só
 *   BASE_URL=http://localhost:3001 node scripts/test-frontend.mjs
 *
 * Sai com código 1 se houver algum achado de severity "erro".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ROUTES, VIEWPORTS, THEMES, MISSING_ROUTES } from './routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SESSION = process.env.TEST_SESSION || 'validacao-front';
const ARGS = process.argv.slice(2);
const FAST = ARGS.includes('--fast');
const NO_SHOTS = ARGS.includes('--no-shots');
const ONLY_ROUTE = (() => {
  const i = ARGS.indexOf('--route');
  return i >= 0 ? ARGS[i + 1] : null;
})();

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = join(ROOT, '.agent-browser', 'reports', STAMP);
const SHOTS_DIR = join(OUT_DIR, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

// O npm hoista o axe-core para a raiz do workspace, mas nada garante isso —
// resolver pelo próprio Node acha onde ele estiver.
const requireLocal = createRequire(import.meta.url);
let AXE_SOURCE;
try {
  AXE_SOURCE = readFileSync(join(dirname(requireLocal.resolve('axe-core')), 'axe.min.js'), 'utf8');
} catch {
  console.error('axe-core não encontrado. Rode "npm install" before de validar.');
  process.exit(1);
}
const AUDIT_SCRIPT = readFileSync(join(ROOT, 'scripts/browser-audit.js'), 'utf8');

const findings = [];
/** @param {'error'|'warning'} severity */
function report(severity, context, title, detail) {
  findings.push({ severity, context, title, detail });
}

// --- Ponte com a CLI -------------------------------------------------------

function ab(args, input) {
  try {
    const output = execFileSync('agent-browser', ['--session', SESSION, ...args, '--json'], {
      input: input,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      cwd: ROOT,
    });
    return JSON.parse(output);
  } catch (e) {
    // A CLI devolve JSON mesmo quando sai com código != 0.
    const raw = (e.stdout || '').trim();
    if (raw.startsWith('{')) {
      try { return JSON.parse(raw); } catch { /* cai no retorno abaixo */ }
    }
    return { success: false, data: null, error: String(e.stderr || e.message || e).trim() };
  }
}

const asList = (data, key) => (Array.isArray(data?.[key]) ? data[key] : []);

// --- Coleta por combinação -------------------------------------------------

function measureCombo(route, viewport, theme) {
  const context = `${route.name} · ${viewport.name} · ${theme}`;
  const url = BASE + route.path;

  ab(['set', 'viewport', String(viewport.width), String(viewport.height)]);
  ab(['set', 'media', theme]);
  ab(['console', '--clear']);
  ab(['errors', '--clear']);
  ab(['network', 'requests', '--clear']);

  const opened = ab(['open', url]);
  if (!opened.success) {
    report('error', context, 'Falha ao abrir a route', `${url} — ${opened.error}`);
    return;
  }
  ab(['wait', '--load', 'networkidle']);

  if (route.expectText) {
    const found = ab(['wait', '--text', route.expectText]);
    if (!found.success) {
      report('error', context, 'Conteúdo esperado não apareceu', `Texto "${route.expectText}" ausente após o load.`);
    }
  }

  // Status HTTP do documento.
  const status = ab(['eval', "performance.getEntriesByType('navigation')[0]?.responseStatus ?? null"]);
  const code = status?.data?.result;
  if (typeof code === 'number' && code >= 400) {
    report('error', context, `Documento respondeu ${code}`, url);
  }

  // Console e exceções.
  const messages = asList(ab(['console']).data, 'messages');
  for (const m of messages) {
    const text = String(m.text || '');
    if (m.type === 'error') {
      report('error', context, 'Erro no console', text.slice(0, 400));
    } else if (m.type === 'warning' || m.type === 'warn') {
      report('warning', context, 'Aviso no console', text.slice(0, 400));
    }
  }
  for (const e of asList(ab(['errors']).data, 'errors')) {
    report('error', context, 'Exceção não capturada', String(e.message || e.text || JSON.stringify(e)).slice(0, 400));
  }

  // Requisições com falha.
  for (const r of asList(ab(['network', 'requests']).data, 'requests')) {
    if (typeof r.status === 'number' && r.status >= 400) {
      report('error', context, `Requisição ${r.status}`, `${r.method || 'GET'} ${r.url || r.requestId}`);
    } else if (r.failed || r.errorText) {
      report('error', context, 'Requisição failed', `${r.url || r.requestId} — ${r.errorText || 'sem resposta'}`);
    }
  }

  // Auditoria in-page (axe + checagens de layout/design).
  ab(['eval', '--stdin'], AXE_SOURCE + '\n;"axe-ok"');
  const audit = ab(['eval', '--stdin'], AUDIT_SCRIPT);
  const a = audit?.data?.result;
  if (!a || typeof a !== 'object') {
    report('error', context, 'Auditoria não executou', String(audit?.error || 'sem resultado'));
  } else {
    evaluateAudit(a, context, viewport, theme);
  }

  if (!NO_SHOTS) {
    const file = join(SHOTS_DIR, `${route.name}--${viewport.name}--${theme}.png`);
    ab(['screenshot', file, '--full']);
  }
}

function evaluateAudit(a, context, viewport, theme) {
  if (a.axeError) report('warning', context, 'axe-core não rodou', a.axeError);

  for (const v of a.violations || []) {
    const severe = v.impact === 'critical' || v.impact === 'serious';
    const targets = (v.targets || []).map((t) => t.selector).join(', ');
    report(severe ? 'error' : 'warning', context, `a11y/${v.id} (${v.impact})`, `${v.description} — em: ${targets}`);
  }

  if (a.pageOverflows) {
    const offenders = (a.overflowingElements || []).map((e) => `${e.element} (right ${e.right}px)`).join('; ');
    report('error', context, 'Estouro horizontal', `documento ${a.documentWidth}px > viewport ${a.viewportWidth}px. ${offenders || 'sem culpado isolado'}`);
  }

  for (const i of a.brokenImages || []) {
    report('error', context, 'Imagem quebrada', `${i.element} — ${i.src}`);
  }
  for (const i of a.imagesWithoutAlt || []) {
    report('error', context, 'Imagem sem atributo alt', `${i.element} — ${i.src}`);
  }
  for (const i of a.withoutAccessibleName || []) {
    report('error', context, 'Controle sem nome acessível', i.element);
  }
  for (const t of a.smallTargets || []) {
    report('warning', context, 'Alvo de toque < 24px', `${t.element} — ${t.width}×${t.height}px`);
  }
  for (const f of a.withoutVisibleFocus || []) {
    report('warning', context, 'Sem indicador de foco visível', f.element);
  }
  for (const s of a.headingJumps || []) {
    report('warning', context, 'Salto na hierarquia de títulos', `${s.from} → ${s.to} ("${s.text}")`);
  }

  // Metadados só precisam ser checados uma vez por rota.
  if (viewport.name === 'desktop' && theme === 'light') {
    if (!a.meta.lang) report('error', context, 'Sem atributo lang no <html>', 'Leitores de tela não sabem o idioma da página.');
    if (!a.meta.title || a.meta.title === 'Create Next App') {
      report('error', context, 'Título da página não definido', `title = ${JSON.stringify(a.meta.title)}`);
    }
    if (!a.meta.description || /Generated by create next app/i.test(a.meta.description)) {
      report('warning', context, 'Meta description ausente ou placeholder', `description = ${JSON.stringify(a.meta.description)}`);
    }
    if (a.h1Count === 0) report('error', context, 'Nenhum <h1> na página', 'Toda tela precisa de um título principal.');
    if (a.h1Count > 1) report('warning', context, `${a.h1Count} elementos <h1>`, 'Use um só por tela.');
  }
}

// --- Fluxos de interação ---------------------------------------------------

function runFlows(route) {
  for (const flow of route.flows || []) {
    const context = `${route.name} · flow "${flow.name}"`;
    ab(['set', 'viewport', '1440', '900']);
    ab(['console', '--clear']);
    ab(['errors', '--clear']);
    ab(['open', BASE + route.path]);
    ab(['wait', '--load', 'networkidle']);

    let failed = false;
    for (const step of flow.steps) {
      const r = ab(step);
      if (!r.success) {
        report('error', context, 'Passo do flow failed', `${step.join(' ')} — ${r.error}`);
        failed = true;
        break;
      }
    }
    if (failed) continue;

    for (const e of asList(ab(['errors']).data, 'errors')) {
      report('error', context, 'Exceção durante o flow', String(e.message || e.text || '').slice(0, 400));
    }
    if (flow.expectText) {
      const ok = ab(['wait', '--text', flow.expectText]);
      if (!ok.success) report('error', context, 'Resultado esperado do flow não apareceu', flow.expectText);
    }
  }
}

// --- Execução --------------------------------------------------------------

const targetRoutes = ONLY_ROUTE ? ROUTES.filter((r) => r.path === ONLY_ROUTE || r.name === ONLY_ROUTE) : ROUTES;
if (targetRoutes.length === 0) {
  console.error(`Nenhuma route corresponde a "${ONLY_ROUTE}". Registre-a em scripts/routes.mjs.`);
  process.exit(1);
}

const targetViewports = FAST ? VIEWPORTS.filter((v) => v.name === 'desktop') : VIEWPORTS;
const targetThemes = FAST ? ['light'] : THEMES;

console.log(`\nValidando ${BASE} — ${targetRoutes.length} route(s) × ${targetViewports.length} viewport(s) × ${targetThemes.length} theme(s)\n`);

const reachable = ab(['open', BASE]);
if (!reachable.success) {
  console.error(`Servidor inacessível em ${BASE}. Suba com "npm run dev" before de validar.`);
  console.error(reachable.error);
  ab(['close']);
  process.exit(1);
}

const vitalsByRoute = {};
for (const route of targetRoutes) {
  for (const viewport of targetViewports) {
    for (const theme of targetThemes) {
      process.stdout.write(`  ${route.name} · ${viewport.name} · ${theme} … `);
      const before = findings.length;
      measureCombo(route, viewport, theme);
      const fresh = findings.slice(before);
      const errors = fresh.filter((f) => f.severity === 'error').length;
      const warnings = fresh.length - errors;
      console.log(errors ? `${errors} erro(s), ${warnings} aviso(s)` : warnings ? `ok, ${warnings} aviso(s)` : 'ok');
    }
  }
  const v = ab(['vitals', BASE + route.path]);
  vitalsByRoute[route.name] = v?.data?.report || v?.error || 'indisponível';
  runFlows(route);
}

// 404 precisa continuar sendo 404.
for (const path of MISSING_ROUTES) {
  ab(['open', BASE + path]);
  const s = ab(['eval', "performance.getEntriesByType('navigation')[0]?.responseStatus ?? null"]);
  if (s?.data?.result !== 404) {
    report('warning', 'roteamento', 'Rota inexistente não devolveu 404', `${path} respondeu ${s?.data?.result}`);
  }
}

ab(['close']);

// --- Relatório -------------------------------------------------------------

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');

const group = (items) => {
  const map = new Map();
  for (const f of items) {
    const key = f.title + '||' + f.detail;
    if (!map.has(key)) map.set(key, { ...f, contexts: [] });
    map.get(key).contexts.push(f.context);
  }
  return [...map.values()];
};

const section = (nome, items) => {
  if (items.length === 0) return `## ${nome}\n\nNenhum.\n`;
  const lines = group(items).map((f) => {
    const ctx = f.contexts.length > 3 ? `${f.contexts.slice(0, 3).join(', ')} (+${f.contexts.length - 3})` : f.contexts.join(', ');
    return `- **${f.title}** — ${f.detail}\n  - ocorre em: ${ctx}`;
  });
  return `## ${nome} (${items.length})\n\n${lines.join('\n')}\n`;
};

const markdown = [
  `# Validação de front-end`,
  ``,
  `- Base: ${BASE}`,
  `- Quando: ${new Date().toISOString()}`,
  `- Cobertura: ${targetRoutes.map((r) => r.path).join(', ')} × ${targetViewports.map((v) => v.name).join(', ')} × ${targetThemes.join(', ')}`,
  `- Resultado: **${errors.length} erro(s), ${warnings.length} aviso(s)**`,
  ``,
  section('Erros', errors),
  section('Avisos', warnings),
  `## Core Web Vitals`,
  ``,
  ...Object.entries(vitalsByRoute).map(([nome, rel]) => `### ${nome}\n\n\`\`\`\n${rel}\n\`\`\`\n`),
  `## Capturas`,
  ``,
  NO_SHOTS ? 'Desativadas nesta execução.' : `\`${SHOTS_DIR}\``,
  ``,
].join('\n');

writeFileSync(join(OUT_DIR, 'report.md'), markdown);
writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify({ base: BASE, findings, vitals: vitalsByRoute }, null, 2));

console.log(`\n${errors.length} erro(s), ${warnings.length} aviso(s)`);
console.log(`Relatório: ${join(OUT_DIR, 'report.md')}\n`);

if (errors.length > 0) {
  console.log('Erros encontrados:');
  for (const f of group(errors)) console.log(`  • [${f.contexts[0]}] ${f.title} — ${f.detail}`);
  console.log('');
  process.exit(1);
}
