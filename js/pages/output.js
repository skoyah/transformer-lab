import { crossEntropy, lossOf, cloneWeights } from '../transformer.js';
import { getExperiment, getDerived, setWeightCell, setWeights, setLearningRate, setCausal, train, trainStepAsync, trainMany, untrainedExperiment, usedIds } from '../state.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, underHood, matrixTable, softmaxBars, compareToggle, compareOn, chapterNav, tokenLabelsWin, dimLabels, windowOf, sliceRows, lensBar, labOnly, recap } from '../ui.js';
import { player, chapterControls, pauseAll, SPEEDS } from '../player.js';
import { matmulScene, rowScene, predictionScene, vec } from '../scenes.js';

initPage('output.html');
const content = document.getElementById('content');
const STAGES_HERE = ['logits', 'probs', 'prediction'];
const nudge = { name: 'Wout', r: 0, c: 0 }; // which weight the "nudge one number" widget looks at

// Training runs one step per tick while "playing"; each step is computed in a
// Web Worker (the page stays responsive) and persisted as it lands.
const training = { running: false, timer: null, runSteps: 0, busy: false };
async function trainTick() {
  if (!training.running) return;
  const started = performance.now();
  training.busy = true;
  await trainStepAsync();
  training.busy = false;
  if (!training.running) return;
  training.runSteps++;
  const ms = SPEEDS[getExperiment().animation.speed] || SPEEDS.normal;
  training.timer = setTimeout(trainTick, Math.max(0, ms - (performance.now() - started)));
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
  const n = d.tokens.length;
  const win = windowOf(n);
  const toks = tokenLabelsWin(d.tokens, win);
  const W = (m) => sliceRows(m, win);
  const loss = crossEntropy(d.probs, d.tokenIds);
  const hits = d.prediction.slice(0, n - 1).filter((p, i) => p.token === d.tokens[i + 1]).length;
  const vocabLabels = s.vocab;
  const fresh = compareOn() ? untrainedExperiment() : null;
  // Columns: the pieces your text uses, plus one column for all other pieces.
  const used = usedIds();
  const V = s.vocab.length;
  const otherLabel = `other ×${V - used.length}`;
  const colsPlus = [...used.map((id) => vocabLabels[id]), otherLabel];
  const probsView = (M) => M.map((r) => [...used.map((id) => r[id]), r.reduce((a, v, id) => (used.includes(id) ? a : a + v), 0)]);
  const logitsView = (M) => M.map((r) => [...used.map((id) => r[id]), NaN]);
  const colOf = (id) => { const i = used.indexOf(id); return i >= 0 ? i : used.length; };

  // ---- The two-"the"s puzzle: a word that appears twice with different successors ----
  let puzzle = null;
  for (let i = 0; i < n - 1 && !puzzle; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      if (d.tokens[i] === d.tokens[j] && d.tokens[i + 1] !== d.tokens[j + 1]) { puzzle = { w: d.tokens[i], i, j, a: d.tokens[i + 1], b: d.tokens[j + 1] }; break; }
    }
  }
  const puzzleBox = puzzle
    ? callout('key', `<p><strong>Same word, two different answers — how?</strong> “${esc(puzzle.w)}” appears at position ${puzzle.i} and again at position ${puzzle.j}, followed once by “${esc(puzzle.a)}” and once by “${esc(puzzle.b)}”. Both copies start from the <em>same</em> embedding row. The only things that can tell them apart are the position pattern (Chapter 2) and what they gathered from the words before them (Chapter 3). Take those away and the model can be right at most once.</p>`, 'A puzzle', [
      { label: 'Zero the position table and allow peeking', run: () => { setWeights({ positional: getExperiment().weights.positional.map((r) => r.map(() => 0)) }); setCausal(false); }, then: 'prediction' },
      { label: 'Zero the position table only', run: () => setWeights({ positional: getExperiment().weights.positional.map((r) => r.map(() => 0)) }), then: 'prediction' },
    ])
    : callout('key', `<p><strong>A puzzle for your text:</strong> put the same piece in twice with different pieces after it (the default “the cat sat by the door” has “the”→cat and “the”→door). Both copies start from the same embedding row — only the position pattern and attention can tell them apart. Change the text on the Start page and come back.</p>`, 'A puzzle');

  // ---- Nudge one number: the gradient, done by hand ----
  if (nudge.name === 'Wout' && nudge.r === 0 && nudge.c === 0 && !nudge.touched) { nudge.r = d.prediction[n - 1].id; nudge.touched = true; }
  const nudgeName = nudge.name, nr = Math.min(nudge.r, s.weights[nudgeName].length - 1), nc = Math.min(nudge.c, (Array.isArray(s.weights[nudgeName][0]) ? s.weights[nudgeName][0].length : s.weights[nudgeName].length) - 1);
  const eps = 0.01;
  const nudged = (delta) => {
    const w = cloneWeights(s.weights);
    if (Array.isArray(w[nudgeName][0])) w[nudgeName][nr][nc] += delta; else w[nudgeName][nc] += delta;
    return lossOf({ ...s, weights: w });
  };
  const w0 = Array.isArray(s.weights[nudgeName][0]) ? s.weights[nudgeName][nr][nc] : s.weights[nudgeName][nc];
  const lPlus = nudged(eps), lMinus = nudged(-eps);
  const slope = (lPlus - lMinus) / (2 * eps);
  const step = -s.learningRate * slope;
  const names = ['Wout', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'embedding', 'positional', 'b1', 'b2'];
  const is1d = !Array.isArray(s.weights[nudgeName][0]);
  const nudgeBox = labOnly(el('div', { class: 'card nudge' }, [
    el('strong', { style: 'font: 600 14px/1.3 var(--sans)', text: 'Nudge one number yourself' }),
    el('p', { class: 'fig-caption', style: 'margin:.2rem 0 .7rem', text: 'The slow, honest way, for one number: the model is re-run with the weight a hair higher and a hair lower. Backpropagation gets the same slope for every number in one pass.' }),
    el('div', { class: 'controls' }, [
      el('label', {}, ['Table', el('select', { onchange: (e) => { nudge.name = e.target.value; nudge.r = 0; nudge.c = 0; render(); } }, names.map((k) => el('option', { value: k, text: k, selected: k === nudgeName })))]),
      is1d ? null : el('label', {}, ['Row', el('input', { type: 'number', min: 0, max: s.weights[nudgeName].length - 1, value: nr, onchange: (e) => { nudge.r = Math.max(0, Number(e.target.value) || 0); render(); } })]),
      el('label', {}, [is1d ? 'Index' : 'Column', el('input', { type: 'number', min: 0, value: nc, onchange: (e) => { nudge.c = Math.max(0, Number(e.target.value) || 0); render(); } })]),
    ]),
    el('div', { class: 'worked', style: 'margin-top:.8rem', html:
      `<span class="lhs">${nudgeName}${is1d ? `[${nc}]` : `[${nr}][${nc}]`}</span> <span class="eq">=</span> <b>${fmt(w0, 3)}</b> &nbsp; <span class="eq">surprise now</span> <b>${fmt(loss, 4)}</b><br>` +
      `<span class="eq">a hair higher (+${eps}):</span> <b>${fmt(lPlus, 4)}</b> &nbsp; <span class="eq">a hair lower (−${eps}):</span> <b>${fmt(lMinus, 4)}</b><br>` +
      `<span class="eq">slope =</span> (${fmt(lPlus, 4)} − ${fmt(lMinus, 4)}) ÷ ${2 * eps} <span class="eq">=</span> <b>${fmt(slope, 3)}</b> &nbsp; ` +
      `<span class="eq">so move it</span> <span class="result">${step >= 0 ? '+' : ''}${fmt(step, 4)}</span> <span class="eq">(−learning rate × slope) → </span> <b>${fmt(w0 + step, 3)}</b>` }),
    el('p', { class: 'fig-caption', style: 'margin:.5rem 0 0', text: slope > 0 ? 'Surprise rises when this number goes up, so training pushes it down.' : slope < 0 ? 'Surprise falls when this number goes up, so training pushes it up.' : 'This number has no effect on surprise right now (probably a row the text never uses).' }),
    el('div', { class: 'controls', style: 'margin-top:.6rem' }, [
      el('button', { class: 'primary', text: 'Apply this one nudge', onclick: () => setWeightCell(nudgeName, is1d ? 0 : nr, nc, Math.round((w0 + step) * 1e6) / 1e6) }),
      el('span', { class: 'fig-caption', style: 'margin:0', text: 'A full training step applies the nudge to every number at once.' }),
    ]),
  ]));

  const scoring = lesson('Score every word in the dictionary', [
    prose(`<p>Each token now has a final vector (N₂ from Chapter 4). To turn that into a guess about the next piece, we need one more table: <strong>Wout</strong>, with one row per piece in the dictionary — all ${V} of them. The score for a candidate piece is the dot product of the token's vector with that piece's row — the same “how well do these two match” operation attention used.</p>`),
    el('div', { class: 'card figure' }, [
      compareToggle(render),
      matrixTable({ title: 'Wout — one scoring row per piece', matrix: s.weights.Wout, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims, editable: true,
        rows: used, onEdit: (r, c, v) => setWeightCell('Wout', r, c, v), compare: fresh ? fresh.weights.Wout : null }),
      el('p', { class: 'fig-caption', text: `Sometimes called the “unembedding”: it maps from coordinates back to pieces. ${V} rows, one per piece in the dictionary; only the ${used.length} your text uses are shown, but every row is scored.` }),
    ]),
    lensBar(d.tokens),
    player({ id: 'logits', scene: matmulScene({
      A: W(d.norm2), B: used.map((id) => s.weights.Wout[id]), C: W(d.logits).map((r) => used.map((id) => r[id])), aTitle: 'N₂', bTitle: 'Wout', cTitle: 'Piece scores', aRows: toks, aCols: dims, bCols: used.map((id) => vocabLabels[id]), bByRow: true,
      idle: `Press play to score each candidate piece at each position. (Shown: the ${used.length} pieces in your text; the other ${V - used.length} rows of Wout are scored exactly the same way.)`,
      done: 'Row = the position we are standing at. Column = a candidate for the next piece.',
    }) }),
  ]);

  const betting = lesson('Turn scores into a bet', [
    prose(`<p>Softmax again — the same move as in attention — turns each row of scores into probabilities that add up to 100%. Now the model is making a proper bet: “after this word, I'd put 40% on <em>sat</em>, 25% on <em>the</em>…”. The favourite is its prediction.</p>`),
    player({ id: 'probs', scene: rowScene({
      inputs: [{ title: 'Piece scores', matrix: logitsView(W(d.logits)), rowLabels: toks, colLabels: colsPlus }],
      output: { title: 'Probabilities', matrix: probsView(W(d.probs)), rowLabels: toks, colLabels: colsPlus, heat: 'sequential', cornerLabel: 'after \\ piece' },
      idle: `Press play to turn each row of scores into a bet. The last column gathers the probability given to the ${V - used.length} pieces not in your text — a fresh model spreads its bets over all ${V}.`,
      explain: (i) => {
        const g = win.rows[i];
        const exps = d.logits[g].map((v) => Math.exp(v));
        const sum = exps.reduce((a, b) => a + b, 0);
        const top = d.logits[g].map((v, j) => j).sort((a, b) => d.logits[g][b] - d.logits[g][a]).slice(0, 12);
        return {
          caption: `Row <b>${g}</b> — after “${esc(d.tokens[g])}”: raise e (≈ 2.72) to each of the ${V} scores, divide by the total. (Bars show the 12 strongest candidates.)`,
          worked: `<span class="eq">e^scores (pieces in your text) =</span><span class="a">${vec(used.map((id) => exps[id]))}</span><span class="eq">sum over all ${V} =</span><b>${fmt(sum)}</b><span class="eq">bets =</span><span class="result">${vec(used.map((id) => d.probs[g][id]))}</span>`,
          extra: softmaxBars({ labels: top.map((j) => vocabLabels[j]), scores: top.map((j) => d.logits[g][j]), stepMs: SPEEDS[s.animation.speed] || SPEEDS.normal }),
        };
      },
      done: 'Rows sum to 1.',
    }) }),
    player({ id: 'prediction', scene: predictionScene({ probs: probsView(W(d.probs)), vocab: colsPlus, tokens: W(d.tokens), prediction: W(d.prediction).map((p) => ({ ...p, id: colOf(p.id) })), nextTokens: win.rows.map((g) => (g + 1 < n ? d.tokens[g + 1] : null)), offset: win.start,
      idle: 'Press play to pick the favourite at each position and check it against the text.' }) }),
    el('p', { class: 'fig-caption', text: `${hits} of ${n - 1} next pieces guessed right.${s.config.causal ? '' : ' Careful: “no peeking” is off, so the model can see the answer — turn it on in Chapter 3 for an honest test.'}` }),
    puzzleBox,
  ]);

  const lr = el('input', { type: 'number', value: s.learningRate, step: 0.01, min: 0.001, onchange: (e) => setLearningRate(e.target.value) });
  const paramCount = ['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'Wout'].reduce((acc, k) => acc + s.weights[k].flat().length, 0) + s.weights.b1.length + s.weights.b2.length;
  const baseline = Math.log(s.vocab.length);
  const t = Math.min(n - 2, 1);
  const pActual = d.probs[t][d.tokenIds[t + 1]];

  const learning = lesson('Teach it to bet better', [
    prose(`<p>How wrong is the model? We measure its <strong>surprise</strong>: for each position, take the probability it gave to the word that actually came next and ask “how unlikely did it think that was?” Give the right word 100% and surprise is 0; 50% is 0.69; 10% is 2.3; 1% is 4.6. (It's −log of the probability.) Averaged over the text, that single number is what training tries to push down. Its formal name is cross-entropy loss.</p>`),
    el('div', { class: 'worked', html: `<span class="lhs">surprise at position ${t}</span><span class="eq">=</span> −log P(“${esc(d.tokens[t + 1])}” after “${esc(d.tokens[t])}”) <span class="eq">=</span> −log <b>${fmt(pActual, 3)}</b> <span class="eq">=</span> <span class="result">${fmt(-Math.log(Math.max(pActual, 1e-12)))}</span> &nbsp; <span class="eq">— guessing evenly among the ${s.vocab.length} pieces would be −log(1/${s.vocab.length}) = ${fmt(baseline)}</span>` }),
    prose(`<p>Training is remarkably unglamorous. For every one of the ${paramCount} numbers in the weight tables, ask “if I nudged this up a hair, would surprise go up or down?” — then move it a small step the helpful way. The size of that step is the <strong>learning rate</strong>. Repeat.</p>
      <p>Trying every nudge one by one works but is slow (two full runs per number). There is a trick: the chain rule lets you get every slope from a <em>single</em> pass backwards through the stages — <strong>backpropagation</strong>. That is what the buttons below use. The widget after the analogy does it the slow way for one number, so you can see they agree.</p>`),
    callout('idea', `<p>It's tuning an instrument with ${paramCount} pegs at once. Trying each peg by ear works; backpropagation is like knowing, from the way the chord sounds, which way every peg should turn — all at once, from one listen.</p>`),
    nudgeBox,
    el('div', { class: `card player ${training.running ? 'playing' : ''}`, dataset: { stage: 'training' } }, [
      el('div', { class: 'kpis' }, [
        el('div', {}, [el('b', { text: fmt(loss, 3) }), el('span', { text: 'surprise right now (lower is better)' })]),
        el('div', {}, [el('b', { text: `${hits}/${n - 1}` }), el('span', { text: 'next pieces correct' })]),
        el('div', {}, [el('b', { text: `${s.trainingHistory.length}` }), el('span', { text: 'training steps so far' })]),
      ]),
      sparkline(s.trainingHistory),
      el('div', { class: 'player-bar' }, [
        el('button', { class: 'pbtn', title: 'One training step', 'aria-label': 'One training step', html: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3l7 5-7 5z"/></svg>', onclick: () => { pauseAll(); trainStepAsync(); } }),
        training.running
          ? el('button', { class: 'pbtn', style: 'width:auto; padding:0 .8rem; background:var(--warm); border-color:var(--warm); color:#fff', text: 'Pause training', onclick: stopTraining })
          : el('button', { class: 'pbtn', style: 'width:auto; padding:0 .8rem; background:var(--accent); border-color:var(--accent); color:#fff', text: 'Train continuously', onclick: startTraining }),
        el('span', { class: 'counter', text: training.running ? `${training.runSteps} this run` : '' }),
        el('label', { class: 'inline', style: 'margin-left:auto' }, ['Learning rate', lr]),
      ]),
      el('p', { class: 'fig-caption', text: 'Every step rewrites the saved weight tables, so every stage in this book goes back to waiting: the embeddings moved, the attention pattern shifted, the bets sharpened. Replay any of them to see the new numbers.' }),
    ]),
    callout('try', `<ul>
      <li>Train for a while, then replay the prediction stage above. Watch the ✓ column fill in and the surprise curve fall towards 0. Then revisit Chapter 2 — the embedding rows have moved (turn on “compare with the untrained model”).</li>
      <li>Set the learning rate to 1 and train. Too big a step overshoots: surprise may jump <em>up</em>. Bring it back to 0.1.</li>
      <li>Bookmark the model on the Start page before training, so you can compare before and after in Chapter 6.</li>
    </ul>`, null, [
      { label: 'Train 10 steps now', run: () => { pauseAll(); trainMany(10); }, then: 'prediction' },
      { label: 'Learning rate → 1', run: () => setLearningRate(1) },
      { label: 'Learning rate → 0.1', run: () => setLearningRate(0.1) },
    ]),
    callout('key', `<p>A language model is nothing more than “predict the next token”, trained by nudging weights to be less surprised by real text. Everything it appears to know is a side effect of getting good at that one game.</p>`),
    underHood('loss = mean over t of −log P[t][ id[t+1] ]        w ← w − lr · ∂loss/∂w', `<p>Gradients come from backpropagation (js/transformer.js, <code>gradients()</code>): softmax + cross-entropy → output projection → layer norm → feed-forward → layer norm → attention (softmax, scaling, Q/K/V) → embeddings and positions, each block the exact reverse of its forward line. The test suite checks it against central finite differences, (loss(w+ε) − loss(w−ε)) / 2ε, to 1e-6.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), scoring, betting, learning, recap([
    `Every piece in the dictionary gets a score from the token’s final row; softmax turns the ${s.vocab.length} scores into a bet.`,
    '<strong>Surprise</strong> is how unlikely the model found the real next piece; training nudges every weight to lower it.',
    'That single game — predict the next piece — is all a language model is trained on. Using it afterwards (inference) changes nothing.',
  ]), chapterNav('output.html'));
}

bindRender(render, { quietKeys: ['view'] });
