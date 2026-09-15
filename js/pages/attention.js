import { getExperiment, getDerived, setWeightCell, setWeights, setCausal, untrainedExperiment } from '../state.js';
import { forward } from '../transformer.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, underHood, figure, matrixTable, attentionArcs, softmaxBars, compareToggle, compareOn, chapterNav, tokenLabels, dimLabels } from '../ui.js';
import { SPEEDS } from '../player.js';
import { player, chapterControls } from '../player.js';
import { matmulScene, rowScene, transposeScene, vec, cellRef } from '../scenes.js';

initPage('attention.html');
const content = document.getElementById('content');
const STAGES_HERE = ['Q', 'K', 'V', 'KT', 'scores', 'scaledScores', 'attentionWeights', 'attentionOutput'];

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const toks = tokenLabels(d);
  const n = d.tokens.length;
  const sqrtD = Math.sqrt(s.config.dim);
  const X = d.positionalInput;
  const freshD = compareOn() ? forward(untrainedExperiment()) : null;
  const identity = (k) => Array.from({ length: s.config.dim }, (_, i) => Array.from({ length: s.config.dim }, (_, j) => (i === j ? k : 0)));

  const weightTable = (name, title) => matrixTable({
    title, matrix: s.weights[name], rowLabels: dims, colLabels: dims, editable: true,
    onEdit: (r, c, v) => setWeightCell(name, r, c, v),
  });
  const projection = (id, W, title, what) => player({ id, scene: matmulScene({
    A: X, B: s.weights[W], C: d[id], aTitle: 'X', bTitle: W, cTitle: id, aRows: toks, aCols: dims, bCols: dims,
    idle: `Press play to compute ${id} = X · ${W}, one cell at a time — ${what}.`,
    done: `${id} holds one ${what.split(' ')[0]} per token.`,
  }) });

  const why = lesson('Why words need to look at each other', [
    prose(`<p>Take “the cat sat on the mat”. What does “sat” mean here? Who sat? On what? A word on its own is ambiguous; its meaning in a sentence comes from the words around it. <strong>Attention</strong> is a mechanism that lets every word pull in information from every other word — and, crucially, decide <em>how much</em> to take from each.</p>`),
    callout('idea', `<p>Picture the words as people at a small gathering. Each person has three things:</p>
      <ul>
        <li>a <strong>question</strong> they are asking (their <em>query</em>),</li>
        <li>a <strong>name badge</strong> describing what they know (their <em>key</em>),</li>
        <li>a <strong>note</strong> they'll hand over if asked (their <em>value</em>).</li>
      </ul>
      <p>Everyone compares their question with every badge in the room. The better a badge matches, the more of that person's note they take. What they end up holding is a blend of notes, weighted by how relevant each person was.</p>`),
  ]);

  const lenses = lesson('Three lenses on the same input', [
    prose(`<p>Where do the question, badge and note come from? From the same row of X, seen through three different small weight tables: <strong>Wq</strong>, <strong>Wk</strong> and <strong>Wv</strong>. Each is ${s.config.dim}×${s.config.dim} and each is <span class="tag stored">saved</span> and learned.</p>`),
    figure(null, [matrixTable({ title: 'X (from Chapter 2)', matrix: X, rowLabels: toks, colLabels: dims })], 'The input: one row per token.'),
    el('div', { class: 'card figure' }, [
      el('div', { class: 'figure-row' }, [weightTable('Wq', 'Wq — makes questions'), weightTable('Wk', 'Wk — makes badges'), weightTable('Wv', 'Wv — makes notes')]),
      el('p', { class: 'fig-caption', text: 'Edit a cell of Wq and only the question side needs replaying: Q, then the scores, then everything after. K and V keep their results.' }),
      el('div', { class: 'presets' }, [
        el('span', { class: 'fig-caption', style: 'margin:0', text: 'Presets to get a feel for the heatmap:' }),
        el('button', { text: 'Attend to yourself', title: 'Wq = Wk = 3·I — every question matches its own badge best', onclick: () => setWeights({ Wq: identity(3), Wk: identity(3) }) }),
        el('button', { text: 'Attend evenly', title: 'Wq = 0 — every score is 0, so every visible word gets an equal share', onclick: () => setWeights({ Wq: identity(0) }) }),
        el('button', { text: 'Attend to the previous word', title: 'Wq = 3·I, Wk = −3·I on a wave pattern tends to favour neighbours', onclick: () => setWeights({ Wq: identity(3), Wk: identity(-3) }) }),
        el('span', { class: 'fig-caption', style: 'margin:0', text: '⌘Z to undo.' }),
      ]),
    ]),
    prose(`<p>Multiplying X by each table gives three new tables with one row per token. Each cell is a dot product: a row of X against a column of the weight table.</p>`),
    projection('Q', 'Wq', 'Q — questions', 'question per token'),
    projection('K', 'Wk', 'K — badges', 'badge per token'),
    projection('V', 'Wv', 'V — notes', 'note per token'),
    underHood('Q = X · Wq     K = X · Wk     V = X · Wv', `<p>Each is a matrix multiplication: row i of Q is row i of X combined with the columns of Wq. Same input, three different “views”.</p>`),
  ]);

  const scoring = lesson('Compare every question with every badge', [
    prose(`<p>How well does the question of one word match the badge of another? Multiply the two rows number by number and add up. That's a <strong>dot product</strong>, and it is large when the two rows point the same way. Doing this for every pair gives a square table: rows are the words asking, columns are the words answering.</p>
      <p>First a bit of bookkeeping: flipping K on its side (Kᵀ) is what lets one multiplication produce the whole table.</p>`),
    player({ id: 'KT', scene: transposeScene({ K: d.K, KT: d.KT, tokens: toks, dims, idle: 'Press play to turn each row of K into a column.' }) }),
    player({ id: 'scores', scene: matmulScene({
      A: d.Q, B: d.KT, C: d.scores, aTitle: 'Q', bTitle: 'Kᵀ', cTitle: 'Scores', aRows: toks, aCols: dims, bCols: toks,
      idle: 'Press play to score every (question, badge) pair.',
      done: 'Row = the word asking, column = the word being looked at.',
    }) }),
  ]);

  const causal = el('input', { type: 'checkbox', checked: s.config.causal, onchange: (e) => setCausal(e.target.checked) });
  const tidy = lesson('Two small adjustments', [
    prose(`<p><strong>Keep the numbers tame.</strong> Adding up ${s.config.dim} products makes scores grow with the size of the model, and huge scores make the next step far too decisive. So we divide every score by √${s.config.dim} ≈ ${sqrtD.toFixed(2)}.</p>
      <p><strong>No peeking.</strong> Our model's job (Chapter 5) will be to guess the <em>next</em> word. That's only a fair game if a word cannot look at the words after it. So we blank out every “future” cell — it gets −∞, which the next step turns into exactly zero attention.</p>`),
    el('div', { class: 'card', style: 'padding:.7rem 1.1rem' }, el('label', { class: 'inline' }, [causal, 'No peeking at later words (saved setting)'])),
    player({ id: 'scaledScores', scene: rowScene({
      inputs: [{ title: 'Scores', matrix: d.scores, rowLabels: toks, colLabels: toks }],
      output: { title: `Scores ÷ √${s.config.dim}${s.config.causal ? ', future hidden' : ''}`, matrix: d.scaledScores, rowLabels: toks, colLabels: toks },
      idle: `Press play to scale each row by 1/√${s.config.dim}${s.config.causal ? ' and hide the future' : ''}.`,
      explain: (i) => {
        const scaled = d.scores[i].map((v) => v / sqrtD);
        const hidden = s.config.causal ? n - 1 - i : 0;
        return {
          caption: `Row <b>${i}</b> (“${esc(d.tokens[i])}” asking): divide by ${sqrtD.toFixed(2)}` + (hidden ? `, then hide the ${hidden} word${hidden > 1 ? 's' : ''} after it.` : '.'),
          worked: `<span class="a">${vec(d.scores[i])}</span><span class="eq">÷ ${sqrtD.toFixed(2)} =</span><span class="b">${vec(scaled)}</span>` + (hidden ? `<span class="eq">→ mask →</span><span class="result">${vec(d.scaledScores[i])}</span>` : ''),
        };
      },
    }) }),
  ]);

  const softmax = lesson('Turn matches into shares', [
    prose(`<p>Scores can be any size, positive or negative. What we want is, for each asking word, a set of <strong>shares</strong> that add up to 100%: “take 60% of this note, 30% of that one, 10% of the other.” The function that does this is called <strong>softmax</strong>: raise <em>e</em> to each score (so everything is positive and bigger scores pull far ahead), then divide by the total.</p>`),
    el('div', { style: 'margin-bottom:-.6rem' }, compareToggle(render)),
    player({ id: 'attentionWeights', scene: rowScene({
      inputs: [{ title: 'Scaled scores', matrix: d.scaledScores, rowLabels: toks, colLabels: toks }],
      ops: [],
      output: { title: 'Attention', matrix: d.attentionWeights, rowLabels: toks, colLabels: toks, heat: 'sequential', cornerLabel: 'asks \\ answers', compare: freshD ? freshD.attentionWeights : null },
      idle: 'Press play to turn each row of scores into shares that sum to 100%.',
      explain: (i) => {
        const rowS = d.scaledScores[i];
        const exps = rowS.map((v) => (v === -Infinity ? 0 : Math.exp(v)));
        const sum = exps.reduce((a, b) => a + b, 0);
        const best = d.attentionWeights[i].indexOf(Math.max(...d.attentionWeights[i]));
        return {
          caption: `Row <b>${i}</b>: “${esc(d.tokens[i])}” gives its biggest share, ${cellRef(i, best, `<b>${pct(d.attentionWeights[i][best])}</b>`)}, to “${esc(d.tokens[best])}”${best === i ? ' (itself)' : ''}.`,
          worked: `<span class="eq">e^scores =</span><span class="a">${vec(exps)}</span><span class="eq">sum =</span><b>${fmt(sum)}</b><span class="eq">shares =</span><span class="result">${vec(d.attentionWeights[i])}</span>`,
          extra: softmaxBars({ labels: d.tokens, scores: rowS, stepMs: SPEEDS[s.animation.speed] || SPEEDS.normal }),
        };
      },
      done: 'Each row adds up to 1. Darker = more attention.',
      extra: (k) => el('div', { class: 'arcs-wrap' }, [
        attentionArcs({ tokens: d.tokens, rows: d.attentionWeights.slice(0, k).map((w, i) => ({ i, w })), focus: k ? k - 1 : null }),
        el('p', { class: 'fig-caption', text: k ? 'Each arc goes from the word asking to a word it listens to; thicker = bigger share. Hover a word to see only its arcs.' : 'The same table drawn as arcs over the sentence — it fills in as rows are computed.' }),
      ]),
    }) }),
    underHood('A[i][j] = exp(S[i][j]) / Σ_k exp(S[i][k])', `<p>Applied row by row. Hidden cells have score −∞, and exp(−∞) = 0, so they get exactly no share.</p>`),
  ]);

  const collect = lesson('Collect the notes', [
    prose(`<p>Finally each word gathers what it listened to: its new row is the notes (V) of all the words, blended using its shares. A word that gave 60% of its attention to “cat” ends up holding a row that is 60% cat's note.</p>`),
    player({ id: 'attentionOutput', scene: matmulScene({
      A: d.attentionWeights, B: d.V, C: d.attentionOutput, aTitle: 'Attention', bTitle: 'V', cTitle: 'Z', aRows: toks, aCols: toks, bCols: dims,
      idle: 'Press play to blend the notes, one cell at a time.',
      done: 'Z has the same shape as X: one row per token, but now each row knows about the others.',
    }) }),
    callout('try', `<ul>
      <li>Set every cell of <strong>Wq</strong> to 0. All questions become blank, all scores 0, and every word attends <em>equally</em> to what it can see. Replay the softmax stage and watch the heatmap flatten.</li>
      <li>Make one number in <strong>Wk</strong> large (say 5). One badge becomes very “loud”; see a column of the attention table darken.</li>
      <li>Untick “no peeking”. The top-right of the table fills in — words now look at the future.</li>
    </ul>`, null, [
      { label: 'Wq → all zeros', run: () => setWeights({ Wq: s.weights.Wq.map((r) => r.map(() => 0)) }), then: 'attentionWeights' },
      { label: 'Wk[0][0] → 5', run: () => setWeightCell('Wk', 0, 0, 5), then: 'attentionWeights' },
      { label: s.config.causal ? 'Allow peeking' : 'No peeking again', run: () => setCausal(!getExperiment().config.causal), then: 'scaledScores' },
    ]),
    callout('key', `<p>Attention is just: <em>score every pair, turn scores into shares, blend</em>. Real models run several of these side by side (“heads”) and stack many layers, but each head is exactly this page.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), why, lenses, scoring, tidy, softmax, collect, chapterNav('attention.html'));
}

bindRender(render);
