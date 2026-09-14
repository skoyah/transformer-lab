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
    if (event.quiet) return;
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
  if (value === 0) return '';
  const a = maxAbs ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const rgb = value < 0 ? 'var(--neg-rgb)' : 'var(--pos-rgb)';
  return `--heat: rgba(${rgb}, ${(0.08 + a * 0.6).toFixed(3)})`;
}

// opts: { title, matrix, rowLabels, colLabels, editable, onEdit, heat, decimals,
//         highlightRows, dimRows, cornerLabel, note, small,
//         filled(r,c) -> bool   cells not yet computed are drawn blank
//         hlRow, hlCol, hlCell  the row / column / cell involved in the current step
//         pulse                 [r,c] cell that was just filled (pop animation) }
export function matrixTable(opts) {
  const {
    title, matrix, rowLabels, colLabels, editable = false, onEdit, heat = 'diverging',
    decimals = 2, highlightRows = null, dimRows = null, cornerLabel = '', note = null, small = false,
    filled = null, hlRow = null, hlCol = null, hlCell = null, pulse = null,
  } = opts;
  const rows = Array.isArray(matrix[0]) ? matrix : [matrix];
  let maxAbs = 0;
  for (const row of rows) for (const v of row) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));

  const table = el('table', { class: `matrix ${editable ? 'editable' : ''} ${small ? 'small' : ''}` });
  if (colLabels) {
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { class: 'corner', text: cornerLabel }),
      ...colLabels.map((c, j) => el('th', { text: c, class: hlCol === j ? 'hl' : '' })),
    ])));
  }
  const tbody = el('tbody');
  rows.forEach((row, r) => {
    const cls = [highlightRows && highlightRows.has(r) ? 'hl' : '', dimRows && dimRows.has(r) ? 'dim' : '', hlRow === r ? 'hlrow' : ''].join(' ');
    const tr = el('tr', { class: cls });
    if (rowLabels || colLabels) tr.append(el('th', { text: rowLabels ? rowLabels[r] : '' }));
    row.forEach((v, c) => {
      const isBlank = filled && !filled(r, c);
      const isCell = hlCell && hlCell[0] === r && hlCell[1] === c;
      const isPulse = pulse && pulse[0] === r && pulse[1] === c;
      const td = el('td', {
        style: isBlank ? '' : heatStyle(v, heat, maxAbs),
        class: [isBlank ? 'blank' : '', hlCol === c ? 'hlcol' : '', hlRow === r ? 'hlrow' : '', isCell ? 'hlcell' : '', isPulse ? 'pulse' : ''].join(' '),
        dataset: { r, c },
      });
      if (isBlank) {
        td.textContent = '·';
      } else if (editable) {
        td.append(el('input', {
          type: 'text', inputmode: 'decimal', value: fmt(v, decimals), 'aria-label': `${title || 'cell'} ${r},${c}`,
          onchange: (e) => {
            const parsed = Number(e.target.value.replace(',', '.'));
            if (!Number.isFinite(parsed)) { e.target.value = fmt(v, decimals); return; }
            onEdit && onEdit(r, c, parsed);
          },
          onfocus: (e) => e.target.select(),
          onkeydown: (e) => matrixKeys(e, r, c, v, decimals, onEdit),
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

// Keyboard editing: ↑/↓ nudge by 0.1 (Shift: 1, Alt: 0.01) and save at once;
// ←/→ at the edge of the text move to the neighbouring cell; Enter saves and
// moves down; Escape reverts.
function matrixKeys(e, r, c, original, decimals, onEdit) {
  const input = e.target;
  const table = input.closest('table');
  const go = (dr, dc) => {
    const next = table.querySelector(`td[data-r="${r + dr}"][data-c="${c + dc}"] input`);
    if (next) { e.preventDefault(); next.focus(); }
  };
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1;
    const current = Number(input.value.replace(',', '.'));
    const base = Number.isFinite(current) ? current : original;
    const next = Math.round((base + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000;
    input.value = fmt(next, Math.max(decimals, step < 0.1 ? 3 : 2));
    onEdit && onEdit(r, c, next);
  } else if (e.key === 'ArrowLeft' && input.selectionStart === 0) {
    go(0, -1);
  } else if (e.key === 'ArrowRight' && input.selectionEnd === input.value.length) {
    go(0, 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    input.dispatchEvent(new Event('change'));
    go(1, 0);
  } else if (e.key === 'Escape') {
    input.value = fmt(original, decimals);
    input.blur();
  }
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
  if (event.training) return `You trained ${event.steps} step${event.steps > 1 ? 's' : ''} — surprise ${fmt(event.training.lossBefore, 2)} → ${fmt(event.training.lossAfter, 2)}. Weights changed, so every stage needs replaying.`;
  if (event.reinitialised) return `You changed ${event.changedKeys.filter((k) => k !== 'weights').map((k) => KEY_LABELS[k] || k).join(' and ')} — all weights were re-rolled`;
  if (event.cell) {
    const c = event.cell;
    const pos = c.col == null ? `[${c.row}]` : `[${c.row}][${c.col}]`;
    return `You set ${KEY_LABELS['weights.' + c.name] || c.name}${pos} to ${fmt(c.value, 2)}`;
  }
  return `You changed ${event.changedKeys.map((k) => KEY_LABELS[k] || k).join(', ')}`;
}

let trainingRun = null; // { entry, steps, lossStart } — consecutive training steps share one entry

export function showRecalculation(event) {
  if (!logEl) return;
  if (event.training && trainingRun && list().firstChild === trainingRun.entry) {
    trainingRun.steps += event.steps;
    trainingRun.entry.querySelector('.cause').textContent =
      `You trained ${trainingRun.steps} steps — surprise ${fmt(trainingRun.lossStart, 2)} → ${fmt(event.training.lossAfter, 2)}. Weights changed, so every stage needs replaying.`;
    return;
  }
  const chips = event.affected.map((id) => {
    const stage = STAGE_BY_ID[id];
    return el('a', { class: 'chip-link', href: `${stage.page}#${id}`, text: stage.label, title: 'needs replaying — click to go there' });
  });
  const entry = el('li', { class: 'entry' }, [
    el('div', { class: 'cause', text: describeChange(event) }),
    el('div', { class: 'hint', text: event.affected.length ? 'Saved. Nothing is shown until you press play on each stage:' : 'Saved.' }),
    el('div', { class: 'steps' }, chips),
  ]);
  list().prepend(entry);
  trainingRun = event.training ? { entry, steps: event.steps, lossStart: event.training.lossBefore } : null;
  while (list().children.length > 5) list().lastChild.remove();
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

// ---------------------------------------------------------------------------
// Attention arcs: the sentence on a baseline, an arc from each asking word
// to each word it listens to. Width and opacity follow the share.
// rows: [{ i, w }] — asker index and its weights over `tokens`.
// focus: asker index to emphasise (others fade); hover a word to focus it.
// ---------------------------------------------------------------------------

export function attentionArcs({ tokens, rows, focus = null, minShare = 0.03 }) {
  const n = tokens.length;
  const gap = Math.max(64, Math.min(110, 720 / Math.max(n, 1)));
  const pad = 28;
  const w = pad * 2 + gap * (n - 1);
  const h = Math.min(240, 90 + gap * 1.3);
  const y = h - 30;
  const x = (i) => pad + i * gap;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'arcs');
  svg.style.maxWidth = `${w}px`;
  if (focus != null) svg.dataset.focus = focus;
  const add = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  const defs = add('defs', {});
  const marker = add('marker', { id: 'arc-head', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, defs);
  add('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'currentColor' }, marker);
  add('line', { x1: pad - 12, x2: w - pad + 12, y1: y, y2: y, class: 'base' });

  for (const { i, w: weights } of rows) {
    weights.forEach((share, j) => {
      if (share < minShare) return;
      const cls = `arc from-${i}${i === focus ? ' focus' : ''}`;
      const len = { pathLength: 1 };
      const width = (0.8 + 7 * share).toFixed(2);
      const opacity = (0.18 + 0.82 * share).toFixed(2);
      if (i === j) {
        add('path', { d: `M${x(i) - 6},${y - 4} C${x(i) - 22},${y - 34} ${x(i) + 22},${y - 34} ${x(i) + 6},${y - 4}`, class: cls, 'stroke-width': width, opacity, 'marker-end': 'url(#arc-head)', ...len });
      } else {
        const lift = Math.min((y - 10) * 2, 30 + Math.abs(i - j) * gap * 0.7);
        add('path', { d: `M${x(i)},${y - 6} Q${(x(i) + x(j)) / 2},${y - lift} ${x(j)},${y - 6}`, class: cls, 'stroke-width': width, opacity, 'marker-end': 'url(#arc-head)', ...len });
      }
    });
  }
  tokens.forEach((t, i) => {
    const g = add('g', { class: `word${i === focus ? ' focus' : ''}`, transform: `translate(${x(i)},${y + 18})` });
    add('text', { 'text-anchor': 'middle', 'font-size': 13 }, g).textContent = t;
    add('text', { 'text-anchor': 'middle', 'font-size': 9, y: 12, class: 'idx' }, g).textContent = `#${i}`;
    g.addEventListener('mouseenter', () => { svg.dataset.hover = i; });
    g.addEventListener('mouseleave', () => { delete svg.dataset.hover; });
  });
  return svg;
}

// ---------------------------------------------------------------------------
// Softmax as three bar charts: raw scores → e^score → shares. Bars grow in
// sequence so the "exponential makes winners win big" step is visible.
// ---------------------------------------------------------------------------

export function softmaxBars({ labels, scores, hiddenMask = null, stepMs = 1300 }) {
  const finite = scores.map((v) => (v === -Infinity ? null : v));
  const exps = finite.map((v) => (v == null ? 0 : Math.exp(v)));
  const sum = exps.reduce((a, b) => a + b, 0);
  const shares = exps.map((e) => (sum ? e / sum : 0));
  const maxAbs = Math.max(0.01, ...finite.filter((v) => v != null).map((v) => Math.abs(v)));
  const maxExp = Math.max(0.01, ...exps);
  const phaseMs = Math.max(220, Math.min(600, stepMs * 0.28));
  const col = (title, values, kind, scale, phase) => el('div', { class: 'sbars' }, [
    el('div', { class: 'sbars-title', text: title }),
    ...values.map((v, i) => {
      const hidden = finite[i] == null;
      const pctW = hidden ? 0 : Math.min(100, (Math.abs(v) / scale) * 100);
      return el('div', { class: `sbar ${kind} ${hidden ? 'hidden' : ''} ${v < 0 ? 'neg' : ''}` }, [
        el('span', { class: 'lbl', text: labels[i] }),
        el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${pctW}%; animation-delay:${phase * phaseMs}ms; animation-duration:${phaseMs}ms` })),
        el('span', { class: 'val', text: hidden ? 'hidden' : kind === 'share' ? pct(v) : fmt(v) }),
      ]);
    }),
  ]);
  return el('div', { class: 'softmax-bars' }, [
    col('scores', finite.map((v) => v ?? 0), 'raw', maxAbs, 0),
    el('span', { class: 'op', text: '→' }),
    col('e^score', exps, 'exp', maxExp, 1),
    el('span', { class: 'op', text: '→' }),
    col(`÷ ${fmt(sum)}`, shares, 'share', 1, 2),
  ]);
}

// ---------------------------------------------------------------------------
// Layer norm as a strip: the row's values as dots on one number line, then
// slid so their mean is 0, then stretched/squeezed to unit spread.
// ---------------------------------------------------------------------------

export function normStrip({ values, labels, stepMs = 1300, eps = 1e-5 }) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance + eps);
  const centred = values.map((v) => v - mean);
  const normed = centred.map((v) => v / std);
  const range = Math.max(1.5, ...values.map(Math.abs), ...centred.map(Math.abs), ...normed.map(Math.abs)) * 1.15;
  const W = 520, H = 118, padL = 86, padR = 16, rowH = 30;
  const x = (v) => padL + ((v + range) / (2 * range)) * (W - padL - padR);
  const phaseMs = Math.max(260, Math.min(650, stepMs * 0.3));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'norm-strip');
  const add = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  const rows = [
    { name: 'row', vals: values, prev: values, note: `mean ${fmt(mean)}` },
    { name: '− mean', vals: centred, prev: values, note: 'centred on 0' },
    { name: `÷ ${fmt(std)}`, vals: normed, prev: centred, note: 'spread 1' },
  ];
  rows.forEach((r, ri) => {
    const y = 18 + ri * rowH + 12;
    add('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'axis' });
    add('line', { x1: x(0), x2: x(0), y1: y - 8, y2: y + 8, class: 'zero' });
    add('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'lbl' }).textContent = r.name;
    add('text', { x: W - padR, y: y - 9, 'text-anchor': 'end', class: 'note' }).textContent = r.note;
    if (ri === 0) add('line', { x1: x(mean), x2: x(mean), y1: y - 10, y2: y + 10, class: 'mean' });
    r.vals.forEach((v, i) => {
      const c = add('circle', { cx: 0, cy: y, r: 5.5, class: `dot ${v < 0 ? 'neg' : 'pos'}` });
      c.style.setProperty('--x0', `${x(r.prev[i])}px`);
      c.style.setProperty('--x1', `${x(v)}px`);
      c.style.animationDelay = `${ri * phaseMs}ms`;
      c.style.animationDuration = `${phaseMs}ms`;
      add('title', {}, c).textContent = `${labels ? labels[i] + ': ' : ''}${fmt(v)}`;
    });
  });
  return svg;
}
