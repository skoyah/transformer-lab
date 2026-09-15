// js/transformer.js
// Pure mathematics + the dependency graph of the educational pipeline.
// No DOM, no storage. Everything here is a deterministic function of the
// persistent experiment state (see state.js).

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

export function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round(x, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

// Each row is seeded independently by (seed, salt, rowIndex) so that growing a
// matrix (new vocabulary word, longer sentence) never changes existing rows.
export function seededRow(seed, salt, index, cols, scale) {
  const rng = mulberry32(hashString(`${seed}|${salt}|${index}`));
  return Array.from({ length: cols }, () => round((rng() * 2 - 1) * scale));
}

export function seededMatrix(seed, salt, rows, cols, scale) {
  return Array.from({ length: rows }, (_, r) => seededRow(seed, salt, r, cols, scale));
}

// ---------------------------------------------------------------------------
// Linear algebra helpers (matrices are arrays of row arrays)
// ---------------------------------------------------------------------------

export function zeros(n) {
  return Array.from({ length: n }, () => 0);
}

export function shapeOf(m) {
  if (!Array.isArray(m)) return '';
  if (m.length === 0) return '0';
  if (!Array.isArray(m[0])) return `${m.length}`;
  return `${m.length} × ${m[0].length}`;
}

export function matmul(A, B) {
  const n = A.length;
  const k = B.length;
  const m = k ? B[0].length : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(m).fill(0);
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      const brow = B[p];
      for (let j = 0; j < m; j++) row[j] += a * brow[j];
    }
    out.push(row);
  }
  return out;
}

export function transpose(A) {
  if (A.length === 0) return [];
  const rows = A.length, cols = A[0].length;
  const out = new Array(cols);
  for (let j = 0; j < cols; j++) { const r = new Array(rows); for (let i = 0; i < rows; i++) r[i] = A[i][j]; out[j] = r; }
  return out;
}

// The helpers below are written as plain loops: with a 2,000-token text the
// attention tables have 4 million cells, and closure-per-cell code was slow.
export function addMatrices(A, B) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) { const a = A[i], b = B[i], r = new Array(a.length); for (let j = 0; j < a.length; j++) r[j] = a[j] + b[j]; out[i] = r; }
  return out;
}

export function addBias(A, b) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) { const a = A[i], r = new Array(a.length); for (let j = 0; j < a.length; j++) r[j] = a[j] + b[j]; out[i] = r; }
  return out;
}

export function scaleMatrix(A, s) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) { const a = A[i], r = new Array(a.length); for (let j = 0; j < a.length; j++) r[j] = a[j] * s; out[i] = r; }
  return out;
}

export function relu(A) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) { const a = A[i], r = new Array(a.length); for (let j = 0; j < a.length; j++) r[j] = a[j] > 0 ? a[j] : 0; out[i] = r; }
  return out;
}

export function causalMask(A) {
  // Position i may only attend to positions <= i.
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) { const a = A[i], r = new Array(a.length); for (let j = 0; j < a.length; j++) r[j] = j > i ? -Infinity : a[j]; out[i] = r; }
  return out;
}

// Scale and (optionally) mask in one pass — the hot path for long texts.
export function scaleAndMask(A, s, causal) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) {
    const a = A[i], r = new Array(a.length);
    for (let j = 0; j < a.length; j++) r[j] = causal && j > i ? -Infinity : a[j] * s;
    out[i] = r;
  }
  return out;
}

export function softmaxRow(row) {
  let max = -Infinity;
  for (let j = 0; j < row.length; j++) if (row[j] > max) max = row[j];
  const out = new Array(row.length);
  if (max === -Infinity) { for (let j = 0; j < row.length; j++) out[j] = 0; return out; }
  let sum = 0;
  for (let j = 0; j < row.length; j++) { const e = row[j] === -Infinity ? 0 : Math.exp(row[j] - max); out[j] = e; sum += e; }
  for (let j = 0; j < row.length; j++) out[j] /= sum;
  return out;
}

export function softmaxRows(A) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = softmaxRow(A[i]);
  return out;
}

export function layerNorm(A, eps = 1e-5) {
  const out = new Array(A.length);
  for (let i = 0; i < A.length; i++) {
    const row = A[i], n = row.length;
    let mean = 0; for (let j = 0; j < n; j++) mean += row[j]; mean /= n;
    let variance = 0; for (let j = 0; j < n; j++) { const dlt = row[j] - mean; variance += dlt * dlt; } variance /= n;
    const inv = 1 / Math.sqrt(variance + eps);
    const r = new Array(n); for (let j = 0; j < n; j++) r[j] = (row[j] - mean) * inv;
    out[i] = r;
  }
  return out;
}

export function argmax(row) {
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i] > row[best]) best = i;
  return best;
}

// ---------------------------------------------------------------------------
// Tokens / vocabulary / positions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tokenizers. Three schemes, chosen in state.config.tokenizer:
//   words — lower-cased words, punctuation on its own (the simple default)
//   chars — one token per character; a space becomes ▁
//   bpe   — subwords: start from characters, repeatedly merge the most
//           frequent adjacent pair (learned from the training text itself)
// ▁ marks the start of a word in the chars/bpe schemes, as in SentencePiece.
// ---------------------------------------------------------------------------

export const TOKENIZERS = ['words', 'chars', 'bpe'];
export const WORD_START = '▁';

export function tokenizeWords(sentence) {
  return (sentence || '').toLowerCase().match(/[a-z0-9']+|[^\sa-z0-9']/g) || [];
}

export function tokenizeChars(sentence) {
  const text = (sentence || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return [...text].map((c) => (c === ' ' ? WORD_START : c));
}

// Each word as a list of symbols, first symbol carrying the ▁ marker.
function wordSymbols(sentence) {
  return tokenizeWords(sentence).map((w) => [...w].map((c, i) => (i === 0 ? WORD_START + c : c)));
}

function pairCounts(words) {
  const counts = new Map();
  for (const syms of words) {
    for (let i = 0; i + 1 < syms.length; i++) {
      const key = syms[i] + '\u0000' + syms[i + 1];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function mergePair(words, a, b) {
  const joined = a + b;
  return words.map((syms) => {
    const out = [];
    for (let i = 0; i < syms.length; i++) {
      if (syms[i] === a && syms[i + 1] === b) { out.push(joined); i++; } else out.push(syms[i]);
    }
    return out;
  });
}

// Learn up to `numMerges` merges from the text. Returns
// { merges: [{ a, b, result, count, top }], steps: [words after each merge], initial }.
// Deterministic: ties broken alphabetically. Stops when no pair occurs twice.
// `keepSteps` bounds how many intermediate states are stored (the player only
// shows the first few dozen merges; a corpus-sized history would be heavy).
export function learnBpe(sentence, numMerges, { keepSteps = Infinity, sampleWords = Infinity } = {}) {
  let words = wordSymbols(sentence);
  const snapshot = (ws) => ws.slice(0, sampleWords).map((w) => w.slice());
  const initial = snapshot(words);
  const merges = [];
  const steps = [];
  for (let m = 0; m < numMerges; m++) {
    const counts = pairCounts(words);
    let best = null;
    for (const [key, count] of counts) {
      if (count < 2) continue;
      if (!best || count > best.count || (count === best.count && key < best.key)) best = { key, count };
    }
    if (!best) break;
    const [a, b] = best.key.split('\u0000');
    words = mergePair(words, a, b);
    const keep = merges.length < keepSteps;
    merges.push({ a, b, result: a + b, count: best.count,
      top: keep ? [...counts].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 6).map(([k, c]) => ({ pair: k.split('\u0000'), count: c })) : null });
    if (keep) steps.push(snapshot(words));
  }
  return { merges, steps, initial };
}

// Apply learned merges, in order, to any text (prompts use the training text's merges).
export function applyBpe(sentence, merges) {
  let words = wordSymbols(sentence);
  for (const { a, b } of merges) words = mergePair(words, a, b);
  return words.flat();
}

const bpeCache = new Map();
export const BPE_PLAYER_STEPS = 40;   // merges the Chapter 1 player steps through
export const BPE_SAMPLE_WORDS = 48;   // corpus words shown in that player
export function bpeFor(trainingText, numMerges) {
  const key = `${numMerges}|${trainingText.length}|${trainingText.slice(0, 64)}`;
  if (!bpeCache.has(key)) {
    if (bpeCache.size > 4) bpeCache.clear();
    bpeCache.set(key, learnBpe(trainingText, numMerges, { keepSteps: BPE_PLAYER_STEPS, sampleWords: BPE_SAMPLE_WORDS }));
  }
  return bpeCache.get(key);
}

// tokenizer: { scheme, merges, trainingText } — trainingText is what BPE learns from.
export function tokenize(sentence, tokenizer = null) {
  const scheme = tokenizer && tokenizer.scheme ? tokenizer.scheme : 'words';
  if (scheme === 'chars') return tokenizeChars(sentence);
  if (scheme === 'bpe') return applyBpe(sentence, bpeFor(tokenizer.trainingText ?? sentence, tokenizer.merges ?? 20).merges);
  return tokenizeWords(sentence);
}

// The tokenizer a state implies: BPE with merges learned once from the corpus.
import { CORPUS } from './corpus.js';
export const BPE_MERGES = 300;
export function tokenizerOf(state) {
  return { scheme: 'bpe', merges: (state.config && state.config.merges) || BPE_MERGES, trainingText: CORPUS };
}

// Existing vocabulary entries keep their IDs; unseen tokens are appended.
export function extendVocab(vocab, tokens) {
  const out = vocab.slice();
  for (const t of tokens) if (!out.includes(t)) out.push(t);
  return out;
}

export function tokensToIds(tokens, vocab) {
  return tokens.map((t) => vocab.indexOf(t));
}

export function sinusoidalPosition(pos, dim) {
  return Array.from({ length: dim }, (_, i) => {
    const angle = pos / 10000 ** ((i - (i % 2)) / dim);
    return round(i % 2 === 0 ? Math.sin(angle) : Math.cos(angle), 3);
  });
}

export function sinusoidalPositions(n, dim) {
  return Array.from({ length: n }, (_, p) => sinusoidalPosition(p, dim));
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------
// Every stage lists:
//   deps    – upstream derived stages it reads
//   inputs  – persistent state keys it reads (dot paths, e.g. 'weights.Wq')
//   compute – pure function (state, derived) -> value
// STAGES is in topological order, so a single pass computes everything.

export const STAGES = [
  {
    id: 'tokens', label: 'Tokens', page: 'tokens.html',
    formula: 'tokenize(sentence)',
    deps: [], inputs: ['sentence', 'config.tokenizer', 'config.merges'],
    compute: (s) => tokenize(s.sentence, tokenizerOf(s)),
  },
  {
    id: 'tokenIds', label: 'Token IDs', page: 'tokens.html',
    formula: 'vocab.indexOf(token)',
    deps: ['tokens'], inputs: ['vocab'],
    compute: (s, d) => tokensToIds(d.tokens, s.vocab),
  },
  {
    id: 'embeddings', label: 'Embeddings', page: 'embeddings.html',
    formula: 'E[id]',
    deps: ['tokenIds'], inputs: ['weights.embedding'],
    compute: (s, d) => d.tokenIds.map((id) => s.weights.embedding[id].slice()),
  },
  {
    id: 'positionalInput', label: 'Positional input X', page: 'embeddings.html',
    formula: 'X = E[id] + P[pos]',
    deps: ['embeddings'], inputs: ['weights.positional'],
    compute: (s, d) => addMatrices(d.embeddings, s.weights.positional.slice(0, d.embeddings.length)),
  },
  {
    id: 'Q', label: 'Q', page: 'attention.html',
    formula: 'Q = X · Wq',
    deps: ['positionalInput'], inputs: ['weights.Wq'],
    compute: (s, d) => matmul(d.positionalInput, s.weights.Wq),
  },
  {
    id: 'K', label: 'K', page: 'attention.html',
    formula: 'K = X · Wk',
    deps: ['positionalInput'], inputs: ['weights.Wk'],
    compute: (s, d) => matmul(d.positionalInput, s.weights.Wk),
  },
  {
    id: 'V', label: 'V', page: 'attention.html',
    formula: 'V = X · Wv',
    deps: ['positionalInput'], inputs: ['weights.Wv'],
    compute: (s, d) => matmul(d.positionalInput, s.weights.Wv),
  },
  {
    id: 'KT', label: 'Kᵀ', page: 'attention.html',
    formula: 'Kᵀ = transpose(K)',
    deps: ['K'], inputs: [],
    compute: (s, d) => transpose(d.K),
  },
  {
    id: 'scores', label: 'Attention scores', page: 'attention.html',
    formula: 'S = Q · Kᵀ',
    deps: ['Q', 'KT'], inputs: [],
    compute: (s, d) => matmul(d.Q, d.KT),
  },
  {
    id: 'scaledScores', label: 'Scaled scores', page: 'attention.html',
    formula: 'S / √d  (+ causal mask)',
    deps: ['scores'], inputs: ['config.dim', 'config.causal'],
    compute: (s, d) => scaleAndMask(d.scores, 1 / Math.sqrt(s.config.dim), !!s.config.causal),
  },
  {
    id: 'attentionWeights', label: 'Softmax', page: 'attention.html',
    formula: 'A = softmax(rows)',
    deps: ['scaledScores'], inputs: [],
    compute: (s, d) => softmaxRows(d.scaledScores),
  },
  {
    id: 'attentionOutput', label: 'Attention output', page: 'attention.html',
    formula: 'Z = A · V',
    deps: ['attentionWeights', 'V'], inputs: [],
    compute: (s, d) => matmul(d.attentionWeights, d.V),
  },
  {
    id: 'residual1', label: 'Residual 1', page: 'ffn.html',
    formula: 'R₁ = X + Z',
    deps: ['positionalInput', 'attentionOutput'], inputs: [],
    compute: (s, d) => addMatrices(d.positionalInput, d.attentionOutput),
  },
  {
    id: 'norm1', label: 'LayerNorm 1', page: 'ffn.html',
    formula: 'N₁ = layerNorm(R₁)',
    deps: ['residual1'], inputs: [],
    compute: (s, d) => layerNorm(d.residual1),
  },
  {
    id: 'ffnHidden', label: 'FFN hidden', page: 'ffn.html',
    formula: 'H = ReLU(N₁ · W₁ + b₁)',
    deps: ['norm1'], inputs: ['weights.W1', 'weights.b1'],
    compute: (s, d) => relu(addBias(matmul(d.norm1, s.weights.W1), s.weights.b1)),
  },
  {
    id: 'ffnOutput', label: 'FFN output', page: 'ffn.html',
    formula: 'F = H · W₂ + b₂',
    deps: ['ffnHidden'], inputs: ['weights.W2', 'weights.b2'],
    compute: (s, d) => addBias(matmul(d.ffnHidden, s.weights.W2), s.weights.b2),
  },
  {
    id: 'residual2', label: 'Residual 2', page: 'ffn.html',
    formula: 'R₂ = N₁ + F',
    deps: ['norm1', 'ffnOutput'], inputs: [],
    compute: (s, d) => addMatrices(d.norm1, d.ffnOutput),
  },
  {
    id: 'norm2', label: 'LayerNorm 2', page: 'ffn.html',
    formula: 'N₂ = layerNorm(R₂)',
    deps: ['residual2'], inputs: [],
    compute: (s, d) => layerNorm(d.residual2),
  },
  {
    id: 'logits', label: 'Logits', page: 'output.html',
    formula: 'L = N₂ · Wₒᵤₜᵀ',
    deps: ['norm2'], inputs: ['weights.Wout'],
    compute: (s, d) => matmul(d.norm2, transpose(s.weights.Wout)),
  },
  {
    id: 'probs', label: 'Probabilities', page: 'output.html',
    formula: 'P = softmax(L)',
    deps: ['logits'], inputs: [],
    compute: (s, d) => softmaxRows(d.logits),
  },
  {
    id: 'prediction', label: 'Prediction', page: 'output.html',
    formula: 'argmax(P)',
    deps: ['probs'], inputs: ['vocab'],
    compute: (s, d) => d.probs.map((row) => {
      const id = argmax(row);
      return { id, token: s.vocab[id], prob: row[id] };
    }),
  },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const STAGE_IDS = STAGES.map((s) => s.id);

const DEPENDENTS = {};
for (const stage of STAGES) {
  DEPENDENTS[stage.id] = DEPENDENTS[stage.id] || [];
  for (const dep of stage.deps) (DEPENDENTS[dep] = DEPENDENTS[dep] || []).push(stage.id);
}

// All stages downstream of (and including) the given stage ids, in pipeline order.
export function downstream(stageIds) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const child of DEPENDENTS[id] || []) visit(child);
  };
  for (const id of stageIds) visit(id);
  return STAGE_IDS.filter((id) => seen.has(id));
}

// Which stages must be recalculated when these persistent keys change?
// Keys are dot paths ('weights.Wq'), a prefix ('weights') or '*' for everything.
export function affectedStages(changedKeys) {
  if (changedKeys.includes('*')) return STAGE_IDS.slice();
  const roots = STAGES
    .filter((stage) => stage.inputs.some((input) =>
      changedKeys.some((key) => input === key || input.startsWith(key + '.'))))
    .map((stage) => stage.id);
  return downstream(roots);
}

// Compute derived values. When `prev` and `dirty` are given, stages not in
// `dirty` reuse the previous result (incremental recalculation).
export function forward(state, prev = null, dirty = null) {
  const derived = {};
  for (const stage of STAGES) {
    if (prev && dirty && !dirty.has(stage.id) && stage.id in prev) {
      derived[stage.id] = prev[stage.id];
    } else {
      derived[stage.id] = stage.compute(state, derived);
    }
  }
  return derived;
}

// Convenience view of the attention block, as used by the attention page.
export function forwardAttention(state) {
  const d = forward(state);
  return {
    X: d.positionalInput,
    Q: d.Q, K: d.K, V: d.V, KT: d.KT,
    scores: d.scores,
    scaledScores: d.scaledScores,
    attentionWeights: d.attentionWeights,
    output: d.attentionOutput,
  };
}

// ---------------------------------------------------------------------------
// Training (next-token prediction, numerical gradients)
// ---------------------------------------------------------------------------
// The model is tiny, so central finite differences over every parameter is
// cheap and keeps the code honest: the gradient is literally "how much does
// the loss change when I nudge this number".

export const TRAINABLE = ['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'b1', 'W2', 'b2', 'Wout'];

export function crossEntropy(probs, ids) {
  let total = 0;
  let count = 0;
  for (let t = 0; t < ids.length - 1; t++) {
    total += -Math.log(Math.max(probs[t][ids[t + 1]], 1e-12));
    count++;
  }
  return count ? total / count : 0;
}

export function lossOf(state) {
  const d = forward(state);
  return crossEntropy(d.probs, d.tokenIds);
}

function forEachParam(weights, fn) {
  for (const name of TRAINABLE) {
    const w = weights[name];
    if (!w) continue;
    if (Array.isArray(w[0])) {
      for (let r = 0; r < w.length; r++) for (let c = 0; c < w[r].length; c++) fn(w[r], c, name, r);
    } else {
      for (let c = 0; c < w.length; c++) fn(w, c, name, -1);
    }
  }
}

export function cloneWeights(weights) {
  return JSON.parse(JSON.stringify(weights));
}

export function numericalGradient(state, eps = 1e-4) {
  const work = { ...state, weights: cloneWeights(state.weights) };
  const grads = cloneWeights(state.weights);
  // Only rows actually used by the sentence can influence the loss;
  // skipping the rest keeps gradients exact and the loop short.
  const usedIds = new Set(state.tokenIds);
  const n = state.tokenIds.length;
  // Each nudge only invalidates the stages downstream of its table, so the
  // rest of the pipeline is reused from one baseline pass (a Wout nudge
  // recomputes three stages instead of twenty-one).
  const base = forward(work);
  const dirtyFor = Object.fromEntries(TRAINABLE.map((name) => [name, new Set(affectedStages([`weights.${name}`]))]));
  const lossWith = (name) => {
    const d = forward(work, base, dirtyFor[name]);
    return crossEntropy(d.probs, d.tokenIds);
  };
  forEachParam(work.weights, (row, c, name, r) => {
    const gradRow = r >= 0 ? grads[name][r] : grads[name];
    if (name === 'embedding' && !usedIds.has(r)) { gradRow[c] = 0; return; }
    if (name === 'positional' && r >= n) { gradRow[c] = 0; return; }
    const original = row[c];
    row[c] = original + eps;
    const plus = lossWith(name);
    row[c] = original - eps;
    const minus = lossWith(name);
    row[c] = original;
    gradRow[c] = (plus - minus) / (2 * eps);
  });
  return grads;
}

// ---------------------------------------------------------------------------
// Backpropagation: the same gradients as numericalGradient, computed exactly
// in one backward pass (tested against it). Each block below is the reverse
// of one line of the forward pass.
// ---------------------------------------------------------------------------

function zerosLike(m) { return Array.isArray(m[0]) ? m.map((r) => r.map(() => 0)) : m.map(() => 0); }
function addInto(target, src) { for (let i = 0; i < target.length; i++) for (let j = 0; j < target[i].length; j++) target[i][j] += src[i][j]; }

// y = (x − mean) / sqrt(var + eps), per row.  dx from dy.
function layerNormBackward(rows, dOut, eps = 1e-5) {
  return rows.map((row, i) => {
    const n = row.length;
    const mean = row.reduce((a, b) => a + b, 0) / n;
    const variance = row.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const inv = 1 / Math.sqrt(variance + eps);
    const y = row.map((v) => (v - mean) * inv);
    const dy = dOut[i];
    const meanDy = dy.reduce((a, b) => a + b, 0) / n;
    const meanDyY = dy.reduce((a, b, k) => a + b * y[k], 0) / n;
    return dy.map((g, k) => inv * (g - meanDy - y[k] * meanDyY));
  });
}

export function gradients(state) {
  const w = state.weights;
  const d = forward(state);
  const ids = d.tokenIds;
  const n = ids.length;
  const dim = state.config.dim;
  const count = Math.max(1, n - 1);

  // loss = mean_t −log P[t][ids[t+1]]  →  dLogits = (P − onehot) / count
  const dLogits = d.probs.map((row, t) => (t < n - 1 ? row.map((p, v) => (p - (v === ids[t + 1] ? 1 : 0)) / count) : row.map(() => 0)));
  // logits = N2 · Woutᵀ
  const dWout = matmul(transpose(dLogits), d.norm2);
  const dN2 = matmul(dLogits, w.Wout);
  // N2 = LN(R2), R2 = N1 + F
  const dR2 = layerNormBackward(d.residual2, dN2);
  const dF = dR2;
  const dN1 = dR2.map((r) => r.slice());
  // F = H · W2 + b2
  const dW2 = matmul(transpose(d.ffnHidden), dF);
  const db2 = dF.reduce((acc, r) => acc.map((v, j) => v + r[j]), zeros(dim));
  const dH = matmul(dF, transpose(w.W2));
  // H = relu(N1 · W1 + b1)
  const dHpre = dH.map((r, i) => r.map((g, j) => (d.ffnHidden[i][j] > 0 ? g : 0)));
  const dW1 = matmul(transpose(d.norm1), dHpre);
  const db1 = dHpre.reduce((acc, r) => acc.map((v, j) => v + r[j]), zeros(state.config.hidden));
  addInto(dN1, matmul(dHpre, transpose(w.W1)));
  // N1 = LN(R1), R1 = X + Z
  const dR1 = layerNormBackward(d.residual1, dN1);
  const dX = dR1.map((r) => r.slice());
  const dZ = dR1;
  // Z = A · V
  const dA = matmul(dZ, transpose(d.V));
  const dV = matmul(transpose(d.attentionWeights), dZ);
  // A = softmax(S) per row (masked cells have A = 0, so their dS = 0)
  const A = d.attentionWeights;
  const dS = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = A[i], g = dA[i], r = new Array(n);
    let dot = 0; for (let j = 0; j < n; j++) dot += g[j] * a[j];
    for (let j = 0; j < n; j++) r[j] = a[j] * (g[j] - dot);
    dS[i] = r;
  }
  // S = Q · Kᵀ / √d
  const scale = 1 / Math.sqrt(dim);
  const dQ = scaleMatrix(matmul(dS, d.K), scale);
  const dK = scaleMatrix(matmul(transpose(dS), d.Q), scale);
  // Q = X·Wq, K = X·Wk, V = X·Wv
  const X = d.positionalInput;
  const dWq = matmul(transpose(X), dQ);
  const dWk = matmul(transpose(X), dK);
  const dWv = matmul(transpose(X), dV);
  addInto(dX, matmul(dQ, transpose(w.Wq)));
  addInto(dX, matmul(dK, transpose(w.Wk)));
  addInto(dX, matmul(dV, transpose(w.Wv)));
  // X = E[ids] + P[pos]
  const dE = zerosLike(w.embedding);
  const dP = zerosLike(w.positional);
  dX.forEach((row, t) => { for (let j = 0; j < dim; j++) { dE[ids[t]][j] += row[j]; dP[t][j] += row[j]; } });

  return { embedding: dE, positional: dP, Wq: dWq, Wk: dWk, Wv: dWv, W1: dW1, b1: db1, W2: dW2, b2: db2, Wout: dWout, loss: crossEntropy(d.probs, ids) };
}

export function trainStep(state, learningRate) {
  const grads = gradients(state);
  const lossBefore = grads.loss;
  const weights = cloneWeights(state.weights);
  let gradNorm = 0;
  forEachParam(weights, (row, c, name, r) => {
    const g = r >= 0 ? grads[name][r][c] : grads[name][c];
    gradNorm += g * g;
    row[c] = round(row[c] - learningRate * g, 6);
  });
  const lossAfter = lossOf({ ...state, weights });
  return { weights, lossBefore, lossAfter, gradNorm: Math.sqrt(gradNorm) };
}

// ---------------------------------------------------------------------------
// Running the block on arbitrary token ids (playground / generation)
// ---------------------------------------------------------------------------
// Same graph, same weights; only the first two stages are supplied directly.
// Positional rows beyond what is stored are filled in deterministically and
// are never persisted.

export function forwardIds(state, ids) {
  const dim = state.config.dim;
  let positional = state.weights.positional;
  if (positional.length < ids.length) {
    positional = positional.slice();
    while (positional.length < ids.length) positional.push(sinusoidalPosition(positional.length, dim));
  }
  const s = positional === state.weights.positional ? state : { ...state, weights: { ...state.weights, positional } };
  const seed = { tokens: ids.map((id) => state.vocab[id]), tokenIds: ids.slice() };
  const dirty = new Set(STAGE_IDS.filter((id) => id !== 'tokens' && id !== 'tokenIds'));
  return forward(s, seed, dirty);
}

export function topK(row, k = 3) {
  return row.map((p, id) => ({ id, p })).sort((a, b) => b.p - a.p).slice(0, k);
}

function sampleFrom(row, temperature, rng) {
  if (temperature <= 0) return argmax(row);
  const logits = row.map((p) => Math.log(Math.max(p, 1e-12)) / temperature);
  const probs = softmaxRow(logits);
  let r = rng();
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return i; }
  return probs.length - 1;
}

// Autoregressive generation. Returns one record per generated token with the
// full probability row and the attention row of the position that produced it.
export function generate(state, promptIds, { steps = 5, temperature = 0, seed = 1 } = {}) {
  const rng = mulberry32(hashString(`gen|${seed}`));
  const ids = promptIds.slice();
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (ids.length === 0) break;
    const d = forwardIds(state, ids);
    const last = ids.length - 1;
    const row = d.probs[last];
    const id = sampleFrom(row, temperature, rng);
    out.push({
      id, token: state.vocab[id], prob: row[id], probs: row,
      attention: d.attentionWeights[last], context: ids.slice(),
    });
    ids.push(id);
  }
  return out;
}
