// js/ui.js
// Shared rendering helpers: navigation, prose + callouts, matrix tables,
// worked examples and the "what just changed" panel. No maths lives here.

import { STAGE_BY_ID, STAGES, shapeOf } from './transformer.js';
import { GLOSSARY } from './glossary.js';
import { getExperiment, onChange, setCurrentStep, undo, redo, canUndo, canRedo, setCoalescing, setView, LENS_SIZES, setMode, isLab, wipeAll } from './state.js';

export const CHAPTERS = [
  { href: 'index.html', n: 0, label: 'Start here', title: 'A transformer you can read',
    goal: 'say what the book builds (a tiny next-word predictor), what a weight is, and how to play a stage.' },
  { href: 'tokens.html', n: 1, label: 'Tokens', title: 'Words become numbers',
    bridge: 'Where we are: you have seen the model guess. Now, how does text get into it at all?',
    goal: 'cut any sentence into tokens, explain why pieces rather than words or letters, and look a piece up to get its number.' },
  { href: 'embeddings.html', n: 2, label: 'Embeddings', title: 'Numbers become meaning',
    bridge: 'Where we are: your text is now a list of ticket numbers. Next, the numbers get meaning.',
    goal: 'explain why a ticket number becomes a row of numbers, why position is added, and what the table X is.' },
  { href: 'attention.html', n: 3, label: 'Attention', title: 'Words look at each other',
    bridge: 'Where we are: every token has its own row of numbers, but knows nothing about its neighbours. Next, they talk.',
    goal: 'walk one token through question → badge → score → share → blended note, and read an attention table.' },
  { href: 'ffn.html', n: 4, label: 'Thinking', title: 'Each word thinks on its own',
    bridge: 'Where we are: each token has gathered what it needed from the others. Next, each one processes it alone.',
    goal: 'explain “add back, normalise, think alone, add back, normalise”, and why a token keeps its original row.' },
  { href: 'output.html', n: 5, label: 'Predicting', title: 'Guessing the next word',
    bridge: 'Where we are: the block is done; every token has a final row of numbers. Next, turning that into a bet — and teaching the model to bet better.',
    goal: 'read a probability row, compute the surprise for one position, and say what one training step does.' },
  { href: 'playground.html', n: 6, label: 'Put it to work', title: 'So what is this for?',
    bridge: 'Where we are: you have a trained model. Now use it the way a phone keyboard or a chatbot would.',
    goal: 'run the model as autocomplete, compare fresh and trained, and explain what temperature does.' },
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

// Prose with glossary tooltips: the first time a page mentions a glossary
// term in running text, it gets a dotted underline and a plain definition.
const linked = new Set();
export function resetGlossary() { linked.clear(); }
// Words with everyday meanings ("the value 0.5", "a key point") are not auto-linked.
const AMBIGUOUS = new Set(['key', 'value', 'query', 'bias', 'loss', 'training']);
const TERM_RE = new RegExp('\\b(' + Object.keys(GLOSSARY).filter((t) => !AMBIGUOUS.has(t)).sort((a, b) => b.length - a.length).map((t) => t.replace(/[-]/g, '\\-')).join('|') + ')\\b', 'i');
export function prose(html) {
  const node = el('div', { class: 'prose', html });
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const texts = [];
  let t;
  while ((t = walker.nextNode())) if (!t.parentElement.closest('dfn, code, a, strong')) texts.push(t);
  for (const text of texts) {
    let rest = text;
    for (let guard = 0; guard < 6; guard++) {
      const m = TERM_RE.exec(rest.nodeValue);
      if (!m) break;
      const key = m[1].toLowerCase();
      if (linked.has(key) || linked.has(key.replace(/s$/, '')) || linked.has(key + 's')) { rest = rest.splitText(m.index + m[0].length); continue; }
      linked.add(key);
      const after = rest.splitText(m.index);
      const tail = after.splitText(m[0].length);
      const dfn = el('dfn', { class: 'term', tabindex: '0', 'data-tip': GLOSSARY[key], 'aria-description': GLOSSARY[key], text: m[0] });
      after.replaceWith(dfn);
      rest = tail;
    }
  }
  return node;
}

const CALLOUT_LABELS = { idea: 'Analogy', try: 'Try it', key: 'Key idea' };
// actions: [{ label, run, then }] — one-click experiments; `then` is a stage id to scroll to.
export function callout(kind, html, label, actions = null) {
  return el('aside', { class: `callout ${kind}` }, [
    el('div', { class: 'label', text: label || CALLOUT_LABELS[kind] || kind }),
    el('div', { html }),
    actions && actions.length ? el('div', { class: 'actions' }, [
      ...actions.map((a) => el('button', { text: a.label, onclick: () => {
        a.run();
        if (a.then) setTimeout(() => { const n = document.getElementById(a.then); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 30);
      } })),
      undoButtons(true),
    ]) : null,
  ]);
}

export function underHood(formula, html) {
  return el('details', { class: 'under-hood' }, [
    el('summary', { text: 'Under the hood: the formula' }),
    el('code', { class: 'formula', text: formula }),
    html ? el('div', { class: 'prose', html }) : null,
  ]);
}

// A fold-out with its own title (no formula line).
export function goDeeper(title, html) {
  return el('details', { class: 'under-hood' }, [el('summary', { text: title }), el('div', { class: 'prose', html })]);
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
// extra: { label, value } — a contribution not shown term by term (e.g. positions outside the lens).
export function dotExample(lhs, a, b, { aName = 'a', bName = 'b', decimals = 2, tail = '', extra = null } = {}) {
  const terms = a.map((x, i) => `<span class="term">(<b class="a">${fmt(x, decimals)}</b> × <b class="b">${fmt(b[i], decimals)}</b>)</span>`);
  const partial = a.reduce((acc, x, i) => acc + x * b[i], 0);
  const result = partial + (extra ? extra.value : 0);
  const extraHtml = extra && Math.abs(extra.value) >= 0.0005 ? `<span class="eq">+</span><span class="term"><span class="a">${esc(extra.label)}</span> <b>${fmt(extra.value, decimals)}</b></span>` : '';
  return el('div', { class: 'worked', html:
    `<span class="lhs">${esc(lhs)}</span><span class="eq">=</span>` +
    `<span class="a">${esc(aName)}</span> · <span class="b">${esc(bName)}</span><span class="eq">=</span>` +
    terms.join('<span class="eq">+</span>') + extraHtml +
    `<span class="eq">=</span><span class="result">${fmt(result, decimals)}</span>${tail}` });
}

export function sumExample(lhs, parts, { decimals = 2 } = {}) {
  const terms = parts.map(([label, v]) => `<span class="term"><span class="a">${esc(label)}</span> <b>${fmt(v, decimals)}</b></span>`);
  const result = parts.reduce((acc, [, v]) => acc + v, 0);
  return el('div', { class: 'worked', html:
    `<span class="lhs">${esc(lhs)}</span><span class="eq">=</span>${terms.join('<span class="eq">+</span>')}<span class="eq">=</span><span class="result">${fmt(result, decimals)}</span>` });
}

// Learning goal shown under the chapter dek, and a recap box for the end.
export function chapterGoal(active) {
  const ch = CHAPTERS.find((c) => c.href === active);
  if (!ch || !ch.goal) return;
  const dek = document.querySelector('.chapter-head .dek');
  if (!dek || document.querySelector('.chapter-goal')) return;
  dek.after(el('div', { class: 'chapter-goal' }, [
    el('p', { class: 'goal' }, [ch.bridge ? el('span', { class: 'bridge', text: ch.bridge + ' ' }) : null, el('strong', { text: 'After this chapter you can ' }), ch.goal]),
  ]));
}

export function recap(items) {
  return el('aside', { class: 'callout recap' }, [
    el('div', { class: 'label', text: 'What you saw' }),
    el('ul', {}, items.map((t) => el('li', { html: t }))),
  ]);
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

// "Compare with the untrained model" checkbox; state lives in sessionStorage so it follows the reader between chapters.
export function compareToggle(onchange) {
  let on = false;
  try { on = sessionStorage.getItem('tl:compare') === '1'; } catch {}
  const trained = (getExperiment().trainingHistory || []).length > 0 || getExperiment().handEdited;
  if (!trained) return labOnly(el('p', { class: 'fig-caption compare-toggle', text: 'Once you have trained the model (Chapter 5), a “compare with the untrained model” switch appears here.' }));
  return labOnly(el('label', { class: 'compare-toggle' }, [
    el('input', { type: 'checkbox', checked: on, onchange: (e) => { try { sessionStorage.setItem('tl:compare', e.target.checked ? '1' : '0'); } catch {} onchange(e.target.checked); } }),
    'Compare with the untrained model (▲▼ = moved by training or editing)',
  ]));
}
export function compareOn() { try { return sessionStorage.getItem('tl:compare') === '1'; } catch { return false; } }

export function tag(kind) {
  return el('span', { class: `tag ${kind}`, text: kind === 'stored' ? 'saved input' : 'recomputed' });
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

function applyMode() {
  document.body.classList.toggle('mode-lab', isLab());
  document.body.classList.toggle('mode-lesson', !isLab());
  document.querySelectorAll('.mode-switch button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'lab') === isLab()));
}

function updateUndoButtons() {
  document.querySelectorAll('[data-undo]').forEach((b) => { b.disabled = !canUndo(); });
  document.querySelectorAll('[data-redo]').forEach((b) => { b.disabled = !canRedo(); });
}

export function undoButtons(compact = false) {
  return el('span', { class: 'undo-group' }, [
    el('button', { class: compact ? 'ghost' : '', 'data-undo': '1', title: 'Undo the last change (⌘Z)', text: compact ? 'Undo' : '↶ Undo', disabled: !canUndo(), onclick: () => undo() }),
    el('button', { class: compact ? 'ghost' : '', 'data-redo': '1', title: 'Redo (⇧⌘Z)', text: compact ? 'Redo' : '↷ Redo', disabled: !canRedo(), onclick: () => redo() }),
  ]);
}

export function initPage(active) {
  setCurrentStep(active);
  resetGlossary();
  chapterGoal(active);
  const header = document.getElementById('nav');
  if (header) {
    header.replaceChildren(
      el('a', { class: 'brand', href: 'index.html', text: 'Transformer Lab' }),
      el('nav', {}, CHAPTERS.map((c) => el('a', { href: c.href, class: c.href === active ? 'active' : '', 'aria-current': c.href === active ? 'page' : null }, [
        el('span', { class: 'n', text: c.n }), c.label,
      ]))),
      // Compact chapter picker for narrow screens (the nav links hide).
      el('select', { class: 'nav-select', 'aria-label': 'Chapter', onchange: (e) => { location.href = e.target.value; } },
        CHAPTERS.map((c) => el('option', { value: c.href, text: `${c.n} · ${c.label}`, selected: c.href === active }))),
      el('span', { class: 'nav-sentence', id: 'nav-sentence' }),
      el('span', { class: 'nav-tools' }, [
        el('button', { class: 'ghost', title: 'Wipe everything this book saved in your browser and start from a clean state', text: 'Start over', onclick: () => {
          if (confirm('Start over?\n\nThis wipes everything the book saved in this browser: your text, the weights and training, played stages, quiz answers, bookmarks and preferences. It reloads with the default sentence.')) wipeAll();
        } }),
        undoButtons(true),
        el('span', { class: 'mode-switch', title: 'Lesson: follow the class. Lab: every table editable, all the extras.' }, [
          el('button', { dataset: { mode: 'lesson' }, text: 'Lesson', onclick: () => setMode('lesson') }),
          el('button', { dataset: { mode: 'lab' }, text: 'Lab', onclick: () => setMode('lab') }),
        ]),
      ]),
    );
  }
  applyMode();
  const updateSentence = () => {
    const s = document.getElementById('nav-sentence');
    if (s) s.textContent = `“${getExperiment().sentence}”`;
  };
  updateSentence();
  mountMinimap();
  // Cmd/Ctrl-Z undoes the last model change (Shift for redo), even from inside a cell.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !t.closest('table.matrix')));
    if (typing) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });
  onChange((event) => {
    updateSentence();
    updateMinimap();
    updateUndoButtons();
    if (event.changedKeys.includes('mode')) applyMode();
    if (event.quiet) return;
    if (event.affected.length || event.reset || event.external) showRecalculation(event);
  });
  mountLog();
}

export const labOnly = (node) => { if (node) node.classList.add('lab-only'); return node; };

// ---------------------------------------------------------------------------
// Chapter progress in the nav: one circle per chapter — empty, half (some
// stages played), full (all played), ringed when that chapter's quiz is done.
// ---------------------------------------------------------------------------
import { QUIZZES } from './quiz-data.js';

function chapterProgress(ch) {
  const s = getExperiment();
  const stages = STAGES.filter((st) => st.page === ch.href);
  const played = stages.filter((st) => s.progress[st.id] === 'done').length;
  const qs = QUIZZES[ch.href] || [];
  const answers = (s.quiz || {})[ch.href] || {};
  const right = qs.filter((q, i) => answers[i] === q.ok).length;
  return { stages: stages.length, played, quiz: qs.length, right };
}

function mountMinimap() {
  const header = document.getElementById('nav');
  if (!header) return;
  const wrap = el('span', { class: 'chapter-progress', role: 'group', 'aria-label': 'Progress by chapter' },
    CHAPTERS.filter((c) => c.n > 0).map((c) => el('a', { class: 'cp', href: c.href, dataset: { chapter: c.href } }, [el('span', { class: 'fill' })])));
  header.insertBefore(wrap, header.querySelector('.nav-sentence'));
  updateMinimap();
}

function updateMinimap() {
  document.querySelectorAll('.chapter-progress .cp').forEach((a) => {
    const ch = CHAPTERS.find((c) => c.href === a.dataset.chapter);
    const pr = chapterProgress(ch);
    const frac = pr.stages ? pr.played / pr.stages : 0;
    a.classList.toggle('some', frac > 0 && frac < 1);
    a.classList.toggle('all', pr.stages > 0 && frac >= 1);
    a.classList.toggle('quiz', pr.quiz > 0 && pr.right === pr.quiz);
    a.title = `Chapter ${ch.n} · ${ch.label}: ${pr.played} of ${pr.stages} stages played${pr.quiz ? `, quiz ${pr.right}/${pr.quiz}` : ''}`;
    a.setAttribute('aria-label', a.title);
    a.querySelector('.fill').style.height = `${Math.round(frac * 100)}%`;
  });
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
    title, matrix, rowLabels, colLabels, editable: editableOpt = false, onEdit, heat = 'diverging',
    decimals = 2, highlightRows = null, dimRows = null, cornerLabel = '', note = null, small = false,
    filled = null, hlRow = null, hlCol = null, hlCell = null, pulse = null,
    compare = null, // same-shaped matrix (e.g. the untrained model's): cells show how they moved
    rows: rowSubset = null, // original row indices to display (labels, highlights, edits keep original indices)
    shapeNote = null,
  } = opts;
  const allRows = Array.isArray(matrix[0]) ? matrix : [matrix];
  const shown = rowSubset || allRows.map((_, i) => i);
  const rows = shown.map((i) => allRows[i]);
  const editable = editableOpt && isLab(); // in Lesson mode every table is read-only
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
  rows.forEach((row, di) => {
    const r = shown[di]; // original index
    const cls = [highlightRows && highlightRows.has(r) ? 'hl' : '', dimRows && dimRows.has(r) ? 'dim' : '', hlRow === r ? 'hlrow' : ''].join(' ');
    const tr = el('tr', { class: cls });
    if (rowLabels || colLabels) tr.append(el('th', { text: rowLabels ? rowLabels[r] : '' }));
    row.forEach((v, c) => {
      const isBlank = filled && !filled(r, c);
      const isCell = hlCell && hlCell[0] === r && hlCell[1] === c;
      const isPulse = pulse && pulse[0] === r && pulse[1] === c;
      const td = el('td', {
        style: (isBlank ? '' : heatStyle(v, heat, maxAbs)) + `; --c:${c}`,
        class: [isBlank ? 'blank' : '', hlCol === c ? 'hlcol' : '', hlRow === r ? 'hlrow' : '', isCell ? 'hlcell' : '', isPulse ? 'pulse' : '', v === -Infinity && !isBlank ? 'masked' : ''].join(' '),
        dataset: { r, c },
      });
      if (isBlank) {
        td.textContent = '·';
      } else if (editable) {
        td.append(el('input', {
          type: 'text', inputmode: 'decimal', value: fmt(v, decimals), 'aria-label': `${title || 'cell'} ${r},${c}`,
          'aria-description': `${title || 'cell'}, row ${rowLabels ? rowLabels[r] : r}, column ${colLabels ? colLabels[c] : c}`,
          onchange: (e) => {
            const parsed = Number(e.target.value.replace(',', '.'));
            if (!Number.isFinite(parsed)) { e.target.value = fmt(v, decimals); return; }
            onEdit && onEdit(r, c, parsed);
          },
          onfocus: (e) => e.target.select(),
          onkeydown: (e) => matrixKeys(e, r, c, v, decimals, onEdit),
          onpointerdown: (e) => dragValue(e, r, c, v, decimals, onEdit),
        }));
      } else {
        td.textContent = fmt(v, decimals);
      }
      if (compare && !isBlank && compare[r] && typeof compare[r][c] === 'number') {
        const delta = v - compare[r][c];
        if (Math.abs(delta) >= 0.005) {
          td.classList.add(delta > 0 ? 'moved-up' : 'moved-down');
          td.title = `untrained: ${fmt(compare[r][c], decimals)} → now ${fmt(v, decimals)} (${delta > 0 ? '+' : ''}${fmt(delta, decimals)})`;
          td.append(el('span', { class: 'delta', text: delta > 0 ? '▲' : '▼' }));
        } else {
          td.classList.add('unmoved');
          td.title = `unchanged since untrained (${fmt(compare[r][c], decimals)})`;
        }
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);

  const wrap = el('figure', { class: 'matrix-wrap' });
  if (title) wrap.append(el('figcaption', {}, [
    el('span', { class: 'mtitle', text: title }),
    el('span', { class: 'shape', text: shapeNote || (rowSubset ? `${allRows.length} × ${allRows[0].length}, showing ${rows.length} rows` : shapeOf(rows)) }),
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

// Drag a cell sideways to scrub its value (0.01 per pixel; Shift: 0.1).
// Saves on every frame so downstream stages go idle live; a plain click
// still focuses the input for typing.
function dragValue(e, r, c, original, decimals, onEdit) {
  if (e.button !== 0 || !onEdit) return;
  const input = e.target;
  const startX = e.clientX;
  let dragging = false;
  let value = Number(input.value.replace(',', '.'));
  if (!Number.isFinite(value)) value = original;
  let pending = false;
  let latest = value;
  const move = (ev) => {
    const dx = ev.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < 4) return;
      dragging = true;
      input.blur();
      document.body.classList.add('scrubbing');
      setCoalescing(`drag:${r},${c}:${Date.now()}`);
    }
    latest = Math.round((value + dx * (ev.shiftKey ? 0.1 : 0.01)) * 100) / 100;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; onEdit(r, c, latest); }, 16);
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.body.classList.remove('scrubbing');
    if (dragging) setTimeout(() => {
      setCoalescing(null);
      const n = document.activeElement; if (n && n.tagName === 'INPUT' && n.closest('table.matrix')) n.blur();
    }, 40);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
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

// One polite announcement per event for assistive tech (the visual log itself is not live).
function announce(text) {
  const node = document.getElementById('announce');
  if (!node) return;
  node.textContent = '';
  setTimeout(() => { node.textContent = text; }, 30);
}

function mountLog() {
  logEl = document.getElementById('recalc-log');
  if (!logEl) return;
  logEl.hidden = true; // appears on the first change
  if (matchMedia('(max-width: 760px)').matches) logEl.classList.add('collapsed');
  logEl.replaceChildren(
    el('header', {}, [
      el('strong', { text: 'What just changed' }),
      el('span', {}, [
        el('button', { class: 'ghost', text: 'clear', onclick: () => list().replaceChildren() }),
        el('button', { class: 'ghost toggle', text: logEl.classList.contains('collapsed') ? 'show' : 'hide', onclick: (e) => { logEl.classList.toggle('collapsed'); e.target.textContent = logEl.classList.contains('collapsed') ? 'show' : 'hide'; } }),
      ]),
    ]),
    el('ol', { class: 'entries' }),
  );
}

function list() { return logEl.querySelector('.entries'); }

function describeChange(event) {
  if (event.shared) return 'Loaded an experiment from a shared link';
  if (event.undo) return 'Undo — the previous version of the model is back';
  if (event.redo) return 'Redo';
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
  logEl.hidden = false;
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
  announce(`${describeChange(event)}. ${event.affected.length} stage${event.affected.length === 1 ? '' : 's'} waiting to be played.`);
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

export function bindRender(renderPage, { quietKeys = [] } = {}) {
  const render = () => { resetGlossary(); renderPage(); };
  render();
  let pending = false;
  const always = ['mode', ...quietKeys]; // a mode switch re-renders every page in place
  onChange((event) => {
    if (event.quiet && !event.changedKeys.some((k) => always.includes(k))) return;
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

// ---------------------------------------------------------------------------
// Flow diagram of the whole machine, generated from STAGES: nodes on a
// baseline in pipeline order, straight links for "previous stage" inputs,
// arcs for longer-range ones (residual paths, Kᵀ, V), chapter brackets below.
// Filled nodes have been played; `justDone` nodes pulse.
// ---------------------------------------------------------------------------

export function flowDiagram({ progress = {}, justDone = new Set(), chapters = [] } = {}) {
  const n = STAGES.length;
  const gap = 54, padL = 30, padR = 30, W = padL + padR + gap * (n - 1), H = 205, y = 100;
  const x = (i) => padL + i * gap;
  const idx = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'flow');
  const add = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  const defs = add('defs', {});
  const marker = add('marker', { id: 'flow-head', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs);
  add('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'currentColor' }, marker);

  // chapter brackets
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || STAGES[i].page !== STAGES[start].page) {
      const ch = chapters.find((c) => c.href === STAGES[start].page);
      const x1 = x(start) - 14, x2 = x(i - 1) + 14;
      add('path', { d: `M${x1},${y + 44} v6 h${x2 - x1} v-6`, class: 'bracket' });
      const t = add('text', { x: (x1 + x2) / 2, y: y + 64, 'text-anchor': 'middle', class: 'chapter' });
      t.textContent = ch ? `${ch.n} · ${ch.label}` : '';
      start = i;
    }
  }
  // links
  STAGES.forEach((stage, i) => {
    for (const dep of stage.deps) {
      const j = idx[dep];
      if (j === i - 1) {
        add('line', { x1: x(j) + 8, x2: x(i) - 9, y1: y, y2: y, class: 'link', 'marker-end': 'url(#flow-head)' });
      } else {
        const lift = 18 + (i - j) * 9;
        add('path', { d: `M${x(j)},${y - 8} Q${(x(j) + x(i)) / 2},${y - lift} ${x(i)},${y - 9}`, class: 'link arc', 'marker-end': 'url(#flow-head)' });
      }
    }
  });
  // nodes
  STAGES.forEach((stage, i) => {
    const done = progress[stage.id] === 'done';
    const g = add('g', { class: `node ${done ? 'done' : ''} ${justDone.has(stage.id) ? 'just' : ''}`, transform: `translate(${x(i)},${y})` });
    const a = add('a', { href: `${stage.page}#${stage.id}` }, g);
    add('circle', { r: 8 }, a);
    add('title', {}, a).textContent = `${stage.label}${done ? ' — played' : ' — waiting for play'}`;
    const label = add('text', { x: 0, y: 22, 'text-anchor': 'middle', class: 'lbl' }, a);
    label.textContent = stage.label.replace('Input X (with positions)', 'Input X').replace('Attention scores', 'Scores').replace('Attention output Z', 'Output Z').replace('Attention shares', 'Shares').replace('Probabilities', 'Probs').replace('K flipped (Kᵀ)', 'Kᵀ').replace('Thinking (expanded)', 'Think ×2').replace('Thinking (result)', 'Think').replace(/^(Questions|Badges|Notes) /, '');
    if (stage.inputs.length) {
      const t = add('text', { x: 0, y: 34, 'text-anchor': 'middle', class: 'inp' }, a);
      t.textContent = stage.inputs.map((k) => k.replace('weights.', '').replace('config.', '').replace('embedding', 'E').replace('positional', 'P')).join(' ');
    }
  });
  return svg;
}


// ---------------------------------------------------------------------------
// The lens: long texts are computed in full, but tables show a window of
// positions [start, start+size). Pages slice their per-position matrices
// with these helpers; the lens bar lets the reader slide the window.
// ---------------------------------------------------------------------------

export function windowOf(n) {
  const v = getExperiment().view || { start: 0, size: 12 };
  const size = Math.min(v.size || 12, n);
  const start = Math.max(0, Math.min(v.start || 0, n - size));
  const rows = Array.from({ length: size }, (_, i) => start + i);
  return { start, end: start + size, size, n, rows, partial: n > size };
}
export const sliceRows = (m, win) => win.rows.map((i) => m[i]);
export const sliceBoth = (m, win) => win.rows.map((i) => win.rows.map((j) => m[i][j]));
export const sliceCols = (m, win) => m.map((r) => win.rows.map((j) => r[j]));
export function tokenLabelsWin(tokens, win) { return win.rows.map((i) => `${tokens[i]} ${i}`); }

// The lens bar: a strip of the whole text with the visible window marked.
// Click or drag on the strip to move the window; chevrons page through it.
export function lensBar(tokens) {
  const n = tokens.length;
  const win = windowOf(n);
  if (!win.partial) return null;
  const v = getExperiment().view;
  const strip = el('div', { class: 'lens-strip', title: 'Drag to choose which positions the tables show' }, tokens.map((t, i) => el('span', {
    class: `cell ${i >= win.start && i < win.end ? 'in' : ''}`, title: `${i}: ${t}`,
  })));
  const window_ = el('div', { class: 'lens-window', style: `left:${(win.start / n) * 100}%; width:${(win.size / n) * 100}%` });
  strip.append(window_);
  const pick = (clientX) => {
    const r = strip.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setView({ start: Math.round(frac * n - win.size / 2) });
  };
  strip.addEventListener('pointerdown', (e) => {
    pick(e.clientX);
    const move = (ev) => pick(ev.clientX);
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  const preview = el('div', { class: 'lens-preview' }, [
    win.start > 0 ? el('span', { class: 'dim', text: `… ${tokens.slice(Math.max(0, win.start - 3), win.start).join(' ')} ` }) : null,
    el('span', { class: 'in', text: tokens.slice(win.start, win.end).join(' ') }),
    win.end < n ? el('span', { class: 'dim', text: ` ${tokens.slice(win.end, win.end + 3).join(' ')} …` }) : null,
  ]);
  return el('div', { class: 'lens', role: 'group', 'aria-label': 'Lens' }, [
    el('div', { class: 'lens-head' }, [
      el('span', { class: 'lens-label', text: 'Lens' }),
      el('span', { class: 'lens-range', text: `the tables below show positions ${win.start}–${win.end - 1} of your ${n} tokens` }),
      el('span', { class: 'lens-ctl' }, [
        el('button', { class: 'pbtn', title: 'Earlier positions', 'aria-label': 'Earlier positions', text: '‹', disabled: win.start === 0, onclick: () => setView({ start: win.start - win.size }) }),
        el('button', { class: 'pbtn', title: 'Later positions', 'aria-label': 'Later positions', text: '›', disabled: win.end >= n, onclick: () => setView({ start: win.start + win.size }) }),
        labOnly(el('select', { 'aria-label': 'Window size', onchange: (e) => setView({ size: Number(e.target.value) }) }, LENS_SIZES.map((k) => el('option', { value: k, text: `${k} positions`, selected: k === v.size })))),
      ]),
    ]),
    strip,
    preview,
    el('p', { class: 'fig-caption', style: 'margin:.35rem 0 0', text: 'The maths runs on the whole text; this only chooses which rows you look at. Drag the strip or use ‹ › to move.' }),
  ]);
}


// Pieces of text as chips, grouped by word: a piece starting with ▁ opens a
// new group; groups alternate hue so “▁tok · en · ization” reads as one word.
export function pieceChips(tokens, { marker = '▁' } = {}) {
  let group = -1;
  return el('span', { class: 'pieces' }, tokens.map((t) => {
    if (t.startsWith(marker)) group++;
    return el('span', { class: `piece g${Math.max(0, group) % 4}`, title: t.startsWith(marker) ? 'start of a word' : 'continues the word' }, [
      t.startsWith(marker) ? el('span', { class: 'ws', text: marker }) : null, t.replace(marker, ''),
    ]);
  }));
}
