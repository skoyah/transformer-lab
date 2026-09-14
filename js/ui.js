// js/ui.js
// Shared rendering helpers: navigation, prose + callouts, matrix tables,
// worked examples and the "what just changed" panel. No maths lives here.

import { STAGE_BY_ID, STAGES, shapeOf } from './transformer.js';
import { getExperiment, onChange, setCurrentStep } from './state.js';

export const CHAPTERS = [
  { href: 'index.html', n: 0, label: 'Start here', title: 'A transformer you can read' },
  { href: 'tokens.html', n: 1, label: 'Tokens', title: 'Words become numbers' },
  { href: 'embeddings.html', n: 2, label: 'Embeddings', title: 'Numbers become meaning' },
  { href: 'attention.html', n: 3, label: 'Attention', title: 'Words look at each other' },
  { href: 'ffn.html', n: 4, label: 'Thinking', title: 'Each word thinks on its own' },
  { href: 'output.html', n: 5, label: 'Predicting', title: 'Guessing the next word' },
  { href: 'playground.html', n: 6, label: 'Put it to work', title: 'So what is this for?' },
];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmt(n, decimals = 2) {
  if (n === -Infinity) return '−∞';
  if (n === Infinity) return '∞';
  if (typeof n !== 'number' || Number.isNaN(n)) return '–';
  const s = n.toFixed(decimals);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function pct(p, decimals = 0) { return `${(p * 100).toFixed(decimals)}%`; }

// ---------------------------------------------------------------------------
// Prose building blocks
// ---------------------------------------------------------------------------

export function lesson(title, children, attrs = {}) {
  return el('section', { class: 'lesson', ...attrs }, [title ? el('h2', { text: title }) : null, ...[].concat(children)]);
}

export function prose(html) {
  return el('div', { class: 'prose', html });
}

const CALLOUT_LABELS = { idea: 'Analogy', try: 'Try it', key: 'Key idea' };
export function callout(kind, html, label) {
  return el('aside', { class: `callout ${kind}` }, [
    el('div', { class: 'label', text: label || CALLOUT_LABELS[kind] || kind }),
    el('div', { html }),
  ]);
}

export function underHood(formula, html) {
  return el('details', { class: 'under-hood' }, [
    el('summary', { text: 'Under the hood: the formula' }),
    el('code', { class: 'formula', text: formula }),
    html ? el('div', { class: 'prose', html }) : null,
  ]);
}

export function caption(text) { return el('p', { class: 'fig-caption', text }); }

// A figure bound to a pipeline stage; flashes when that stage recalculates.
export function figure(stageId, children, cap) {
  return el('div', { class: 'card figure', dataset: stageId ? { stage: stageId } : {}, id: stageId || null }, [
    el('div', { class: 'figure-row' }, children),
    cap ? caption(cap) : null,
  ]);
}

export function op(symbol) { return el('span', { class: 'op', text: symbol }); }

// Live worked example of one dot product: lhs = Σ a[i]·b[i].
export function dotExample(lhs, a, b, { aName = 'a', bName = 'b', decimals = 2, tail = '' } = {}) {
  const terms = a.map((x, i) => `<span class="term">(<b class="a">${fmt(x, decimals)}</b> × <b class="b">${fmt(b[i], decimals)}</b>)</span>`);
  const result = a.reduce((acc, x, i) => acc + x * b[i], 0);
  return el('div', { class: 'worked', html:
    `<span class="lhs">${esc(lhs)}</span><span class="eq">=</span>` +
    `<span class="a">${esc(aName)}</span> · <span class="b">${esc(bName)}</span><span class="eq">=</span>` +
    terms.join('<span class="eq">+</span>') +
    `<span class="eq">=</span><span class="result">${fmt(result, decimals)}</span>${tail}` });
}

export function sumExample(lhs, parts, { decimals = 2 } = {}) {
  const terms = parts.map(([label, v]) => `<span class="term"><span class="a">${esc(label)}</span> <b>${fmt(v, decimals)}</b></span>`);
  const result = parts.reduce((acc, [, v]) => acc + v, 0);
  return el('div', { class: 'worked', html:
    `<span class="lhs">${esc(lhs)}</span><span class="eq">=</span>${terms.join('<span class="eq">+</span>')}<span class="eq">=</span><span class="result">${fmt(result, decimals)}</span>` });
}

export function chapterNav(active) {
  const i = CHAPTERS.findIndex((c) => c.href === active);
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];
  return el('nav', { class: 'chapter-nav' }, [
    prev ? el('a', { href: prev.href, class: 'prev' }, [el('small', { text: `← Chapter ${prev.n}` }), el('b', { text: prev.title })]) : el('span'),
    next ? el('a', { href: next.href, class: 'next' }, [el('small', { text: `Chapter ${next.n} →` }), el('b', { text: next.title })]) : el('span'),
  ]);
}

export function tag(kind) {
  return el('span', { class: `tag ${kind}`, text: kind === 'stored' ? 'saved input' : 'recomputed' });
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

export function initPage(active) {
  setCurrentStep(active);
  const header = document.getElementById('nav');
  if (header) {
    header.replaceChildren(
      el('a', { class: 'brand', href: 'index.html', text: 'Transformer Lab' }),
      el('nav', {}, CHAPTERS.map((c) => el('a', { href: c.href, class: c.href === active ? 'active' : '' }, [
        el('span', { class: 'n', text: c.n }), c.label,
      ]))),
      el('span', { class: 'nav-sentence', id: 'nav-sentence' }),
    );
  }
  const updateSentence = () => {
    const s = document.getElementById('nav-sentence');
    if (s) s.textContent = `“${getExperiment().sentence}”`;
  };
  updateSentence();
  onChange((event) => {
    updateSentence();
    if (event.affected.length || event.reset || event.external) showRecalculation(event);
  });
  mountLog();
}

// ---------------------------------------------------------------------------
// Matrix tables
// ---------------------------------------------------------------------------

function heatStyle(value, mode, maxAbs) {
  if (!mode || typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (mode === 'sequential') {
    const a = Math.max(0, Math.min(1, value));
    return `--heat: rgba(var(--accent-rgb), ${(a * 0.85).toFixed(3)})`;
  }
  const a = maxAbs ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const rgb = value < 0 ? 'var(--neg-rgb)' : 'var(--pos-rgb)';
  return `--heat: rgba(${rgb}, ${(0.08 + a * 0.6).toFixed(3)})`;
}

// opts: { title, matrix, rowLabels, colLabels, editable, onEdit, heat, decimals,
//         highlightRows, dimRows, cornerLabel, note, small }
export function matrixTable(opts) {
  const {
    title, matrix, rowLabels, colLabels, editable = false, onEdit, heat = 'diverging',
    decimals = 2, highlightRows = null, dimRows = null, cornerLabel = '', note = null, small = false,
  } = opts;
  const rows = Array.isArray(matrix[0]) ? matrix : [matrix];
  let maxAbs = 0;
  for (const row of rows) for (const v of row) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));

  const table = el('table', { class: `matrix ${editable ? 'editable' : ''} ${small ? 'small' : ''}` });
  if (colLabels) {
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { class: 'corner', text: cornerLabel }),
      ...colLabels.map((c) => el('th', { text: c })),
    ])));
  }
  const tbody = el('tbody');
  rows.forEach((row, r) => {
    const cls = [highlightRows && highlightRows.has(r) ? 'hl' : '', dimRows && dimRows.has(r) ? 'dim' : ''].join(' ');
    const tr = el('tr', { class: cls });
    if (rowLabels || colLabels) tr.append(el('th', { text: rowLabels ? rowLabels[r] : '' }));
    row.forEach((v, c) => {
      const td = el('td', { style: heatStyle(v, heat, maxAbs) });
      if (editable) {
        td.append(el('input', {
          type: 'text', inputmode: 'decimal', value: fmt(v, decimals), 'aria-label': `${title || 'cell'} ${r},${c}`,
          onchange: (e) => {
            const parsed = Number(e.target.value.replace(',', '.'));
            if (!Number.isFinite(parsed)) { e.target.value = fmt(v, decimals); return; }
            onEdit && onEdit(r, c, parsed);
          },
          onfocus: (e) => e.target.select(),
        }));
      } else {
        td.textContent = fmt(v, decimals);
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);

  const wrap = el('figure', { class: 'matrix-wrap' });
  if (title) wrap.append(el('figcaption', {}, [
    el('span', { class: 'mtitle', text: title }),
    el('span', { class: 'shape', text: shapeOf(rows) }),
    editable ? el('span', { class: 'badge', text: 'editable · saved' }) : null,
  ]));
  wrap.append(el('div', { class: 'scroll' }, table));
  if (note) wrap.append(el('p', { class: 'note', text: note }));
  return wrap;
}

export function tokenLabels(derived) {
  return derived.tokens.map((t, i) => `${t} ${i}`);
}

export function dimLabels(n, prefix = 'd') {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

// ---------------------------------------------------------------------------
// "What just changed" — makes invalidation visible
// ---------------------------------------------------------------------------

const KEY_LABELS = {
  sentence: 'the training text', vocab: 'the vocabulary', tokenIds: 'the token IDs', seed: 'the random seed',
  'config.dim': 'the embedding size', 'config.hidden': 'the hidden size', 'config.causal': 'the causal mask',
  weights: 'all weights', 'weights.embedding': 'the embedding table E', 'weights.positional': 'the position table P',
  'weights.Wq': 'Wq', 'weights.Wk': 'Wk', 'weights.Wv': 'Wv', 'weights.W1': 'W₁', 'weights.b1': 'b₁',
  'weights.W2': 'W₂', 'weights.b2': 'b₂', 'weights.Wout': 'Wout', '*': 'the experiment',
};

let logEl = null;
let sequence = 0;

function mountLog() {
  logEl = document.getElementById('recalc-log');
  if (!logEl) return;
  logEl.replaceChildren(
    el('header', {}, [
      el('strong', { text: 'What just changed' }),
      el('span', {}, [
        el('button', { class: 'ghost', text: 'clear', onclick: () => list().replaceChildren() }),
        el('button', { class: 'ghost', text: 'hide', onclick: (e) => { logEl.classList.toggle('collapsed'); e.target.textContent = logEl.classList.contains('collapsed') ? 'show' : 'hide'; } }),
      ]),
    ]),
    el('ol', { class: 'entries' }),
  );
}

function list() { return logEl.querySelector('.entries'); }

function describeChange(event) {
  if (event.reset) return 'You reset the experiment';
  if (event.snapshot) return `You loaded the bookmark “${event.snapshot.name}”`;
  if (event.external) return 'The experiment changed in another tab';
  if (event.training) return `You trained ${event.steps} step${event.steps > 1 ? 's' : ''} — surprise ${fmt(event.training.lossBefore, 2)} → ${fmt(event.training.lossAfter, 2)}`;
  if (event.reinitialised) return `You changed ${event.changedKeys.filter((k) => k !== 'weights').map((k) => KEY_LABELS[k] || k).join(' and ')} — all weights were re-rolled`;
  if (event.cell) {
    const c = event.cell;
    const pos = c.col == null ? `[${c.row}]` : `[${c.row}][${c.col}]`;
    return `You set ${KEY_LABELS['weights.' + c.name] || c.name}${pos} to ${fmt(c.value, 2)}`;
  }
  return `You changed ${event.changedKeys.map((k) => KEY_LABELS[k] || k).join(', ')}`;
}

export function showRecalculation(event) {
  const prefs = getExperiment().animation || { enabled: true, stepDelayMs: 220 };
  const delay = prefs.enabled ? prefs.stepDelayMs : 0;
  const mine = ++sequence;

  const entry = el('li', { class: 'entry' }, [
    el('div', { class: 'cause', text: describeChange(event) }),
    el('ol', { class: 'steps' }, [el('li', { class: 'stored', text: 'saved' })]),
  ]);
  if (logEl) {
    list().prepend(entry);
    while (list().children.length > 5) list().lastChild.remove();
  }

  const steps = entry.querySelector('.steps');
  event.affected.forEach((id, i) => {
    // Always asynchronous: pages re-render synchronously after this listener,
    // so the DOM is queried at flash time rather than captured now.
    setTimeout(() => {
      if (mine !== sequence && delay) return; // a newer change superseded this one
      const stage = STAGE_BY_ID[id];
      steps.append(el('li', { text: stage ? stage.label : id, title: 'recalculated' }));
      document.querySelectorAll(`[data-stage="${id}"]`).forEach((node) => {
        node.classList.remove('recalc');
        void node.offsetWidth; // restart the CSS animation
        node.classList.add('recalc');
      });
    }, i * delay);
  });
}

// ---------------------------------------------------------------------------
// Re-render binding. Rendering is deferred a tick so that a Tab keypress
// that triggered a cell change still lands focus on the next cell, which is
// then re-found by its aria-label after the DOM is rebuilt.
// ---------------------------------------------------------------------------

export function withFocus(fn) {
  const active = document.activeElement;
  const label = active && active.getAttribute ? active.getAttribute('aria-label') : null;
  fn();
  if (!label) return;
  const next = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  if (next) next.focus();
}

export function bindRender(render, { quietKeys = [] } = {}) {
  render();
  let pending = false;
  onChange((event) => {
    if (event.quiet && !event.changedKeys.some((k) => quietKeys.includes(k))) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; withFocus(render); }, 0);
  });
}

export { STAGES };
