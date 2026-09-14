import { crossEntropy } from '../transformer.js';
import { getExperiment, getDerived, setWeightCell, setLearningRate, train } from '../state.js';
import {
  initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, underHood, figure, matrixTable,
  dotExample, chapterNav, tokenLabels, dimLabels,
} from '../ui.js';

initPage('output.html');
const content = document.getElementById('content');

function sparkline(history) {
  if (history.length < 2) return el('p', { class: 'note', style: 'max-width:none', text: 'Train a few steps and the surprise curve appears here.' });
  const w = 440, h = 90, pad = 8;
  const losses = history.map((x) => x.loss);
  const min = Math.min(...losses), max = Math.max(...losses);
  const pts = losses.map((l, i) => {
    const x = pad + (i / (losses.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((l - min) / (max - min || 1)) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'sparkline');
  svg.innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/>`
    + `<text x="${pad}" y="13" font-size="11" font-family="Inter, system-ui" fill="var(--muted)">surprise, ${history.length} steps: ${max.toFixed(2)} → ${losses.at(-1).toFixed(2)}</text>`;
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

  const scoring = lesson('Score every word in the dictionary', [
    prose(`<p>Each token now has a final vector (N₂ from Chapter 4). To turn that into a guess about the next word, we need one more table: <strong>Wout</strong>, with one row per dictionary word. The score for a candidate word is the dot product of the token's vector with that word's row — the same “how well do these two match” operation attention used.</p>`),
    el('div', { class: 'card figure' }, [
      matrixTable({ title: 'Wout — one scoring row per word', matrix: s.weights.Wout, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims, editable: true,
        highlightRows: new Set(s.tokenIds), onEdit: (r, c, v) => setWeightCell('Wout', r, c, v) }),
      el('p', { class: 'fig-caption', text: 'Sometimes called the “unembedding”: it maps from coordinates back to words.' }),
    ]),
    figure('logits', [matrixTable({ title: 'Scores (logits)', matrix: d.logits, rowLabels: toks, colLabels: s.vocab, cornerLabel: 'after \\ word' })],
      'Row = the position we are standing at. Column = a candidate for the next word.'),
    dotExample(`score after “${d.tokens[n - 1]}” for “${s.vocab[d.prediction[n - 1].id]}”`, d.norm2[n - 1], s.weights.Wout[d.prediction[n - 1].id], { aName: `N₂[${n - 1}]`, bName: `Wout[${d.prediction[n - 1].id}]` }),
  ]);

  const betting = lesson('Turn scores into a bet', [
    prose(`<p>Softmax again — the same move as in attention — turns each row of scores into probabilities that add up to 100%. Now the model is making a proper bet: “after this word, I'd put 40% on <em>sat</em>, 25% on <em>the</em>…”. The favourite is its prediction.</p>`),
    figure('probs', [matrixTable({ title: 'Probabilities', matrix: d.probs, rowLabels: toks, colLabels: s.vocab, heat: 'sequential', decimals: 2, cornerLabel: 'after \\ word', note: 'Rows sum to 1.' })]),
    el('div', { class: 'card figure', dataset: { stage: 'prediction' }, id: 'prediction' }, [
      el('table', { class: 'pred' }, [
        el('thead', {}, el('tr', {}, ['after', 'the model bets on', 'how sure', 'what actually came', ''].map((t) => el('th', { text: t })))),
        el('tbody', {}, d.prediction.map((p, i) => {
          const actual = i + 1 < n ? d.tokens[i + 1] : null;
          const hit = actual != null && p.token === actual;
          return el('tr', {}, [
            el('td', { class: 'word', text: d.tokens[i] }),
            el('td', { class: 'word' }, el('strong', { text: p.token })),
            el('td', {}, [el('span', { class: 'bar', style: `width:${Math.max(4, p.prob * 80)}px` }), pct(p.prob)]),
            el('td', { class: 'word', text: actual ?? '— (end of text)' }),
            el('td', { class: actual == null ? '' : hit ? 'ok' : 'miss', text: actual == null ? '' : hit ? '✓' : '✗' }),
          ]);
        })),
      ]),
      el('p', { class: 'fig-caption', text: `${hits} of ${n - 1} next words guessed right.${s.config.causal ? '' : ' Careful: “no peeking” is off, so the model can see the answer — turn it on in Chapter 3 for an honest test.'}` }),
    ]),
  ]);

  const lr = el('input', { type: 'number', value: s.learningRate, step: 0.01, min: 0.001, onchange: (e) => setLearningRate(e.target.value) });
  const trainBtn = (k, cls) => el('button', { class: cls, text: `Train ${k} step${k > 1 ? 's' : ''}`, onclick: (e) => {
    e.target.disabled = true; e.target.textContent = 'Training…';
    setTimeout(() => train(k), 20);
  } });

  const learning = lesson('Teach it to bet better', [
    prose(`<p>How wrong is the model? We measure its <strong>surprise</strong>: for each position, take the probability it gave to the word that actually came next and ask “how unlikely did it think that was?” Give the right word 100% and surprise is 0; 50% is 0.69; 10% is 2.3; 1% is 4.6. (It's −log of the probability.) Averaged over the text, that single number is what training tries to push down. (Its formal name is cross-entropy loss.)</p>
      <p>Training is remarkably unglamorous. For every one of the ${['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'Wout'].reduce((acc, k) => acc + s.weights[k].flat().length, 0) + s.weights.b1.length + s.weights.b2.length} numbers in the weight tables, ask “if I nudged this up a hair, would surprise go up or down?” — then move it a small step the helpful way. The size of that step is the <strong>learning rate</strong>. Repeat.</p>`),
    callout('idea', `<p>It's tuning an instrument with ${s.config.dim * s.config.dim * 3}+ pegs at once, by ear: turn each peg a fraction, keep it if the chord sounds better. Real models compute all the nudges in one clever pass (backpropagation); here we honestly try each one, which is fine when the model is tiny.</p>`),
    el('div', { class: 'card' }, [
      el('div', { class: 'kpis' }, [
        el('div', {}, [el('b', { text: fmt(loss, 3) }), el('span', { text: 'surprise right now (lower is better)' })]),
        el('div', {}, [el('b', { text: `${hits}/${n - 1}` }), el('span', { text: 'next words correct' })]),
        el('div', {}, [el('b', { text: `${s.trainingHistory.length}` }), el('span', { text: 'training steps so far' })]),
      ]),
      el('div', { class: 'controls', style: 'margin-top:1.1rem' }, [
        el('label', {}, ['Learning rate (saved)', lr]),
        trainBtn(1, 'primary'), trainBtn(10, ''), trainBtn(50, ''),
      ]),
      sparkline(s.trainingHistory),
      el('p', { class: 'fig-caption', text: 'Every step rewrites the saved weight tables, so every page in this book changes: the embeddings move, the attention pattern shifts, the bets sharpen.' }),
    ]),
    callout('try', `<ul>
      <li>Train 10 steps. Watch the ✓ column fill in and the surprise curve fall. Then revisit Chapter 3 — the attention heatmap has reorganised itself.</li>
      <li>Set the learning rate to 1 and train. Too big a step overshoots: surprise may jump <em>up</em>. Bring it back to 0.1.</li>
      <li>Bookmark the model on the Start page before training, so you can compare before and after in Chapter 6.</li>
    </ul>`),
    callout('key', `<p>A language model is nothing more than “predict the next token”, trained by nudging weights to be less surprised by real text. Everything it appears to know is a side effect of getting good at that one game.</p>`),
    underHood('loss = mean over t of −log P[t][ id[t+1] ]        w ← w − lr · ∂loss/∂w', `<p>Gradients here are central finite differences, (loss(w+ε) − loss(w−ε)) / 2ε, computed for every parameter. Slow but transparent — the whole forward pass is re-run for each nudge.</p>`),
  ]);

  content.replaceChildren(scoring, betting, learning, chapterNav('output.html'));
}

bindRender(render);
