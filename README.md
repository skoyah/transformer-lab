# Transformer Lab

One tiny transformer block, every number visible and editable. Vanilla ES modules, no build step.

```
npm start      # python3 -m http.server 8000  → http://localhost:8000
npm test       # node --test test/
```

ES modules need an HTTP origin; opening `index.html` via `file://` will not work.

## Layout

| File | Role |
|---|---|
| `js/transformer.js` | Pure maths + the dependency graph (`STAGES`). No DOM, no storage. `forward(state)`, `forwardAttention(state)`, `affectedStages(keys)`, `trainStep(state, lr)`. |
| `js/state.js` | Owns persistent state, reads/writes `localStorage`, snapshots, derived-value cache. Single write path: `commit(changedKeys)` → save → invalidate via graph → notify. |
| `js/ui.js` | Shared rendering: nav, matrix tables (heat-mapped, editable), stage sections, the visible recalculation log. |
| `js/pages/*.js` | One script per chapter. Pages call `getExperiment()` / `getDerived()` and render prose + live figures; they contain no maths. |

## Chapters

0. Start here — your text, how to read, journey at a glance, settings, bookmarks
1. Tokens · 2. Embeddings · 3. Attention · 4. Thinking (residual/norm/FFN) · 5. Predicting (+ training)
6. Put it to work — phone-keyboard next-word suggestions and autocomplete, fresh (untrained) model vs your trained model side by side

## Persistent vs derived

**Persistent** (in `localStorage` under `transformer-lab:experiment:v1`): sentence, vocabulary, token IDs, seed, model config (`dim`, `hidden`, `causal`), learning rate, all weights (`embedding`, `positional`, `Wq`, `Wk`, `Wv`, `W1`, `b1`, `W2`, `b2`, `Wout`), training history, snapshots, animation preferences, current step.

**Derived** (never stored): tokens, embeddings, X, Q/K/V, Kᵀ, scores, scaled scores, softmax, attention output, residuals, layer norms, FFN hidden/output, logits, probabilities, prediction. Recomputed from `STAGES` in `transformer.js`; only the stages downstream of a changed input are recalculated (`forward(state, prev, dirty)`).

Snapshots store the persistent experiment only; loading one rebuilds the model and recomputes everything.
