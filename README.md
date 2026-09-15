# Transformer Lab

**Read it live:** https://skoyah.github.io/transformer-lab/

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
| `js/ui.js` | Shared rendering: nav, prose/callouts, matrix tables (heat-mapped, editable, step highlights), the "what just changed" panel. |
| `js/player.js` | Step-through players (nan.fyi style): idle until played, ⏮ ◀ ▶ ▶\| ⏭, counter, scrubber, speed; chapter-level play/reveal/reset. |
| `js/scenes.js` | Turns a computed stage into captioned steps (one cell / row / token per step) for the players. |
| `js/pages/*.js` | One script per chapter. Pages call `getExperiment()` / `getDerived()` and render prose + live figures; they contain no maths. |

## Chapters

0. Start here — your text, how to read, journey at a glance, settings, bookmarks
1. Tokens (words / characters / BPE subwords) · 2. Embeddings · 3. Attention · 4. Thinking (residual/norm/FFN) · 5. Predicting (+ training)
6. Put it to work — phone-keyboard next-word suggestions and autocomplete, fresh (untrained) model vs your trained model side by side

## Persistent vs derived

**Persistent** (in `localStorage` under `transformer-lab:experiment:v1`): sentence, vocabulary, token IDs, seed, model config (`dim`, `hidden`, `causal`), learning rate, all weights (`embedding`, `positional`, `Wq`, `Wk`, `Wv`, `W1`, `b1`, `W2`, `b2`, `Wout`), training history, snapshots, animation preferences, current step.

**Derived** (never stored): tokens, embeddings, X, Q/K/V, Kᵀ, scores, scaled scores, softmax, attention output, residuals, layer norms, FFN hidden/output, logits, probabilities, prediction. Recomputed from `STAGES` in `transformer.js`; only the stages downstream of a changed input are recalculated (`forward(state, prev, dirty)`).

Snapshots store the persistent experiment only; loading one rebuilds the model and recomputes everything.

## Interaction

- Every stage is a step-through player; each step animates (source cells fly into the result, highlights slide, numbers count up). Space / ←→ / Home / End control a focused player; "Play this chapter" runs them in order.
- Hover any computed cell to see its inputs and arithmetic; numbers in captions link to their cells.
- Weight tables: click to type, ↑/↓ to nudge (Shift ±1, Alt ±0.01), or drag sideways to scrub. ⌘Z / Ctrl-Z undoes any model change; "Try it" boxes apply experiments with one click.
- Chapter 3 draws attention as arcs over the sentence; softmax is shown as a bar race; layer norm as a number-line strip; the causal mask as a curtain.
- Chapter 6 compares a fresh and the trained model in lockstep, with a training timeline scrubber (deterministic replay), ghost training text and a "hesitating between N words" gauge.
- Start page: a flow diagram generated from the dependency graph; the nav shows how many stages you have played. "Copy share link" packs the whole experiment into a URL; "Copy as NumPy" gives the weights and a forward pass as Python.
- "Compare with the untrained model" toggles on E, the attention heatmap and Wout show which numbers training moved; Chapter 5 has a "nudge one number" widget (the gradient by hand) and the two-"the"s puzzle; Chapter 3 has attention presets; Chapter 4 lists what each hidden unit fires for.
- Training runs in a Web Worker with an incremental-graph numerical gradient (a Wout nudge recomputes 3 stages, not 21).
- One tokenizer, the common one: byte-pair-encoding subwords, with 300 merges learned once from a small original English corpus (`js/corpus.js`) — Chapter 1 has a player that performs the merges (count every occurrence, then glue), a tokenise-anything box, and the "why chatbots can't count the r's in strawberry" consequence; prompts are tokenised the same way.
- Training uses backpropagation (`gradients()` in transformer.js, tested against finite differences); the "nudge one number" widget still does the slow way for one weight.
- Texts up to 2,000 tokens: the maths runs on all of it; tables show a sliding 8–24 position window (the lens), with an "earlier" column that gathers attention to positions before the window.

## Playback model

Nothing is shown until the reader presses play on a stage. Each stage reveals its result one small step at a time with a caption for that step. Changing any input (text, weight, setting) puts every downstream stage back to idle — upstream stages keep their state. A stage played to the end stays revealed (`progress` in localStorage) until something upstream changes.
