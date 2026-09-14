// js/state.js
// Owns the persistent experiment state. Reads/writes localStorage, manages
// snapshots, and keeps a cache of derived values that is invalidated through
// the dependency graph in transformer.js.

import {
  STAGE_IDS, TRAINABLE, affectedStages, forward, trainStep as computeTrainStep,
  tokenize, extendVocab, tokensToIds, seededMatrix, seededRow, sinusoidalPosition,
  sinusoidalPositions, zeros,
} from './transformer.js';

export const STORAGE_KEY = 'transformer-lab:experiment:v1';
export const VERSION = 1;

export const DEFAULTS = {
  sentence: 'the cat sat on the mat',
  seed: 42,
  dim: 4,
  hidden: 8,
  learningRate: 0.1,
  causal: true,
};

export const DIM_OPTIONS = [2, 3, 4, 6, 8];
export const HIDDEN_OPTIONS = [4, 8, 16];
const MIN_POSITIONS = 8;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function initWeights({ seed, dim, hidden, vocabSize, positions }) {
  const attnScale = 1 / Math.sqrt(dim);
  return {
    embedding: seededMatrix(seed, 'embedding', vocabSize, dim, 0.5),
    positional: sinusoidalPositions(positions, dim),
    Wq: seededMatrix(seed, 'Wq', dim, dim, attnScale),
    Wk: seededMatrix(seed, 'Wk', dim, dim, attnScale),
    Wv: seededMatrix(seed, 'Wv', dim, dim, attnScale),
    W1: seededMatrix(seed, 'W1', dim, hidden, 1 / Math.sqrt(dim)),
    b1: zeros(hidden),
    W2: seededMatrix(seed, 'W2', hidden, dim, 1 / Math.sqrt(hidden)),
    b2: zeros(dim),
    Wout: seededMatrix(seed, 'Wout', vocabSize, dim, 0.5),
  };
}

export function createExperiment(overrides = {}) {
  const opts = { ...DEFAULTS, ...overrides };
  const tokens = tokenize(opts.sentence);
  const vocab = extendVocab([], tokens);
  const tokenIds = tokensToIds(tokens, vocab);
  return {
    version: VERSION,
    sentence: opts.sentence,
    vocab,
    tokenIds,
    seed: opts.seed,
    config: { dim: opts.dim, hidden: opts.hidden, causal: opts.causal },
    learningRate: opts.learningRate,
    weights: initWeights({
      seed: opts.seed, dim: opts.dim, hidden: opts.hidden,
      vocabSize: vocab.length, positions: Math.max(MIN_POSITIONS, tokens.length),
    }),
    trainingHistory: [],
    snapshots: [],
    animation: { enabled: true, stepDelayMs: 220 },
    playground: { prompt: 'the cat', steps: 4, temperature: 0 },
    currentStep: 'index.html',
    updatedAt: Date.now(),
  };
}

// Grow matrices so every vocab entry / position has a row. Existing rows are
// untouched; new rows are seeded deterministically from (seed, name, rowIndex).
function ensureCapacity(state) {
  const grown = [];
  const { dim } = state.config;
  const w = state.weights;
  while (w.embedding.length < state.vocab.length) {
    w.embedding.push(seededRow(state.seed, 'embedding', w.embedding.length, dim, 0.5));
    if (!grown.includes('weights.embedding')) grown.push('weights.embedding');
  }
  while (w.Wout.length < state.vocab.length) {
    w.Wout.push(seededRow(state.seed, 'Wout', w.Wout.length, dim, 0.5));
    if (!grown.includes('weights.Wout')) grown.push('weights.Wout');
  }
  while (w.positional.length < state.tokenIds.length) {
    w.positional.push(sinusoidalPosition(w.positional.length, dim));
    if (!grown.includes('weights.positional')) grown.push('weights.positional');
  }
  return grown;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function hasStorage() {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
}

function readStorage() {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION || !parsed.weights) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(value) {
  if (!hasStorage()) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (e) { console.warn('save failed', e); }
}

let state = readStorage() || createExperiment();
if (!state.playground) state.playground = { prompt: 'the cat', steps: 4, temperature: 0 };

// ---------------------------------------------------------------------------
// Derived cache + change notification
// ---------------------------------------------------------------------------

let derived = null;
let dirty = new Set(STAGE_IDS);
const listeners = new Set();

export function getExperiment() {
  return state;
}

export function getDerived() {
  if (dirty.size) {
    derived = forward(state, derived, dirty);
    dirty.clear();
  }
  return derived;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The single write path: persist, invalidate, notify.
function commit(changedKeys, extra = {}) {
  state.updatedAt = Date.now();
  writeStorage(state);
  const affected = affectedStages(changedKeys);
  for (const id of affected) dirty.add(id);
  const event = { changedKeys, affected, state, ...extra };
  for (const fn of listeners) fn(event);
  return event;
}

// Preferences that do not touch the model: save without recalculating.
function commitQuiet(changedKeys) {
  writeStorage(state);
  const event = { changedKeys, affected: [], state, quiet: true };
  for (const fn of listeners) fn(event);
}

// Another tab changed the experiment: adopt it and recalculate everything.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    const incoming = readStorage();
    if (!incoming) return;
    state = incoming;
    dirty = new Set(STAGE_IDS);
    const event = { changedKeys: ['*'], affected: STAGE_IDS.slice(), state, external: true };
    for (const fn of listeners) fn(event);
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setSentence(text) {
  const sentence = String(text ?? '').trim();
  if (sentence === state.sentence) return null;
  const tokens = tokenize(sentence);
  if (tokens.length === 0) return null;
  state.sentence = sentence;
  state.vocab = extendVocab(state.vocab, tokens);
  state.tokenIds = tokensToIds(tokens, state.vocab);
  const grown = ensureCapacity(state);
  return commit(['sentence', 'vocab', 'tokenIds', ...grown]);
}

// Teach the model new words without changing the training text: they get a
// deterministic random embedding and Wout row, exactly like sentence edits.
export function addWords(words) {
  const before = state.vocab.length;
  state.vocab = extendVocab(state.vocab, words);
  if (state.vocab.length === before) return null;
  const grown = ensureCapacity(state);
  return commit(['vocab', ...grown]);
}

export function setWeightCell(name, row, col, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const w = state.weights[name];
  if (!w) return null;
  if (Array.isArray(w[0])) {
    if (w[row][col] === v) return null;
    w[row][col] = v;
  } else {
    if (w[col] === v) return null;
    w[col] = v;
  }
  return commit([`weights.${name}`], { cell: { name, row, col, value: v } });
}

export function setWeights(partial) {
  const keys = [];
  for (const [name, value] of Object.entries(partial)) {
    if (!(name in state.weights)) continue;
    state.weights[name] = value;
    keys.push(`weights.${name}`);
  }
  return keys.length ? commit(keys) : null;
}

// Changing seed / dimensions re-initialises every weight matrix.
export function setModelConfig({ seed, dim, hidden }) {
  const next = {
    seed: seed ?? state.seed,
    dim: dim ?? state.config.dim,
    hidden: hidden ?? state.config.hidden,
  };
  const changed = [];
  if (next.seed !== state.seed) changed.push('seed');
  if (next.dim !== state.config.dim) changed.push('config.dim');
  if (next.hidden !== state.config.hidden) changed.push('config.hidden');
  if (!changed.length) return null;
  state.seed = next.seed;
  state.config.dim = next.dim;
  state.config.hidden = next.hidden;
  state.weights = initWeights({
    seed: next.seed, dim: next.dim, hidden: next.hidden,
    vocabSize: state.vocab.length,
    positions: Math.max(MIN_POSITIONS, state.tokenIds.length),
  });
  state.trainingHistory = [];
  return commit([...changed, 'weights'], { reinitialised: true });
}

export function setCausal(flag) {
  const causal = Boolean(flag);
  if (causal === state.config.causal) return null;
  state.config.causal = causal;
  return commit(['config.causal']);
}

export function setLearningRate(lr) {
  const v = Number(lr);
  if (!Number.isFinite(v) || v <= 0 || v === state.learningRate) return null;
  state.learningRate = v;
  commitQuiet(['learningRate']);
}

export function setAnimation(prefs) {
  state.animation = { ...state.animation, ...prefs };
  commitQuiet(['animation']);
}

export function setPlayground(partial) {
  state.playground = { ...(state.playground || { prompt: '', steps: 4, temperature: 0 }), ...partial };
  commitQuiet(['playground']);
}

export function setCurrentStep(page) {
  if (state.currentStep === page) return;
  state.currentStep = page;
  commitQuiet(['currentStep']);
}

export function train(steps = 1) {
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = computeTrainStep(state, state.learningRate);
    state.weights = last.weights;
    state.trainingHistory.push({
      step: state.trainingHistory.length + 1,
      loss: last.lossBefore,
      learningRate: state.learningRate,
    });
  }
  return commit(TRAINABLE.map((n) => `weights.${n}`), { training: last, steps });
}

export function resetExperiment(overrides = {}) {
  const keep = { snapshots: state.snapshots, animation: state.animation };
  state = { ...createExperiment(overrides), ...keep };
  return commit(['*'], { reset: true });
}

// A model with the same text, dictionary and sizes but freshly rolled weights —
// what the current model looked like before any editing or training. Fully
// derived from (seed, config, vocab), so it is never stored.
export function untrainedExperiment() {
  return {
    ...state,
    weights: initWeights({
      seed: state.seed, dim: state.config.dim, hidden: state.config.hidden,
      vocabSize: state.vocab.length, positions: Math.max(MIN_POSITIONS, state.tokenIds.length),
    }),
    trainingHistory: [],
  };
}

// ---------------------------------------------------------------------------
// Snapshots — persistent inputs only; derived values are recomputed on load.
// ---------------------------------------------------------------------------

const EXPERIMENT_KEYS = ['sentence', 'vocab', 'tokenIds', 'seed', 'config', 'learningRate', 'weights', 'trainingHistory'];

export function experimentOnly(source = state) {
  const out = {};
  for (const k of EXPERIMENT_KEYS) out[k] = JSON.parse(JSON.stringify(source[k]));
  return out;
}

export function saveSnapshot(name) {
  const snapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: (name || '').trim() || `Snapshot ${state.snapshots.length + 1}`,
    createdAt: new Date().toISOString(),
    experiment: experimentOnly(),
  };
  state.snapshots.push(snapshot);
  commitQuiet(['snapshots']);
  return snapshot;
}

export function loadSnapshot(id) {
  const snap = state.snapshots.find((s) => s.id === id);
  if (!snap) return null;
  Object.assign(state, JSON.parse(JSON.stringify(snap.experiment)));
  ensureCapacity(state);
  return commit(['*'], { snapshot: snap });
}

export function deleteSnapshot(id) {
  const before = state.snapshots.length;
  state.snapshots = state.snapshots.filter((s) => s.id !== id);
  if (state.snapshots.length !== before) commitQuiet(['snapshots']);
}

export function exportSnapshot(id) {
  const snap = id ? state.snapshots.find((s) => s.id === id) : null;
  const payload = snap || { name: 'current', createdAt: new Date().toISOString(), experiment: experimentOnly() };
  return JSON.stringify({ version: VERSION, ...payload }, null, 2);
}

export function importSnapshot(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const exp = parsed.experiment;
  if (!exp || !exp.weights || !Array.isArray(exp.vocab)) throw new Error('Not a transformer-lab snapshot');
  const snapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: parsed.name || 'Imported',
    createdAt: parsed.createdAt || new Date().toISOString(),
    experiment: { trainingHistory: [], ...exp },
  };
  state.snapshots.push(snapshot);
  commitQuiet(['snapshots']);
  return snapshot;
}
