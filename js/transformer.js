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
  return A[0].map((_, j) => A.map((row) => row[j]));
}

export function addMatrices(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

export function addBias(A, b) {
  return A.map((row) => row.map((v, j) => v + b[j]));
}

export function scaleMatrix(A, s) {
  return A.map((row) => row.map((v) => v * s));
}

export function relu(A) {
  return A.map((row) => row.map((v) => (v > 0 ? v : 0)));
}

export function causalMask(A) {
  // Position i may only attend to positions <= i.
  return A.map((row, i) => row.map((v, j) => (j > i ? -Infinity : v)));
}

export function softmaxRow(row) {
  let max = -Infinity;
  for (const v of row) if (v > max) max = v;
  if (max === -Infinity) return row.map(() => 0);
  const exps = row.map((v) => (v === -Infinity ? 0 : Math.exp(v - max)));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function softmaxRows(A) {
  return A.map(softmaxRow);
}

export function layerNorm(A, eps = 1e-5) {
  return A.map((row) => {
    const n = row.length;
    const mean = row.reduce((a, b) => a + b, 0) / n;
    const variance = row.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const denom = Math.sqrt(variance + eps);
    return row.map((v) => (v - mean) / denom);
  });
}

export function argmax(row) {
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i] > row[best]) best = i;
  return best;
}

// ---------------------------------------------------------------------------
// Tokens / vocabulary / positions
// ---------------------------------------------------------------------------

export function tokenize(sentence) {
  return (sentence || '').toLowerCase().match(/[a-z0-9']+|[^\sa-z0-9']/g) || [];
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
    deps: [], inputs: ['sentence'],
    compute: (s) => tokenize(s.sentence),
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
    compute: (s, d) => {
      const scaled = scaleMatrix(d.scores, 1 / Math.sqrt(s.config.dim));
      return s.config.causal ? causalMask(scaled) : scaled;
    },
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
  forEachParam(work.weights, (row, c, name, r) => {
    const gradRow = r >= 0 ? grads[name][r] : grads[name];
    if (name === 'embedding' && !usedIds.has(r)) { gradRow[c] = 0; return; }
    if (name === 'positional' && r >= n) { gradRow[c] = 0; return; }
    const original = row[c];
    row[c] = original + eps;
    const plus = lossOf(work);
    row[c] = original - eps;
    const minus = lossOf(work);
    row[c] = original;
    gradRow[c] = (plus - minus) / (2 * eps);
  });
  return grads;
}

export function trainStep(state, learningRate) {
  const lossBefore = lossOf(state);
  const grads = numericalGradient(state);
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
