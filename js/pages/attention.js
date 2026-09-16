import { getExperiment, getDerived, setWeightCell, setWeights, setCausal, untrainedExperiment, isLab } from '../state.js';
import { forward } from '../transformer.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, underHood, figure, matrixTable, attentionArcs, softmaxBars, compareToggle, compareOn, chapterNav, tokenLabelsWin, dimLabels, windowOf, sliceRows, sliceBoth, sliceCols, lensBar, labOnly, recap } from '../ui.js';
import { SPEEDS } from '../player.js';
import { checkYourself } from '../quiz.js';
import { player, chapterControls } from '../player.js';
import { matmulScene, rowScene, transposeScene, vec, cellRef } from '../scenes.js';

initPage('attention.html');
const content = document.getElementById('content');
const STAGES_HERE = ['Q', 'K', 'V', 'KT', 'scores', 'scaledScores', 'attentionWeights', 'attentionOutput'];

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const n = d.tokens.length;
  const win = windowOf(n);
  const toks = tokenLabelsWin(d.tokens, win);
  const winTokens = sliceRows(d.tokens, win);
  const sqrtD = Math.sqrt(s.config.dim);
  const X = sliceRows(d.positionalInput, win);
  const freshD = compareOn() ? forward(untrainedExperiment()) : null;
  // Rows in the window may attend to positions before it. Those shares are
  // folded into one extra "earlier" column so every row still sums to 1.
  const earlier = win.start > 0;
  const withEarlier = (rowsWin, full, agg) => rowsWin.map((r, i) => [agg(full[win.rows[i]]), ...r]);
  const sumBefore = (row) => row.slice(0, win.start).reduce((a, b) => a + b, 0);
  const colLabelsE = earlier ? [`earlier ×${win.start}`, ...toks] : toks;
  const attnWin = earlier ? withEarlier(sliceBoth(d.attentionWeights, win), d.attentionWeights, sumBefore) : sliceBoth(d.attentionWeights, win);
  const scaledWin = earlier ? withEarlier(sliceBoth(d.scaledScores, win), d.scaledScores, () => NaN) : sliceBoth(d.scaledScores, win);
  const freshAttnWin = freshD ? (earlier ? withEarlier(sliceBoth(freshD.attentionWeights, win), freshD.attentionWeights, sumBefore) : sliceBoth(freshD.attentionWeights, win)) : null;
  const identity = (k) => Array.from({ length: s.config.dim }, (_, i) => Array.from({ length: s.config.dim }, (_, j) => (i === j ? k : 0)));

  const weightTable = (name, title) => matrixTable({
    title, matrix: s.weights[name], rowLabels: dims, colLabels: dims, editable: true,
    onEdit: (r, c, v) => setWeightCell(name, r, c, v),
  });
  const projection = (id, W, title, what) => player({ id, scene: matmulScene({
    A: X, B: s.weights[W], C: sliceRows(d[id], win), aTitle: 'X', bTitle: W, cTitle: id, aRows: toks, aCols: dims, bCols: dims,
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

  const lenses = lesson('Three views of the same row', [
    prose(`<p>Where do the question, badge and note come from? From the same row of X, seen through three different small weight tables: <strong>Wq</strong>, <strong>Wk</strong> and <strong>Wv</strong>. Each is ${s.config.dim}×${s.config.dim} and each is <span class="tag stored">saved</span> and learned.${isLab() ? '' : ' (In Lab mode you can edit them.)'}</p>`),
    lensBar(d.tokens),
    figure(null, [matrixTable({ title: 'X (from Chapter 2)', matrix: X, rowLabels: toks, colLabels: dims })], 'The input: one row per token.'),
    el('div', { class: 'card figure' }, [
      el('div', { class: 'figure-row' }, [weightTable('Wq', 'Wq — makes questions'), weightTable('Wk', 'Wk — makes badges'), weightTable('Wv', 'Wv — makes notes')]),
      el('p', { class: 'fig-caption', text: 'Edit a cell of Wq and only the question side needs replaying: Q, then the scores, then everything after. K and V keep their results.' }),
      labOnly(el('div', { class: 'presets' }, [
        el('span', { class: 'fig-caption', style: 'margin:0', text: 'Presets to get a feel for the heatmap:' }),
        el('button', { text: 'Attend to yourself', title: 'Wq = Wk = 3·I — a question matches its own badge best (usually; two positions with similar rows can still tie)', onclick: () => setWeights({ Wq: identity(3), Wk: identity(3) }) }),
        el('button', { text: 'Attend evenly', title: 'Wq = 0 — every score is 0, so every visible word gets an equal share', onclick: () => setWeights({ Wq: identity(0) }) }),
        el('span', { class: 'fig-caption', style: 'margin:0', text: '⌘Z to undo.' }),
      ])),
    ]),
    prose(`<p>Each cell of the three new tables is an <strong>agreement score</strong> between a row of X and a column of the weight table: multiply the two number by number and add up. Two rows “agree” when their big numbers line up in the same places. (The formal name is a dot product.)</p>`),
    projection('Q', 'Wq', 'Q — questions', 'question per token'),
    projection('K', 'Wk', 'K — badges', 'badge per token'),
    projection('V', 'Wv', 'V — notes', 'note per token'),
    underHood('Q = X · Wq     K = X · Wk     V = X · Wv', `<p>Each is a matrix multiplication: row i of Q is row i of X combined with the columns of Wq. Same input, three different “views”.</p>`),
  ]);

  const scoring = lesson('Compare every question with every badge', [
    prose(`<p>How well does the question of one token match the badge of another? The same agreement score: multiply the two rows number by number and add up. Doing this for every pair gives a square table — rows are the tokens asking, columns the tokens answering. (Flipping K on its side, Kᵀ, is bookkeeping that lets one multiplication produce the whole table.)</p>`),
    player({ id: 'KT', scene: transposeScene({ K: sliceRows(d.K, win), KT: sliceCols(d.KT, win), tokens: toks, dims, idle: 'Press play to turn each row of K into a column.' }) }),
    player({ id: 'scores', scene: matmulScene({
      A: sliceRows(d.Q, win), B: sliceCols(d.KT, win), C: sliceBoth(d.scores, win), aTitle: 'Q', bTitle: 'Kᵀ', cTitle: 'Scores', aRows: toks, aCols: dims, bCols: toks,
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
      inputs: [{ title: 'Scores', matrix: earlier ? withEarlier(sliceBoth(d.scores, win), d.scores, () => NaN) : sliceBoth(d.scores, win), rowLabels: toks, colLabels: colLabelsE }],
      output: { title: `Scores ÷ √${s.config.dim}${s.config.causal ? ', future hidden' : ''}`, matrix: scaledWin, rowLabels: toks, colLabels: colLabelsE },
      idle: `Press play to scale each row by 1/√${s.config.dim}${s.config.causal ? ' and hide the future' : ''}.`,
      explain: (i) => {
        const g = win.rows[i];
        const rowFull = d.scores[g], rowWin = win.rows.map((j) => rowFull[j]);
        const scaled = rowWin.map((v) => v / sqrtD);
        const hidden = s.config.causal ? n - 1 - g : 0;
        return {
          caption: `Row <b>${g}</b> (“${esc(d.tokens[g])}” asking): divide by ${sqrtD.toFixed(2)}` + (hidden ? `, then hide the ${hidden} word${hidden > 1 ? 's' : ''} after it.` : '.') + (earlier ? ' (Only this window\'s columns are written out.)' : ''),
          worked: `<span class="a">${vec(rowWin)}</span><span class="eq">÷ ${sqrtD.toFixed(2)} =</span><span class="b">${vec(scaled)}</span>` + (hidden ? `<span class="eq">→ mask →</span><span class="result">${vec(win.rows.map((j) => d.scaledScores[g][j]))}</span>` : ''),
        };
      },
    }) }),
  ]);

  const softmax = lesson('Turn matches into shares', [
    prose(`<p>Scores can be any size, positive or negative. What we want is, for each asking token, a set of <strong>shares</strong> that add up to 100%: “take 60% of this note, 30% of that one, 10% of the other.” The function that does this is called <strong>softmax</strong>: raise a fixed number, <em>e</em> ≈ 2.72, to the power of each score — that makes everything positive and lets big scores pull far ahead — then divide by the total.</p>`),
    el('div', { style: 'margin-bottom:-.6rem' }, compareToggle(render)),
    player({ id: 'attentionWeights', scene: rowScene({
      inputs: [{ title: 'Scaled scores', matrix: scaledWin, rowLabels: toks, colLabels: colLabelsE }],
      ops: [],
      output: { title: 'Attention', matrix: attnWin, rowLabels: toks, colLabels: colLabelsE, heat: 'sequential', cornerLabel: 'asks \\ answers', compare: freshAttnWin },
      idle: 'Press play to turn each row of scores into shares that sum to 100%.' + (earlier ? ` The first column gathers the shares given to the ${win.start} positions before this window.` : ''),
      explain: (i) => {
        const g = win.rows[i];
        const rowS = d.scaledScores[g];
        const rowA = d.attentionWeights[g];
        const exps = rowS.map((v) => (v === -Infinity ? 0 : Math.exp(v)));
        const sum = exps.reduce((a, b) => a + b, 0);
        const best = rowA.indexOf(Math.max(...rowA));
        const bestLocal = win.rows.indexOf(best);
        const bestCol = bestLocal >= 0 ? bestLocal + (earlier ? 1 : 0) : 0;
        const shown = win.rows.map((j) => exps[j]);
        return {
          caption: `Row <b>${g}</b>: “${esc(d.tokens[g])}” gives its biggest share, ${cellRef(i, bestCol, `<b>${pct(rowA[best])}</b>`)}, to “${esc(d.tokens[best])}” (position ${best})${best === g ? ' (itself)' : ''}${bestLocal < 0 ? ' — outside this window' : ''}.`,
          worked: `<span class="eq">e^scores${earlier ? ' (this window)' : ''} =</span><span class="a">${vec(shown)}</span><span class="eq">sum${earlier ? ' over all positions' : ''} =</span><b>${fmt(sum)}</b><span class="eq">shares =</span><span class="result">${vec(win.rows.map((j) => rowA[j]))}</span>${earlier ? `<span class="eq">+ earlier</span> <b>${fmt(sumBefore(rowA))}</b>` : ''}`,
          extra: softmaxBars({ labels: winTokens, scores: win.rows.map((j) => rowS[j]), stepMs: SPEEDS[s.animation.speed] || SPEEDS.normal }),
        };
      },
      done: 'Each row adds up to 1. Darker = more attention.',
      extra: (k) => el('div', { class: 'arcs-wrap' }, [
        attentionArcs({ tokens: winTokens, rows: win.rows.slice(0, k).map((g, i) => ({ i, w: win.rows.map((j) => d.attentionWeights[g][j]) })), focus: k ? k - 1 : null }),
        el('p', { class: 'fig-caption', text: k ? `Each arc goes from the word asking to a word it listens to; thicker = bigger share. Hover a word to see only its arcs.${earlier ? ' Shares given to positions before this window are not drawn.' : ''}` : 'The same table drawn as arcs over the sentence — it fills in as rows are computed.' }),
      ]),
    }) }),
    underHood('A[i][j] = exp(S[i][j]) / Σ_k exp(S[i][k])', `<p>Applied row by row. Hidden cells have score −∞, and exp(−∞) = 0, so they get exactly no share.</p>`),
  ]);

  const collect = lesson('Collect the notes', [
    prose(`<p>Finally each word gathers what it listened to: its new row is the notes (V) of all the words, blended using its shares. A word that gave 60% of its attention to “cat” ends up holding a row that is 60% cat's note.</p>`),
    player({ id: 'attentionOutput', scene: matmulScene({
      A: sliceBoth(d.attentionWeights, win), B: sliceRows(d.V, win), C: sliceRows(d.attentionOutput, win), aTitle: 'Attention', bTitle: 'V', cTitle: 'Z', aRows: toks, aCols: toks, bCols: dims,
      idle: 'Press play to blend the notes, one cell at a time.' + (earlier ? ` Notes from the ${win.start} positions before this window contribute too; they appear as one extra term.` : ''),
      extra: earlier ? (i, j) => { const g = win.rows[i]; let v = 0; for (let p = 0; p < win.start; p++) v += d.attentionWeights[g][p] * d.V[p][j]; return { label: `earlier ×${win.start}`, value: v }; } : null,
      done: 'Z has the same shape as X: one row per token, but now each row knows about the others.',
    }) }),
    callout('try', `<ul>
      <li>Set every cell of <strong>Wq</strong> to 0. All questions become blank, all scores 0, and every word attends <em>equally</em> to what it can see. Replay the softmax stage and watch the heatmap flatten.</li>
      <li>Make one number in <strong>Wk</strong> large (say 5). One badge becomes very “loud”; see a column of the attention table darken.</li>
      <li>Untick “no peeking”. The top-right of the table fills in — words now look at the future.</li>
    </ul>`, null, [
      { label: 'Blank every question (Wq → 0)', run: () => setWeights({ Wq: s.weights.Wq.map((r) => r.map(() => 0)) }), then: 'attentionWeights' },
      { label: 'Make one badge very loud (Wk[0][0] = 5)', run: () => setWeightCell('Wk', 0, 0, 5), then: 'attentionWeights' },
      { label: s.config.causal ? 'Allow peeking' : 'No peeking again', run: () => setCausal(!getExperiment().config.causal), then: 'scaledScores' },
    ]),
    callout('key', `<p>Attention is just: <em>score every pair, turn scores into shares, blend</em>. Real models run several of these side by side (“heads”, each working on a slice of the numbers, their results joined by one more table) and stack many layers — but each head does exactly what this page does.</p>`),
    callout('key', `<p><strong>Why the trained heatmap stays flat here.</strong> On a single text the model can memorise the answer without choosing where to look: every position's past is unique, so “take the average of what came before, then think” is enough. Attention earns its keep when the same pieces in a different order must give a different answer — many different texts, not one. ${isLab() ? 'The presets above show what a sharp pattern looks like; a' : 'A'} model trained on real text learns sharp patterns on its own.</p>`, 'Honest note'),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), why, lenses, scoring, tidy, softmax, collect, recap([
    'Each token asks a <strong>question</strong> (Q), wears a <strong>badge</strong> (K) and carries a <strong>note</strong> (V) — three views of its own row.',
    'Every question is scored against every badge; softmax turns the scores into <strong>shares</strong> that add up to 100%.',
    'Each token’s new row is the notes of all tokens, blended by its shares. On one training text the shares stay nearly even — attention shines on varied text.',
  ]), checkYourself('attention.html'), chapterNav('attention.html'));
}

bindRender(render, { quietKeys: ['view'] });
