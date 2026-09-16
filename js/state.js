// js/state.js
// Owns the persistent experiment state. Reads/writes localStorage, manages
// snapshots, and keeps a cache of derived values that is invalidated through
// the dependency graph in transformer.js.

import {
  STAGE_IDS, TRAINABLE, affectedStages, forward, trainStep as computeTrainStep,
  tokenize, tokenizeWords, tokenizerOf, tokenizerVocab, extendVocab, tokensToIds, seededMatrix, seededRow, sinusoidalPosition,
  sinusoidalPositions, zeros,
} from './transformer.js';

export const STORAGE_KEY = 'transformer-lab:experiment:v1';
export const VERSION = 1;

export const DEFAULTS = {
  sentence: 'the cat sat by the door',
  seed: 42,
  dim: 4,
  hidden: 8,
  learningRate: 0.1,
  causal: true,
  tokenizer: 'bpe-bytes',   // the one tokenizer in the book: byte-level BPE, merges learned from the corpus
  merges: 300,
};

export const DIM_OPTIONS = [2, 3, 4, 6, 8];
export const MAX_TOKENS = 2000;    // the maths runs on the whole text; tables show a window (the lens)
export const MAX_PROMPT_TOKENS = 64;
export const LENS_SIZES = [8, 12, 16, 24];

// Why a text cannot be used, or null if it is fine.
export function sentenceProblem(text) {
  const n = tokenize(text || '', tokenizerOf(state)).length;
  if (n === 0) return 'Type at least one word.';
  if (n > MAX_TOKENS) return `That is ${n} tokens — the cap is ${MAX_TOKENS}. Long texts are fine: the tables show a window of positions you can slide.`;
  return null;
}
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
  const tokenizer = tokenizerOf({ config: { merges: opts.merges }, sentence: opts.sentence });
  const tokens = tokenize(opts.sentence, tokenizer);
  const vocab = tokenizerVocab(tokenizer);   // fixed: every piece the tokenizer can produce
  const tokenIds = tokensToIds(tokens, vocab);
  return {
    version: VERSION,
    sentence: opts.sentence,
    vocab,
    tokenIds,
    seed: opts.seed,
    config: { dim: opts.dim, hidden: opts.hidden, causal: opts.causal, tokenizer: opts.tokenizer, merges: opts.merges },
    learningRate: opts.learningRate,
    weights: initWeights({
      seed: opts.seed, dim: opts.dim, hidden: opts.hidden,
      vocabSize: vocab.length, positions: Math.max(MIN_POSITIONS, tokens.length),
    }),
    trainingHistory: [],
    snapshots: [],
    animation: { speed: 'normal' },
    progress: {},            // stageId -> 'done' once the reader has played it to the end
    playground: { prompt: 'the cat', steps: 4, temperature: 0, heldOut: 'the dog sat by the cat' },
    view: { start: 0, size: 12 },  // the lens: which positions the tables show
    mode: 'lesson',                // 'lesson' (follow the class) or 'lab' (everything editable)
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
setTimeout(() => { lastCommitted = experimentOnly(); }, 0);
if (!state.playground) state.playground = { prompt: 'the cat', steps: 4, temperature: 0 };
if (!state.progress) state.progress = {};
if (!state.view) state.view = { start: 0, size: 12 };
if (!state.mode) state.mode = 'lesson';
if (!state.quiz) state.quiz = {};
// The dictionary is the tokenizer's fixed vocabulary. Older saves (a growing
// dictionary, other tokenizers) are moved onto it; rows of pieces that already
// existed keep their trained values, the rest are seeded as usual.
export function normaliseVocab(target) {
  const full = tokenizerVocab(tokenizerOf(target));
  const same = target.vocab.length === full.length && target.vocab.every((t, i) => t === full[i]);
  if (!same) {
    const oldIndex = new Map(target.vocab.map((t, i) => [t, i]));
    const remap = (name, scale) => full.map((piece, i) => {
      const old = oldIndex.get(piece);
      return old != null && target.weights[name][old] ? target.weights[name][old].slice() : seededRow(target.seed, name, i, target.config.dim, scale);
    });
    target.weights.embedding = remap('embedding', 0.5);
    target.weights.Wout = remap('Wout', 0.5);
    target.vocab = full;
  }
  target.config.tokenizer = 'bpe-bytes';
  target.config.merges = 300;
  const tokens = tokenize(target.sentence, tokenizerOf(target));
  target.tokenIds = tokensToIds(tokens, target.vocab);
  return !same;
}
if (normaliseVocab(state)) { state.progress = {}; writeStorage(state); }
// Texts saved before the token cap existed: shorten them once, and say so.
if (state.tokenIds.length > MAX_TOKENS) {
  const kept = tokenizeWords(state.sentence).slice(0, MAX_TOKENS);
  state.sentence = kept.join(' ');
  state.tokenIds = tokensToIds(kept, state.vocab);
  state.progress = {};
  state.notice = `Your text had more than ${MAX_TOKENS} tokens, so it was shortened to the first ${MAX_TOKENS}.`;
  writeStorage(state);
}
// Whatever was stored, every vocab entry and position must have its rows.
if (ensureCapacity(state).length) writeStorage(state);
if (!state.animation || !state.animation.speed) state.animation = { speed: 'normal' };

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

// Undo history: the experiment as it was before each model-changing commit.
const UNDO_DEPTH = 30;
const undoStack = [];
const redoStack = [];
let lastCommitted = null;

// While a coalescing key is set (e.g. during a drag), consecutive commits
// collapse into a single undo step.
let coalesceKey = null;
let lastCoalesce = null;
export function setCoalescing(key) { coalesceKey = key; if (!key) lastCoalesce = null; }

function rememberForUndo(extra) {
  if (extra.undo || extra.redo) { lastCoalesce = null; return; }
  const skip = coalesceKey && coalesceKey === lastCoalesce;
  lastCoalesce = coalesceKey;
  if (skip) return;
  if (lastCommitted) {
    undoStack.push(lastCommitted);
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    redoStack.length = 0;
  }
}

// The single write path: persist, invalidate, notify.
function commit(changedKeys, extra = {}) {
  rememberForUndo(extra);
  state.updatedAt = Date.now();
  const affected = affectedStages(changedKeys);
  for (const id of affected) { dirty.add(id); delete state.progress[id]; } // needs replaying
  writeStorage(state);
  lastCommitted = experimentOnly();
  const event = { changedKeys, affected, state, ...extra };
  for (const fn of listeners) fn(event);
  return event;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return null;
  redoStack.push(experimentOnly());
  Object.assign(state, JSON.parse(JSON.stringify(prev)));
  ensureCapacity(state);
  return commit(['*'], { undo: true });
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return null;
  undoStack.push(experimentOnly());
  Object.assign(state, JSON.parse(JSON.stringify(next)));
  ensureCapacity(state);
  return commit(['*'], { redo: true });
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
    // Which top-level keys actually differ? Preference-only changes (progress,
    // playground, animation, …) are quiet; anything touching the model recalculates.
    const changedKeys = Object.keys({ ...state, ...incoming }).filter((k) => k !== 'updatedAt' && JSON.stringify(state[k]) !== JSON.stringify(incoming[k]));
    state = incoming;
    const QUIET = new Set(['progress', 'playground', 'animation', 'currentStep', 'snapshots', 'learningRate', 'handEdited', 'view', 'mode', 'notice', 'quiz']);
    if (changedKeys.length && changedKeys.every((k) => QUIET.has(k))) {
      const event = { changedKeys, affected: [], state, quiet: true, external: true };
      for (const fn of listeners) fn(event);
      return;
    }
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
  const tokens = tokenize(sentence, tokenizerOf(state));
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return null;
  state.sentence = sentence;
  delete state.notice;
  state.tokenIds = tokensToIds(tokens, state.vocab);
  const grown = ensureCapacity(state);
  return commit(['sentence', 'tokenIds', ...grown]);
}

// Teach the model new words without changing the training text: they get a
// deterministic random embedding and Wout row, exactly like sentence edits.
export function addWords() { return null; } // the dictionary is fixed; every piece already has a row

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
  state.handEdited = true;
  return commit([`weights.${name}`], { cell: { name, row, col, value: v } });
}

export function setWeights(partial) {
  const keys = [];
  for (const [name, value] of Object.entries(partial)) {
    if (!(name in state.weights)) continue;
    state.weights[name] = value;
    keys.push(`weights.${name}`);
  }
  state.handEdited = true;
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
  state.handEdited = false;
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

export function setProgress(stageId, value) {
  if (value) state.progress[stageId] = value; else delete state.progress[stageId];
  commitQuiet(['progress']);
}

export function clearProgress(stageIds) {
  for (const id of stageIds) delete state.progress[id];
  commitQuiet(['progress']);
}

export function setAnimation(prefs) {
  state.animation = { ...state.animation, ...prefs };
  commitQuiet(['animation']);
}

export function setQuiz(page, qi, answer) {
  state.quiz = state.quiz || {};
  state.quiz[page] = { ...(state.quiz[page] || {}), [qi]: answer };
  commitQuiet(['quiz']);
}

export function setMode(mode) {
  state.mode = mode === 'lab' ? 'lab' : 'lesson';
  commitQuiet(['mode']);
}
export function isLab() { return state.mode === 'lab'; }

// The lens is a viewing preference: it never changes the model.
export function setView(partial) {
  state.view = { ...state.view, ...partial };
  const n = state.tokenIds.length;
  state.view.size = LENS_SIZES.includes(state.view.size) ? state.view.size : 12;
  state.view.start = Math.max(0, Math.min(Math.max(0, n - state.view.size), Math.round(state.view.start || 0)));
  commitQuiet(['view']);
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

// Asynchronous training in a Web Worker (falls back to the main thread).
// trainStepAsync() resolves with the commit event of one step; trainMany()
// sends the whole batch at once and applies each step as it lands.
let worker = null;
let workerBroken = false;
let nextJob = 0;
const jobs = new Map(); // id -> { onStep, resolve }
function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./train.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      const event = applyTrained(e.data);
      job.onStep && job.onStep(e.data.i, event);
      if (e.data.done) { jobs.delete(e.data.id); job.resolve(event); }
    };
    worker.onerror = () => {
      workerBroken = true; worker = null;
      for (const [, job] of jobs) job.resolve(null);
      jobs.clear();
    };
  } catch { workerBroken = true; worker = null; }
  return worker;
}

function applyTrained(result) {
  state.weights = result.weights;
  state.trainingHistory.push({ step: state.trainingHistory.length + 1, loss: result.lossBefore, learningRate: state.learningRate });
  return commit(TRAINABLE.map((n) => `weights.${n}`), { training: result, steps: 1 });
}

function trainInWorker(steps, onStep) {
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) return null;
  return new Promise((resolve) => {
    const id = ++nextJob;
    jobs.set(id, { onStep, resolve });
    w.postMessage({ id, state: experimentOnly(), learningRate: state.learningRate, steps });
  });
}

export async function trainStepAsync() {
  const viaWorker = trainInWorker(1);
  const event = viaWorker ? await viaWorker : null;
  return event || train(1);
}

// Several steps; onStep(i, event) fires after each is applied.
export async function trainMany(steps, onStep) {
  const viaWorker = trainInWorker(steps, onStep);
  const event = viaWorker ? await viaWorker : null;
  if (event) return event;
  let last = null;
  for (let i = 0; i < steps; i++) { last = train(1); onStep && onStep(i + 1, last); }
  return last;
}

export function train(steps = 1) {
  let last = null;
  let first = null;
  for (let i = 0; i < steps; i++) {
    last = computeTrainStep(state, state.learningRate);
    first = first || last;
    state.weights = last.weights;
    state.trainingHistory.push({
      step: state.trainingHistory.length + 1,
      loss: last.lossBefore,
      learningRate: state.learningRate,
    });
  }
  return commit(TRAINABLE.map((n) => `weights.${n}`), { training: { ...last, lossBefore: first.lossBefore }, steps });
}

export function resetExperiment(overrides = {}) {
  const keep = { snapshots: state.snapshots, animation: state.animation };
  state = { ...createExperiment(overrides), ...keep };
  return commit(['*'], { reset: true });
}

// A model with the same text, dictionary and sizes but freshly rolled weights —
// what the current model looked like before any editing or training. Fully
// derived from (seed, config, vocab), so it is never stored.
// Tokenise any text (a prompt) the way the current model tokenises its own.
export function tokenizeLike(text) { return tokenize(text, tokenizerOf(state)); }
export function usedIds() { return [...new Set(state.tokenIds)].sort((a, b) => a - b); }

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
  normaliseVocab(state);
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

// ---------------------------------------------------------------------------
// Sharing: the experiment compressed into a URL fragment, and a NumPy dump.
// ---------------------------------------------------------------------------

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function pipe(bytes, Stream, kind) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream(kind));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function shareUrl() {
  const json = new TextEncoder().encode(JSON.stringify({ version: VERSION, experiment: experimentOnly() }));
  let payload;
  if (typeof CompressionStream !== 'undefined') payload = 'z' + b64url(await pipe(json, CompressionStream, 'deflate-raw'));
  else payload = 'j' + b64url(json);
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html#s=${payload}`;
}

// Decode a "#s=" fragment; returns { experiment } or null.
export async function decodeShared(hash) {
  const m = /[#&]s=([^&]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const kind = m[1][0];
    const bytes = unb64url(m[1].slice(1));
    const json = kind === 'z' ? await pipe(bytes, DecompressionStream, 'deflate-raw') : bytes;
    const parsed = JSON.parse(new TextDecoder().decode(json));
    if (!parsed.experiment || !parsed.experiment.weights) return null;
    return parsed;
  } catch { return null; }
}

export function loadShared(parsed) {
  const exp = parsed.experiment;
  Object.assign(state, JSON.parse(JSON.stringify({ trainingHistory: [], ...exp })));
  normaliseVocab(state);
  ensureCapacity(state);
  return commit(['*'], { shared: true });
}

export function asNumpy() {
  const np = (name, m) => `${name} = np.array(${JSON.stringify(m)})`;
  const w = state.weights;
  return [
    '# Transformer Lab — current experiment as NumPy',
    'import numpy as np',
    `sentence = ${JSON.stringify(state.sentence)}`,
    `vocab = ${JSON.stringify(state.vocab)}`,
    `token_ids = np.array(${JSON.stringify(state.tokenIds)})`,
    `dim, hidden, causal = ${state.config.dim}, ${state.config.hidden}, ${state.config.causal ? 'True' : 'False'}`,
    np('E', w.embedding), np('P', w.positional), np('Wq', w.Wq), np('Wk', w.Wk), np('Wv', w.Wv),
    np('W1', w.W1), np('b1', w.b1), np('W2', w.W2), np('b2', w.b2), np('Wout', w.Wout),
    '',
    'def layer_norm(x, eps=1e-5):',
    '    return (x - x.mean(-1, keepdims=True)) / np.sqrt(x.var(-1, keepdims=True) + eps)',
    'def softmax(x):',
    '    e = np.exp(x - x.max(-1, keepdims=True)); return e / e.sum(-1, keepdims=True)',
    '',
    'X = E[token_ids] + P[:len(token_ids)]',
    'Q, K, V = X @ Wq, X @ Wk, X @ Wv',
    'S = Q @ K.T / np.sqrt(dim)',
    'if causal: S = S + np.triu(np.full_like(S, -np.inf), 1)',
    'A = softmax(S)',
    'N1 = layer_norm(X + A @ V)',
    'H = np.maximum(N1 @ W1 + b1, 0)',
    'N2 = layer_norm(N1 + H @ W2 + b2)',
    'probs = softmax(N2 @ Wout.T)',
    'print([vocab[i] for i in probs.argmax(-1)])',
  ].join('\n');
}
