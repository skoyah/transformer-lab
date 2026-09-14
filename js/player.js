// js/player.js
// Step-through players, in the spirit of nan.fyi: a stage sits idle until the
// reader presses play, then reveals its result one small step at a time with
// a caption explaining that step. Nothing plays by itself.
//
// A scene describes what to show:  { total, frame(k) -> { body, caption, worked } }
// where k = 0 is the idle state and k = total is the finished result.

import { el } from './ui.js';
import { getExperiment, onChange, setAnimation, setProgress, clearProgress } from './state.js';

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
  const root = el('div', { class: 'card player', dataset: { player: id, stage: id }, id });
  renderInto(root, id);
  return root;
}

function renderInto(root, id) {
  const p = players.get(id);
  const frame = p.scene.frame(p.step);
  root.classList.toggle('idle', p.step === 0);
  root.classList.toggle('done', p.step === p.total);
  root.classList.toggle('playing', p.playing);
  root.replaceChildren(
    el('div', { class: 'player-stage' }, frame.body),
    el('div', { class: 'player-caption' }, [
      el('div', { class: 'caption-text', html: frame.caption || '' }),
      frame.worked || null,
    ]),
    toolbar(id),
  );
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
  return el('div', { class: 'player-bar' }, [
    btn('start', 'Back to start', () => { pause(id); setStep(id, 0); }, atStart),
    btn('prev', 'Previous step', () => { pause(id); setStep(id, p.step - 1); }, atStart),
    p.playing
      ? btn('pause', 'Pause', () => pause(id))
      : btn('play', atEnd ? 'Play again' : 'Play', () => play(id)),
    btn('next', 'Next step', () => { pause(id); setStep(id, p.step + 1); }, atEnd),
    btn('end', 'Skip to the end', () => { pause(id); setStep(id, p.total); }, atEnd),
    el('span', { class: 'counter', text: `${p.step} / ${p.total}` }),
    scrub,
    el('select', { class: 'speed', 'aria-label': 'Speed', onchange: (e) => setAnimation({ speed: e.target.value }) },
      Object.keys(SPEEDS).map((k) => el('option', { value: k, text: k, selected: k === speed }))),
  ]);
}

export function setStep(id, step) {
  const p = players.get(id);
  if (!p) return;
  p.step = Math.max(0, Math.min(p.total, step));
  if (p.track && p.step === p.total && getExperiment().progress[id] !== 'done') setProgress(id, 'done');
  refresh(id);
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
}

export function finishSequence(ids) {
  pauseAll();
  for (const id of ids) setStep(id, players.get(id)?.total ?? 0);
}

// Chapter-level controls placed at the top of a page.
export function chapterControls(ids) {
  const s = getExperiment();
  const done = ids.filter((id) => s.progress[id] === 'done').length;
  return el('div', { class: 'chapter-controls' }, [
    el('button', { class: 'primary', html: `${icon('play')} Play this chapter`, onclick: () => playSequence(ids) }),
    el('button', { html: `${icon('end')} Reveal everything`, onclick: () => finishSequence(ids) }),
    el('button', { class: 'ghost', html: `${icon('start')} Reset chapter`, onclick: () => resetSequence(ids) }),
    el('span', { class: 'fig-caption', style: 'margin:0', text: `${done} of ${ids.length} stages played` }),
  ]);
}
