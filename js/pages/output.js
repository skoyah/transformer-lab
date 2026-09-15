import { crossEntropy } from '../transformer.js';
import { getExperiment, getDerived, setWeightCell, setLearningRate, train } from '../state.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, underHood, matrixTable, softmaxBars, chapterNav, tokenLabels, dimLabels } from '../ui.js';
import { player, chapterControls, pauseAll, SPEEDS } from '../player.js';
import { matmulScene, rowScene, predictionScene, vec } from '../scenes.js';

initPage('output.html');
const content = document.getElementById('content');
const STAGES_HERE = ['logits', 'probs', 'prediction'];

// Training runs one step per tick while "playing"; each step is persisted.
const training = { running: false, timer: null, runSteps: 0 };
function trainTick() {
  if (!training.running) return;
  train(1);
  training.runSteps++;
  const ms = SPEEDS[getExperiment().animation.speed] || SPEEDS.normal;
  training.timer = setTimeout(trainTick, ms);
}
function startTraining() { if (training.running) return; pauseAll(); training.running = true; training.runSteps = 0; trainTick(); }
function stopTraining() { training.running = false; clearTimeout(training.timer); render(); }

function sparkline(history) {
  const w = 440, h = 90, pad = 8;
  const baseline = Math.log(getExperiment().vocab.length);
  if (history.length < 2) return el('p', { class: 'note', style: 'max-width:none', text: `Train a few steps and the surprise curve appears here. Guessing evenly among ${getExperiment().vocab.length} words would score ${baseline.toFixed(2)}.` });
  const losses = history.map((x) => x.loss);
  const min = Math.min(...losses, 0), max = Math.max(...losses, baseline);
  const y = (l) => h - pad - ((l - min) / (max - min || 1)) * (h - 2 * pad);
  const pts = losses.map((l, i) => `${(pad + (i / (losses.length - 1)) * (w - 2 * pad)).toFixed(1)},${y(l).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'sparkline');
  svg.innerHTML = `<line x1="${pad}" x2="${w - pad}" y1="${y(baseline)}" y2="${y(baseline)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`
    + `<text x="${w - pad}" y="${y(baseline) - 4}" text-anchor="end" font-size="10" font-family="Inter, system-ui" fill="var(--muted)">guessing evenly = ${baseline.toFixed(2)}</text>`
    + `<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/>`
    + `<text x="${pad}" y="13" font-size="11" font-family="Inter, system-ui" fill="var(--muted)">surprise over ${history.length} steps: ${losses[0].toFixed(2)} → ${losses.at(-1).toFixed(2)}</text>`;
  return svg;
}

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const toks = tokenLabels(d);
  const loss = crossEntropy(d.probs, d.tokenIds);
  const n = d.tokens.length;
  const hits = d.prediction.slice(0, n - 1).filter((p, i) => p.token === d.tokens[i + 1]).length;
  const vocabLabels = s.vocab;

  const scoring = lesson('Score every word in the dictionary', [
    prose(`<p>Each token now has a final vector (N₂ from Chapter 4). To turn that into a guess about the next word, we need one more table: <strong>Wout</strong>, with one row per dictionary word. The score for a candidate word is the dot product of the token's vector with that word's row — the same “how well do these two match” operation attention used.</p>`),
    el('div', { class: 'card figure' }, [
      matrixTable({ title: 'Wout — one scoring row per word', matrix: s.weights.Wout, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims, editable: true,
        highlightRows: new Set(s.tokenIds), onEdit: (r, c, v) => setWeightCell('Wout', r, c, v) }),
      el('p', { class: 'fig-caption', text: 'Sometimes called the “unembedding”: it maps from coordinates back to words.' }),
    ]),
    player({ id: 'logits', scene: matmulScene({
      A: d.norm2, B: s.weights.Wout, C: d.logits, aTitle: 'N₂', bTitle: 'Wout', cTitle: 'Scores', aRows: toks, aCols: dims, bCols: vocabLabels, bByRow: true,
      idle: 'Press play to score each candidate word at each position.',
      done: 'Row = the position we are standing at. Column = a candidate for the next word.',
    }) }),
  ]);

  const betting = lesson('Turn scores into a bet', [
    prose(`<p>Softmax again — the same move as in attention — turns each row of scores into probabilities that add up to 100%. Now the model is making a proper bet: “after this word, I'd put 40% on <em>sat</em>, 25% on <em>the</em>…”. The favourite is its prediction.</p>`),
    player({ id: 'probs', scene: rowScene({
      inputs: [{ title: 'Scores', matrix: d.logits, rowLabels: toks, colLabels: vocabLabels }],
      output: { title: 'Probabilities', matrix: d.probs, rowLabels: toks, colLabels: vocabLabels, heat: 'sequential', cornerLabel: 'after \\ word' },
      idle: 'Press play to turn each row of scores into a bet.',
      explain: (i) => {
        const exps = d.logits[i].map((v) => Math.exp(v));
        const sum = exps.reduce((a, b) => a + b, 0);
        return {
          caption: `Row <b>${i}</b> — after “${esc(d.tokens[i])}”: e to each score, divide by the total.`,
          worked: `<span class="eq">e^scores =</span><span class="a">${vec(exps)}</span><span class="eq">sum =</span><b>${fmt(sum)}</b><span class="eq">bets =</span><span class="result">${vec(d.probs[i])}</span>`,
          extra: softmaxBars({ labels: vocabLabels, scores: d.logits[i], stepMs: SPEEDS[s.animation.speed] || SPEEDS.normal }),
        };
      },
      done: 'Rows sum to 1.',
    }) }),
    player({ id: 'prediction', scene: predictionScene({ probs: d.probs, vocab: vocabLabels, tokens: d.tokens, prediction: d.prediction,
      idle: 'Press play to pick the favourite at each position and check it against the text.' }) }),
    el('p', { class: 'fig-caption', text: `${hits} of ${n - 1} next words guessed right.${s.config.causal ? '' : ' Careful: “no peeking” is off, so the model can see the answer — turn it on in Chapter 3 for an honest test.'}` }),
  ]);

  const lr = el('input', { type: 'number', value: s.learningRate, step: 0.01, min: 0.001, onchange: (e) => setLearningRate(e.target.value) });
  const paramCount = ['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'Wout'].reduce((acc, k) => acc + s.weights[k].flat().length, 0) + s.weights.b1.length + s.weights.b2.length;
  const baseline = Math.log(s.vocab.length);
  const t = Math.min(n - 2, 1);
  const pActual = d.probs[t][d.tokenIds[t + 1]];

  const learning = lesson('Teach it to bet better', [
    prose(`<p>How wrong is the model? We measure its <strong>surprise</strong>: for each position, take the probability it gave to the word that actually came next and ask “how unlikely did it think that was?” Give the right word 100% and surprise is 0; 50% is 0.69; 10% is 2.3; 1% is 4.6. (It's −log of the probability.) Averaged over the text, that single number is what training tries to push down. Its formal name is cross-entropy loss.</p>`),
    el('div', { class: 'worked', html: `<span class="lhs">surprise at position ${t}</span><span class="eq">=</span> −log P(“${esc(d.tokens[t + 1])}” after “${esc(d.tokens[t])}”) <span class="eq">=</span> −log <b>${fmt(pActual, 3)}</b> <span class="eq">=</span> <span class="result">${fmt(-Math.log(Math.max(pActual, 1e-12)))}</span> &nbsp; <span class="eq">— guessing evenly among ${s.vocab.length} words would be −log(1/${s.vocab.length}) = ${fmt(baseline)}</span>` }),
    prose(`<p>Training is remarkably unglamorous. For every one of the ${paramCount} numbers in the weight tables, ask “if I nudged this up a hair, would surprise go up or down?” — then move it a small step the helpful way. The size of that step is the <strong>learning rate</strong>. Repeat.</p>`),
    callout('idea', `<p>It's tuning an instrument with ${paramCount} pegs at once, by ear: turn each peg a fraction, keep it if the chord sounds better. Real models compute all the nudges in one clever pass (backpropagation); here we honestly try each one, which is fine when the model is tiny.</p>`),
    el('div', { class: `card player ${training.running ? 'playing' : ''}`, dataset: { stage: 'training' } }, [
      el('div', { class: 'kpis' }, [
        el('div', {}, [el('b', { text: fmt(loss, 3) }), el('span', { text: 'surprise right now (lower is better)' })]),
        el('div', {}, [el('b', { text: `${hits}/${n - 1}` }), el('span', { text: 'next words correct' })]),
        el('div', {}, [el('b', { text: `${s.trainingHistory.length}` }), el('span', { text: 'training steps so far' })]),
      ]),
      sparkline(s.trainingHistory),
      el('div', { class: 'player-bar' }, [
        el('button', { class: 'pbtn', title: 'One training step', 'aria-label': 'One training step', html: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3l7 5-7 5z"/></svg>', onclick: () => { pauseAll(); train(1); } }),
        training.running
          ? el('button', { class: 'pbtn', style: 'width:auto; padding:0 .8rem; background:var(--warm); border-color:var(--warm); color:#fff', text: 'Pause training', onclick: stopTraining })
          : el('button', { class: 'pbtn', style: 'width:auto; padding:0 .8rem; background:var(--accent); border-color:var(--accent); color:#fff', text: 'Train continuously', onclick: startTraining }),
        el('span', { class: 'counter', text: training.running ? `${training.runSteps} this run` : '' }),
        el('label', { class: 'inline', style: 'margin-left:auto' }, ['Learning rate', lr]),
      ]),
      el('p', { class: 'fig-caption', text: 'Every step rewrites the saved weight tables, so every stage in this book goes back to waiting: the embeddings moved, the attention pattern shifted, the bets sharpened. Replay any of them to see the new numbers.' }),
    ]),
    callout('try', `<ul>
      <li>Train for a while, then replay the prediction stage above. Watch the ✓ column fill in and the surprise curve fall towards 0. Then revisit Chapter 3 — the attention pattern has reorganised itself.</li>
      <li>Set the learning rate to 1 and train. Too big a step overshoots: surprise may jump <em>up</em>. Bring it back to 0.1.</li>
      <li>Bookmark the model on the Start page before training, so you can compare before and after in Chapter 6.</li>
    </ul>`),
    callout('key', `<p>A language model is nothing more than “predict the next token”, trained by nudging weights to be less surprised by real text. Everything it appears to know is a side effect of getting good at that one game.</p>`),
    underHood('loss = mean over t of −log P[t][ id[t+1] ]        w ← w − lr · ∂loss/∂w', `<p>Gradients here are central finite differences, (loss(w+ε) − loss(w−ε)) / 2ε, computed for every parameter. Slow but transparent — the whole forward pass is re-run for each nudge.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), scoring, betting, learning, chapterNav('output.html'));
}

bindRender(render);
