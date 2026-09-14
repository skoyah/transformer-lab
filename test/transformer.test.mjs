import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, STAGE_IDS, forward, affectedStages, downstream, softmaxRows, layerNorm, matmul, transpose,
  tokenize, extendVocab, lossOf, trainStep, seededRow,
} from '../js/transformer.js';
import {
  createExperiment, getExperiment, getDerived, setSentence, setWeightCell, setModelConfig, setCausal,
  saveSnapshot, loadSnapshot, onChange, train,
} from '../js/state.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('stages are topologically ordered and deps exist', () => {
  const seen = new Set();
  for (const s of STAGES) {
    for (const d of s.deps) assert.ok(seen.has(d), `${s.id} depends on ${d} before it is defined`);
    seen.add(s.id);
  }
});

test('linear algebra basics', () => {
  assert.deepEqual(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]]);
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
  const sm = softmaxRows([[1, 2, 3], [0, -Infinity, 0]]);
  close(sm[0].reduce((a, b) => a + b), 1);
  assert.equal(sm[1][1], 0);
  close(sm[1][0], 0.5);
  const ln = layerNorm([[1, 2, 3, 4]]);
  close(ln[0].reduce((a, b) => a + b), 0, 1e-9);
});

test('tokenize + vocab keeps stable ids', () => {
  assert.deepEqual(tokenize('The cat, sat.'), ['the', 'cat', ',', 'sat', '.']);
  const v1 = extendVocab([], tokenize('the cat sat'));
  const v2 = extendVocab(v1, tokenize('the dog sat'));
  assert.deepEqual(v2, ['the', 'cat', 'sat', 'dog']);
});

test('seeded rows are deterministic', () => {
  assert.deepEqual(seededRow(42, 'Wq', 0, 4, 1), seededRow(42, 'Wq', 0, 4, 1));
  assert.notDeepEqual(seededRow(42, 'Wq', 0, 4, 1), seededRow(43, 'Wq', 0, 4, 1));
});

test('forward computes full pipeline with correct shapes', () => {
  const s = createExperiment();
  const d = forward(s);
  const n = s.tokenIds.length;
  assert.equal(d.Q.length, n);
  assert.equal(d.Q[0].length, s.config.dim);
  assert.equal(d.scores.length, n);
  assert.equal(d.scores[0].length, n);
  assert.equal(d.ffnHidden[0].length, s.config.hidden);
  assert.equal(d.probs[0].length, s.vocab.length);
  for (const row of d.attentionWeights) close(row.reduce((a, b) => a + b), 1);
  // causal: no attention to future
  assert.equal(d.attentionWeights[0][1], 0);
  assert.ok(d.prediction.every((p) => typeof p.token === 'string'));
});

test('affectedStages follows the dependency graph', () => {
  const fromWq = affectedStages(['weights.Wq']);
  assert.deepEqual(fromWq.slice(0, 4), ['Q', 'scores', 'scaledScores', 'attentionWeights']);
  assert.ok(!fromWq.includes('K'));
  assert.ok(!fromWq.includes('V'));
  assert.ok(fromWq.includes('prediction'));
  assert.deepEqual(affectedStages(['weights.Wk']).slice(0, 2), ['K', 'KT']);
  assert.deepEqual(affectedStages(['sentence']), STAGE_IDS);
  assert.deepEqual(affectedStages(['weights']), downstream(['embeddings', 'positionalInput', 'Q', 'K', 'V', 'ffnHidden', 'ffnOutput', 'logits']));
  assert.deepEqual(affectedStages(['learningRate']), []);
});

test('incremental forward equals full forward', () => {
  const s = createExperiment();
  const before = forward(s);
  s.weights.Wq[0][0] += 0.3;
  const dirty = new Set(affectedStages(['weights.Wq']));
  const incremental = forward(s, before, dirty);
  const full = forward(s);
  assert.deepEqual(incremental, full);
  assert.strictEqual(incremental.K, before.K); // reused, not recomputed
  assert.notDeepEqual(incremental.Q, before.Q);
});

test('training reduces loss', () => {
  const s = createExperiment();
  const before = lossOf(s);
  const { weights, lossAfter } = trainStep(s, 0.1);
  assert.ok(lossAfter < before, `${lossAfter} < ${before}`);
  assert.equal(weights.Wq.length, s.config.dim);
});

test('state: edits invalidate derived values through the graph', () => {
  const events = [];
  const off = onChange((e) => events.push(e));
  const d0 = getDerived();
  const qBefore = JSON.stringify(d0.Q);
  const kBefore = d0.K;
  setWeightCell('Wq', 0, 0, 9);
  const d1 = getDerived();
  assert.notEqual(JSON.stringify(d1.Q), qBefore);
  assert.strictEqual(d1.K, kBefore);
  assert.equal(events.at(-1).affected[0], 'Q');

  setSentence('the dog sat on the log');
  const s = getExperiment();
  assert.deepEqual(s.vocab.slice(0, 5), ['the', 'cat', 'sat', 'on', 'mat']);
  assert.ok(s.vocab.includes('dog') && s.vocab.includes('log'));
  assert.equal(s.weights.embedding.length, s.vocab.length);
  assert.equal(s.weights.Wout.length, s.vocab.length);
  assert.equal(getDerived().tokens.length, 6);

  setCausal(false);
  assert.ok(getDerived().attentionWeights[0][1] > 0);
  setCausal(true);
  off();
});

test('state: snapshot round-trip reproduces derived values', () => {
  const snap = saveSnapshot('before');
  const target = JSON.stringify(getDerived().probs);
  setWeightCell('Wv', 1, 1, -3);
  assert.notEqual(JSON.stringify(getDerived().probs), target);
  loadSnapshot(snap.id);
  assert.equal(JSON.stringify(getDerived().probs), target);
  assert.ok(!('Q' in snap.experiment), 'snapshot stores no derived values');
  assert.ok(!('probs' in snap.experiment));
});

test('state: model config change re-initialises weights', () => {
  setModelConfig({ dim: 6 });
  const s = getExperiment();
  assert.equal(s.weights.Wq.length, 6);
  assert.equal(getDerived().Q[0].length, 6);
  const ev = train(1);
  assert.equal(ev.steps, 1);
  assert.equal(s.trainingHistory.length, 1);
});

test('forwardIds + generate run on arbitrary prompts', async () => {
  const { forwardIds, generate } = await import('../js/transformer.js');
  const s = createExperiment();
  const ids = [0, 1];
  const d = forwardIds(s, ids);
  assert.equal(d.probs.length, 2);
  const longer = forwardIds(s, Array.from({ length: 12 }, () => 0)); // beyond stored positions
  assert.equal(longer.probs.length, 12);
  assert.equal(s.weights.positional.length, 8, 'stored positional table untouched');
  const out = generate(s, ids, { steps: 3, temperature: 0 });
  assert.equal(out.length, 3);
  assert.ok(out.every((g) => typeof g.token === 'string' && g.attention.length === g.context.length));
  const a = generate(s, ids, { steps: 3, temperature: 1, seed: 7 });
  const b = generate(s, ids, { steps: 3, temperature: 1, seed: 7 });
  assert.deepEqual(a.map((g) => g.id), b.map((g) => g.id), 'sampling is seeded');
});
