// js/player.js
// Step-through players, in the spirit of nan.fyi: a stage sits idle until the
// reader presses play, then reveals its result one small step at a time with
// a caption explaining that step. Nothing plays by itself.
//
// A scene describes what to show:  { total, frame(k) -> { body, caption, worked } }
// where k = 0 is the idle state and k = total is the finished result.

import { el } from './ui.js';
import { getExperiment, onChange, setAnimation, setProgress, clearProgress, isLab } from './state.js';

export const SPEEDS = { slow: 2400, normal: 1300, fast: 500 };

const players = new Map(); // id -> { step, playing, timer, scene, onFinish }

// An upstream input changed: affected players go back to idle. Nothing replays by itself.
onChange((event) => {
  if (event.quiet) return;
  for (const id of event.affected) {
    const p = players.get(id);
    if (!p) continue;
    p.playing = false;
    clearTimeout(p.timer);
    p.onFinish = null;
    p.step = 0;
  }
});

function speedMs() {
  return SPEEDS[getExperiment().animation.speed] || SPEEDS.normal;
}

// key: optional string; when it changes the player goes back to idle (for
// scenes driven by session inputs such as a prompt). track: persist "done".
export function player({ id, scene, label, key = null, track = true }) {
  const done = track && getExperiment().progress[id] === 'done';
  let p = players.get(id);
  if (!p) {
    p = { step: done ? scene.total : 0, playing: false, timer: null, key, track };
    players.set(id, p);
  } else if (key !== p.key) {
    clearTimeout(p.timer);
    p.playing = false;
    p.onFinish = null;
    p.step = 0;
    p.key = key;
  }
  p.track = track;
  p.scene = scene;
  p.total = scene.total;
  p.label = label;
  if (p.step > scene.total) p.step = scene.total;
  const root = el('div', { class: 'card player', dataset: { player: id, stage: id }, id, tabindex: '0',
    title: 'Click, then: Space play/pause · ←/→ step · Home/End' });
  // Keyboard: works once anything inside the player has focus (a click does it).
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="text"], textarea, select')) return;
    if (e.key === ' ' && e.target.tagName === 'BUTTON') return; // the button's own click handles it
    const p = players.get(id);
    if (!p) return;
    const map = { ' ': () => (p.playing ? pause(id) : play(id)), ArrowRight: () => { pause(id); setStep(id, p.step + 1); },
      ArrowLeft: () => { pause(id); setStep(id, p.step - 1); }, Home: () => { pause(id); setStep(id, 0); }, End: () => { pause(id); setStep(id, p.total); } };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  });
  renderInto(root, id);
  return root;
}

function renderInto(root, id) {
  const p = players.get(id);
  const frame = p.scene.frame(p.step);
  root.classList.toggle('idle', p.step === 0);
  root.classList.toggle('done', p.step === p.total);
  root.classList.toggle('playing', p.playing);
  const overlay = root.querySelector(':scope > .hl-layer') || el('div', { class: 'hl-layer' });
  root.replaceChildren(
    el('div', { class: 'player-stage' }, frame.body),
    el('div', { class: 'player-caption fresh' }, [
      el('div', { class: 'caption-text', html: frame.caption || '' }),
      frame.worked || null,
    ]),
    toolbar(id),
    overlay,
  );
  root.style.position = 'relative';
  const animate = p.animateNext;
  p.animateNext = false;
  // A newer render supersedes any animation this one scheduled.
  const gen = (p.gen = (p.gen || 0) + 1);
  setTimeout(() => {
    if (p.gen !== gen || !root.isConnected) return;
    keepCurrentRowInView(root);
    moveHighlights(root, overlay);
    if (animate) {
      animateStep(root, speedMs());
      if (frame.animate) frame.animate(root, speedMs());
    }
  }, 0);
  bindHover(root, p);
  bindCellRefs(root);
}

// Captions may contain <a class="cellref" data-cell="r,c">: clicking flashes
// that cell of the result table (and the first table for single-table scenes).
function bindCellRefs(root) {
  root.querySelectorAll('.player-caption .cellref').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const [r, c] = a.dataset.cell.split(',').map(Number);
      const tables = root.querySelectorAll('.player-stage table.matrix');
      const table = tables[tables.length - 1];
      const td = table && table.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
      if (!td) return;
      td.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      td.classList.remove('flash');
      void td.offsetWidth;
      td.classList.add('flash');
    });
  });
}

// Helper for scene-specific animations: a ghost copy of `from` flies to `to`.
export function flyGhost(root, from, to, { duration = 450, text = null, onLand = null, hideTarget = true, className = '' } = {}) {
  if (!from || !to || !from.isConnected || !to.isConnected) return; // superseded by a newer render
  if (reducedMotion()) { onLand && onLand(); return; }
  const a = layoutRect(from, root);
  const b = layoutRect(to, root);
  const ghost = el('div', { class: `ghost-fly ${className}`, text: text ?? from.textContent });
  const cs = getComputedStyle(from);
  ghost.style.cssText = `left:${a.left}px; top:${a.top}px; min-width:${a.width}px; height:${a.height}px; font:${cs.font}; color:${cs.color}; background:${cs.backgroundColor}; border-radius:${cs.borderRadius}; padding:${cs.padding}; box-sizing:border-box`;
  root.style.position = 'relative';
  root.append(ghost);
  if (hideTarget) to.style.visibility = 'hidden';
  const anim = ghost.animate([
    { transform: 'translate(0,0)', opacity: 1 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px)`, opacity: 0.9 },
  ], { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    ghost.remove();
    if (to.isConnected) { to.style.visibility = ''; to.classList.remove('pulse'); void to.offsetWidth; to.classList.add('pulse'); }
    onLand && onLand();
    if (root.isConnected) moveHighlights(root);
  };
  anim.onfinish = land;
  // Safety net: a hidden tab pauses animations; never leave the target hidden.
  setTimeout(land, duration + 800);
  return ghost;
}

// Tall tables scroll inside their container; keep the row being computed visible.
function keepCurrentRowInView(root) {
  root.querySelectorAll('.player-stage .scroll').forEach((box) => {
    const row = box.querySelector('tr.hlrow') || box.querySelector('td.hlcell')?.parentElement;
    const col = box.querySelector('td.hlcol, td.hlcell');
    if (row && box.scrollHeight > box.clientHeight) {
      const y = row.offsetTop;
      if (y < box.scrollTop + 30 || y + row.offsetHeight > box.scrollTop + box.clientHeight - 10) box.scrollTop = Math.max(0, y - box.clientHeight / 2);
    }
    if (col && box.scrollWidth > box.clientWidth) {
      const x = col.offsetLeft;
      if (x < box.scrollLeft + 60 || x + col.offsetWidth > box.scrollLeft + box.clientWidth - 10) box.scrollLeft = Math.max(0, x - box.clientWidth / 2);
    }
  });
}

// ---------------------------------------------------------------------------
// Sliding highlights: one persistent box per role (row of table t, column of
// table t, target cell) that transitions to its new place each step instead
// of being redrawn — the "cursor" glides from cell to cell.
// ---------------------------------------------------------------------------

// Layout position of a node relative to the player root, ignoring CSS
// transforms (pop/scale animations would otherwise skew measurements) and
// accounting for scrolled containers in between.
function layoutRect(node, root) {
  let left = 0, top = 0, n = node;
  while (n && n !== root) {
    left += n.offsetLeft; top += n.offsetTop;
    const parent = n.offsetParent;
    let a = n.parentElement;
    while (a && a !== parent && a !== root) { left -= a.scrollLeft; top -= a.scrollTop; a = a.parentElement; }
    if (a === root && parent !== root) { /* root reached through a non-positioned chain */ }
    n = parent;
  }
  return { left, top, width: node.offsetWidth, height: node.offsetHeight };
}

function unionRect(cells, root) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const c of cells) {
    const q = layoutRect(c, root);
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.left + q.width); b = Math.max(b, q.top + q.height);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}

export function moveHighlights(root, overlay = root.querySelector(':scope > .hl-layer')) {
  if (!overlay) return;
  const wanted = new Map(); // name -> { rect, kind }
  root.querySelectorAll('.player-stage table.matrix').forEach((table, t) => {
    const rows = [...table.querySelectorAll('td.hlrow')];
    const cols = [...table.querySelectorAll('td.hlcol')];
    const cell = table.querySelector('td.hlcell');
    if (rows.length) wanted.set(`row-${t}`, { rect: unionRect(rows, root), kind: 'src' });
    if (cols.length) wanted.set(`col-${t}`, { rect: unionRect(cols, root), kind: 'src' });
    if (cell) wanted.set(`cell-${t}`, { rect: unionRect([cell], root), kind: 'target' });
  });
  // Non-table highlights: the tokenizer's reading head and the current chip
  // (only once the chip has landed — it is hidden while its ghost flies).
  const scan = root.querySelector('.sentence-scan .cur');
  if (scan) wanted.set('scan', { rect: unionRect([scan], root), kind: 'scan' });
  const chip = root.querySelector('.chips .chip.pulse');
  if (chip && chip.style.visibility !== 'hidden') wanted.set('chip', { rect: unionRect([chip], root), kind: 'chip' });
  for (const box of overlay.children) if (!wanted.has(box.dataset.name)) box.classList.add('off');
  for (const [name, { rect, kind }] of wanted) {
    let box = overlay.querySelector(`[data-name="${name}"]`);
    const fresh = !box;
    if (fresh) { box = el('div', { class: `hl-box ${kind}`, dataset: { name } }); overlay.append(box); }
    const place = () => {
      box.style.left = `${rect.left - 2}px`;
      box.style.top = `${rect.top - 2}px`;
      box.style.width = `${rect.width + 4}px`;
      box.style.height = `${rect.height + 4}px`;
    };
    if (fresh) { box.classList.add('off'); place(); void box.offsetWidth; }
    box.classList.remove('off');
    place();
  }
}

// Numbers count up from 0 to their value as they land.
function countUp(td, ms) {
  const finalText = td.textContent;
  const value = Number(finalText.replace('−', '-'));
  if (!Number.isFinite(value) || reducedMotion()) return;
  const decimals = (finalText.split('.')[1] || '').length;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    td.textContent = (value * eased).toFixed(decimals);
    if (t < 1 && td.isConnected) requestAnimationFrame(tick); else td.textContent = finalText;
  };
  requestAnimationFrame(tick);
}

// Hover a computed cell: its source row/column light up and its arithmetic
// appears, whatever step the player is on.
function bindHover(root, p) {
  if (!p.scene.hover) return;
  const tables = [...root.querySelectorAll('.player-stage table.matrix')];
  if (tables.length < 2) return;
  const target = tables[tables.length - 1];
  const sources = tables.slice(0, -1);
  let tip = null;
  const clear = () => {
    root.querySelectorAll('.hov, .hov-cell').forEach((n) => n.classList.remove('hov', 'hov-cell'));
    if (tip) { tip.remove(); tip = null; }
  };
  target.querySelectorAll('td[data-r]').forEach((td) => {
    if (td.classList.contains('blank')) return;
    td.addEventListener('mouseenter', () => {
      clear();
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const info = p.scene.hover(r, c);
      if (!info) return;
      td.classList.add('hov-cell');
      for (const src of info.sources || []) {
        const t = sources[src.table];
        if (!t) continue;
        t.querySelectorAll('td[data-r]').forEach((cell) => {
          const okRow = src.row == null || Number(cell.dataset.r) === src.row;
          const okCol = src.col == null || Number(cell.dataset.c) === src.col;
          if (okRow && okCol) cell.classList.add('hov');
        });
      }
      if (info.worked) {
        tip = el('div', { class: 'hover-tip' }, info.worked);
        root.append(tip);
        const rr = root.getBoundingClientRect();
        const cr = td.getBoundingClientRect();
        tip.style.top = `${cr.bottom - rr.top + 6}px`;
        const left = Math.max(8, Math.min(cr.left - rr.left, rr.width - tip.offsetWidth - 8));
        tip.style.left = `${left}px`;
      }
    });
    td.addEventListener('mouseleave', clear);
  });
}

// ---------------------------------------------------------------------------
// Step animation: the highlighted source cells fly into the cell(s) they
// produce. Works from the rendered DOM alone, so every scene gets it:
//   • a single highlighted target cell  ← every highlighted row/column cell
//   • a highlighted target row          ← same column of each highlighted input row
//   • a highlighted target column       ← input row, cell c landing on row c
// ---------------------------------------------------------------------------

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateStep(root, stepMs) {
  if (reducedMotion()) return;
  const stage = root.querySelector('.player-stage');
  const tables = [...stage.querySelectorAll('table.matrix')];
  if (tables.length < 2) return;
  const target = tables[tables.length - 1];
  const sources = tables.slice(0, -1);
  const pairs = []; // [sourceTd, targetTd]
  const cell = target.querySelector('td.hlcell');
  if (cell) {
    for (const t of sources) for (const td of t.querySelectorAll('td.hlrow, td.hlcol')) pairs.push([td, cell]);
  } else if (target.querySelector('td.hlrow')) {
    const row = [...target.querySelectorAll('td.hlrow')];
    for (const t of sources) for (const td of t.querySelectorAll('td.hlrow')) {
      const to = row.find((x) => x.dataset.c === td.dataset.c);
      if (to) pairs.push([td, to]);
    }
  } else if (target.querySelector('td.hlcol')) {
    const col = [...target.querySelectorAll('td.hlcol')];
    for (const t of sources) for (const td of t.querySelectorAll('td.hlrow')) {
      const to = col.find((x) => x.dataset.r === td.dataset.c);
      if (to) pairs.push([td, to]);
    }
  }
  if (!pairs.length || !root.isConnected) return;

  const duration = Math.max(180, Math.min(700, stepMs * 0.38));
  const stagger = Math.min(60, (stepMs * 0.25) / pairs.length);
  const targets = new Set(pairs.map(([, to]) => to));
  for (const to of targets) { to.classList.remove('pulse'); to.style.visibility = 'hidden'; }
  root.style.position = 'relative';
  const ghosts = [];
  pairs.forEach(([from, to], i) => {
    const a = layoutRect(from, root);
    const b = layoutRect(to, root);
    const ghost = el('div', { class: 'ghost-cell', text: from.textContent });
    const cs = getComputedStyle(from);
    ghost.style.cssText = `left:${a.left}px; top:${a.top}px; width:${a.width}px; height:${a.height}px; background:${cs.backgroundColor}; font-size:${cs.fontSize}`;
    root.append(ghost);
    ghosts.push(ghost);
    ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(.8)`, opacity: 0.15 },
    ], { duration, delay: i * stagger, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  });
  setTimeout(() => {
    for (const g of ghosts) g.remove();
    for (const to of targets) {
      if (!to.isConnected) continue;
      to.style.visibility = '';
      void to.offsetWidth;
      to.classList.add('pulse');
      countUp(to, Math.max(220, stepMs * 0.3));
    }
  }, duration + stagger * (pairs.length - 1));
}

function refresh(id) {
  const root = document.querySelector(`[data-player="${CSS.escape(id)}"]`);
  if (root) renderInto(root, id);
}

function icon(name) {
  const paths = {
    start: '<path d="M4 3h2v10H4zM14 3 7 8l7 5z"/>',
    prev: '<path d="M11 3 4 8l7 5z"/>',
    play: '<path d="M4 2.5 13.5 8 4 13.5z"/>',
    pause: '<path d="M4 3h3v10H4zM9 3h3v10H9z"/>',
    next: '<path d="M5 3l7 5-7 5z"/>',
    end: '<path d="M10 3h2v10h-2zM2 3l7 5-7 5z"/>',
  };
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${paths[name]}</svg>`;
}

function toolbar(id) {
  const p = players.get(id);
  const atStart = p.step === 0;
  const atEnd = p.step === p.total;
  const speed = getExperiment().animation.speed || 'normal';
  const btn = (name, title, onclick, disabled = false) => el('button', { class: 'pbtn', title, 'aria-label': title, html: icon(name), onclick, disabled });
  const scrub = el('input', { type: 'range', min: 0, max: p.total, value: p.step, class: 'scrub', 'aria-label': 'step',
    oninput: (e) => { pause(id); setStep(id, Number(e.target.value)); } });
  const lab = isLab();
  return el('div', { class: 'player-bar' }, [
    lab ? btn('start', 'Back to start', () => { pause(id); setStep(id, 0); }, atStart) : null,
    lab ? btn('prev', 'Previous step', () => { pause(id); setStep(id, p.step - 1); }, atStart) : null,
    p.playing
      ? btn('pause', 'Pause', () => pause(id))
      : el('button', { class: 'pbtn play-main', title: atEnd ? 'Play again' : 'Play', html: `${icon('play')}<span>${atEnd ? 'Play again' : p.step ? 'Continue' : 'Play'}</span>`, onclick: () => play(id) }),
    btn('next', 'Next step', () => { pause(id); setStep(id, p.step + 1); }, atEnd),
    lab ? btn('end', 'Skip to the end', () => { pause(id); setStep(id, p.total); }, atEnd) : null,
    el('span', { class: 'counter', text: `${p.step} / ${p.total}` }),
    scrub,
    lab ? el('select', { class: 'speed', 'aria-label': 'Speed', onchange: (e) => { setAnimation({ speed: e.target.value }); for (const other of players.keys()) refresh(other); } },
      Object.keys(SPEEDS).map((k) => el('option', { value: k, text: k, selected: k === speed }))) : null,
  ]);
}

export function setStep(id, step) {
  const p = players.get(id);
  if (!p) return;
  const next = Math.max(0, Math.min(p.total, step));
  p.animateNext = next === p.step + 1;
  p.step = next;
  if (p.track && p.step === p.total && getExperiment().progress[id] !== 'done') {
    setProgress(id, 'done');
    updateChapterCount();
  }
  refresh(id);
}

function updateChapterCount() {
  const node = document.querySelector('.chapter-controls [data-count]');
  if (!node) return;
  const ids = node.dataset.count.split(',');
  const s = getExperiment();
  node.textContent = `${ids.filter((id) => s.progress[id] === 'done').length} of ${ids.length} stages played`;
}

export function play(id) {
  const p = players.get(id);
  if (!p) return;
  if (p.step >= p.total) p.step = 0;
  p.playing = true;
  refresh(id);
  const tick = () => {
    if (!p.playing) return;
    setStep(id, p.step + 1);
    if (p.step >= p.total) {
      p.playing = false;
      refresh(id);
      if (p.onFinish) { const f = p.onFinish; p.onFinish = null; f(); }
      return;
    }
    p.timer = setTimeout(tick, speedMs());
  };
  p.timer = setTimeout(tick, speedMs() * 0.6);
}

export function pause(id) {
  const p = players.get(id);
  if (!p) return;
  p.playing = false;
  clearTimeout(p.timer);
  p.onFinish = null;
  refresh(id);
}

export function pauseAll() {
  for (const id of players.keys()) pause(id);
}

export function isPlaying() {
  for (const p of players.values()) if (p.playing) return true;
  return false;
}

// Play a list of stages one after another, scrolling each into view.
export function playSequence(ids) {
  pauseAll();
  const queue = ids.filter((id) => players.has(id));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    const p = players.get(id);
    const root = document.querySelector(`[data-player="${CSS.escape(id)}"]`);
    if (root) root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    p.step = 0;
    p.onFinish = next;
    play(id);
  };
  next();
}

export function resetSequence(ids) {
  pauseAll();
  for (const id of ids) { const p = players.get(id); if (p) p.step = 0; }
  clearProgress(ids);
  for (const id of ids) refresh(id);
  updateChapterCount();
}

export function finishSequence(ids) {
  pauseAll();
  for (const id of ids) setStep(id, players.get(id)?.total ?? 0);
}

// Chapter-level controls placed at the top of a page.
export function chapterControls(ids) {
  const s = getExperiment();
  const done = ids.filter((id) => s.progress[id] === 'done').length;
  const speed = s.animation.speed || 'normal';
  return el('div', { class: 'chapter-controls' }, [
    el('button', { class: 'primary', html: `${icon('play')} Play the whole chapter`, title: 'Plays every stage on this page in order', onclick: () => playSequence(ids) }),
    el('button', { html: `${icon('end')} Skip the animations`, title: 'Show every stage finished', onclick: () => finishSequence(ids) }),
    el('button', { class: 'ghost', html: `${icon('start')} Replay from scratch`, title: 'Put every stage on this page back to its start', onclick: () => resetSequence(ids) }),
    el('label', { class: 'inline', style: 'gap:.35rem' }, ['Speed', el('select', { 'aria-label': 'Playback speed', onchange: (e) => { setAnimation({ speed: e.target.value }); for (const id of players.keys()) refresh(id); } },
      Object.keys(SPEEDS).map((k) => el('option', { value: k, text: k, selected: k === speed })))]),
    el('span', { class: 'fig-caption', style: 'margin:0', dataset: { count: ids.join(',') }, text: `${done} of ${ids.length} stages played` }),
  ]);
}

// ---------------------------------------------------------------------------
// Group controls: one toolbar drives several players in lockstep (used for
// the fresh-vs-trained comparison).
// ---------------------------------------------------------------------------

const groups = new Map(); // key -> { playing, timer }

export function groupControls(ids, { label = 'Play both together' } = {}) {
  const key = ids.join('+');
  if (!groups.has(key)) groups.set(key, { playing: false, timer: null });
  const g = groups.get(key);
  const live = () => ids.map((id) => players.get(id)).filter(Boolean);
  const maxTotal = () => Math.max(0, ...live().map((p) => p.total));
  const allAtEnd = () => live().every((p) => p.step >= p.total);
  const allAtStart = () => live().every((p) => p.step === 0);
  const rerender = () => { const bar = document.querySelector(`[data-group="${CSS.escape(key)}"]`); if (bar) bar.replaceWith(groupControls(ids, { label })); };
  const stepAll = (delta) => { for (const p of live()) setStep(idOf(p), p.step + delta); rerender(); };
  const idOf = (p) => ids.find((id) => players.get(id) === p);
  const stop = () => { g.playing = false; clearTimeout(g.timer); rerender(); };
  const start = () => {
    pauseAll();
    if (allAtEnd()) for (const p of live()) setStep(idOf(p), 0);
    g.playing = true;
    rerender();
    const tick = () => {
      if (!g.playing) return;
      stepAll(1);
      if (allAtEnd()) { g.playing = false; rerender(); return; }
      g.timer = setTimeout(tick, speedMs());
    };
    g.timer = setTimeout(tick, speedMs() * 0.6);
  };
  const btn = (name, title, onclick, disabled = false) => el('button', { class: 'pbtn', title, 'aria-label': title, html: icon(name), onclick, disabled });
  const steps = live().map((p) => p.step);
  return el('div', { class: 'player-bar group-bar', dataset: { group: key } }, [
    el('span', { class: 'group-label', text: label }),
    btn('start', 'Both back to start', () => { stop(); for (const p of live()) setStep(idOf(p), 0); rerender(); }, allAtStart()),
    btn('prev', 'Both one step back', () => { stop(); stepAll(-1); }, allAtStart()),
    g.playing ? btn('pause', 'Pause', stop) : btn('play', allAtEnd() ? 'Play both again' : 'Play both', start),
    btn('next', 'Both one step forward', () => { stop(); stepAll(1); }, allAtEnd()),
    btn('end', 'Both to the end', () => { stop(); for (const p of live()) setStep(idOf(p), p.total); rerender(); }, allAtEnd()),
    el('span', { class: 'counter', text: `${Math.min(...steps, maxTotal())} / ${maxTotal()}` }),
  ]);
}
