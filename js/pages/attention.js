import { forwardAttention } from '../transformer.js';
import { getExperiment, getDerived, setWeightCell, setCausal } from '../state.js';
import {
  initPage, bindRender, el, esc, pct, lesson, prose, callout, underHood, figure, op, matrixTable,
  dotExample, chapterNav, tokenLabels, dimLabels,
} from '../ui.js';

initPage('attention.html');
const content = document.getElementById('content');

function render() {
  const s = getExperiment();
  const d = getDerived();
  const attn = forwardAttention(s);
  const dims = dimLabels(s.config.dim);
  const toks = tokenLabels(d);
  const n = d.tokens.length;
  const iQ = Math.min(1, n - 1); // a query row to use in the worked example
  const jK = 0;

  const weightTable = (name, title) => matrixTable({
    title, matrix: s.weights[name], rowLabels: dims, colLabels: dims, editable: true,
    onEdit: (r, c, v) => setWeightCell(name, r, c, v),
  });

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
    figure('positionalInput', [matrixTable({ title: 'X (from Chapter 2)', matrix: attn.X, rowLabels: toks, colLabels: dims })], 'The input: one row per token.'),
    el('div', { class: 'card figure' }, [
      el('div', { class: 'figure-row' }, [weightTable('Wq', 'Wq — makes questions'), weightTable('Wk', 'Wk — makes badges'), weightTable('Wv', 'Wv — makes notes')]),
      el('p', { class: 'fig-caption', text: 'Edit a cell of Wq and only the question side recalculates: Q, then the scores, then everything after. K and V are untouched. The corner panel shows the cascade.' }),
    ]),
    prose(`<p>Multiplying X by each table gives three new tables with one row per token:</p>`),
    el('div', { class: 'figure-row' }, [
      figure('Q', [matrixTable({ title: 'Q — questions', matrix: attn.Q, rowLabels: toks, colLabels: dims })]),
      figure('K', [matrixTable({ title: 'K — badges', matrix: attn.K, rowLabels: toks, colLabels: dims })]),
      figure('V', [matrixTable({ title: 'V — notes', matrix: attn.V, rowLabels: toks, colLabels: dims })]),
    ]),
    underHood('Q = X · Wq     K = X · Wk     V = X · Wv', `<p>Each is a matrix multiplication: row i of Q is row i of X combined with the columns of Wq. Same input, three different “views”.</p>`),
  ]);

  const scoring = lesson('Compare every question with every badge', [
    prose(`<p>How well does the question of “${esc(d.tokens[iQ])}” match the badge of “${esc(d.tokens[jK])}”? We multiply the two rows number by number and add up. That's a <strong>dot product</strong>, and it is large when the two rows point the same way.</p>`),
    dotExample(`score[${iQ}][${jK}]`, attn.Q[iQ], attn.K[jK], { aName: `Q[${iQ}] (${d.tokens[iQ]})`, bName: `K[${jK}] (${d.tokens[jK]})` }),
    prose(`<p>Doing this for every pair gives a square table: rows are the words asking, columns are the words answering. Flipping K on its side (Kᵀ) is just the bookkeeping that makes one multiplication produce the whole table.</p>`),
    figure('scores', [
      matrixTable({ title: 'Q', matrix: attn.Q, rowLabels: toks, colLabels: dims, small: true }),
      op('·'),
      el('div', { dataset: { stage: 'KT' }, id: 'KT' }, matrixTable({ title: 'Kᵀ', matrix: attn.KT, rowLabels: dims, colLabels: toks, small: true })),
      op('='),
      matrixTable({ title: 'Scores', matrix: attn.scores, rowLabels: toks, colLabels: toks, cornerLabel: 'asks \\ answers' }),
    ], 'Row = the word asking. Column = the word being looked at.'),
  ]);

  const causal = el('input', { type: 'checkbox', checked: s.config.causal, onchange: (e) => setCausal(e.target.checked) });
  const tidy = lesson('Two small adjustments', [
    prose(`<p><strong>Keep the numbers tame.</strong> Adding up ${s.config.dim} products makes scores grow with the size of the model, and huge scores make the next step far too decisive. So we divide every score by √${s.config.dim} ≈ ${Math.sqrt(s.config.dim).toFixed(2)}.</p>
      <p><strong>No peeking.</strong> Our model's job (Chapter 5) will be to guess the <em>next</em> word. That's only a fair game if a word cannot look at the words after it. So we blank out every “future” cell — it gets −∞, which the next step turns into exactly zero attention.</p>`),
    el('div', { class: 'card figure', dataset: { stage: 'scaledScores' }, id: 'scaledScores' }, [
      el('label', { class: 'inline', style: 'margin-bottom:.8rem' }, [causal, 'No peeking at later words (saved setting)']),
      matrixTable({ title: `Scores ÷ √${s.config.dim}${s.config.causal ? ', future hidden' : ''}`, matrix: attn.scaledScores, rowLabels: toks, colLabels: toks, cornerLabel: 'asks \\ answers' }),
    ]),
  ]);

  const softmax = lesson('Turn matches into shares', [
    prose(`<p>Scores can be any size, positive or negative. What we want is, for each asking word, a set of <strong>shares</strong> that add up to 100%: “take 60% of this note, 30% of that one, 10% of the other.” The function that does this is called <strong>softmax</strong>: it makes everything positive, then divides by the total. Bigger scores get disproportionately bigger shares.</p>`),
    figure('attentionWeights', [
      matrixTable({ title: 'Attention', matrix: attn.attentionWeights, rowLabels: toks, colLabels: toks, heat: 'sequential', decimals: 2, cornerLabel: 'asks \\ answers', note: 'Each row adds up to 1. Darker = more attention.' }),
      el('div', { class: 'stack', style: 'flex: 1; min-width: 16rem' }, [
        el('strong', { style: 'font-family: var(--sans); font-size: 14px', text: 'Read it as a sentence' }),
        ...attn.attentionWeights.map((rowVals, i) => {
          const best = rowVals.indexOf(Math.max(...rowVals));
          return prose(`<p style="margin:0">“${esc(d.tokens[i])}” <span class="mono">#${i}</span> listens mostly to “${esc(d.tokens[best])}” <span class="mono">#${best}</span> — ${pct(rowVals[best])}${best === i ? ' (itself)' : ''}</p>`);
        }),
      ]),
    ]),
    underHood('A[i][j] = exp(S[i][j]) / Σ_k exp(S[i][k])', `<p>Applied row by row. Hidden cells have score −∞, and exp(−∞) = 0, so they get exactly no share.</p>`),
  ]);

  const collect = lesson('Collect the notes', [
    prose(`<p>Finally each word gathers what it listened to: its new row is the notes (V) of all the words, blended using its shares. A word that gave 60% of its attention to “cat” ends up holding a row that is 60% cat's note.</p>`),
    figure('attentionOutput', [
      matrixTable({ title: 'Attention', matrix: attn.attentionWeights, rowLabels: toks, colLabels: toks, heat: 'sequential', small: true }),
      op('·'),
      matrixTable({ title: 'V — notes', matrix: attn.V, rowLabels: toks, colLabels: dims, small: true }),
      op('='),
      matrixTable({ title: 'Z — what each word collected', matrix: attn.output, rowLabels: toks, colLabels: dims }),
    ], 'Z has the same shape as X: one row per token, but now each row knows about the others.'),
    dotExample(`Z[${iQ}][0]`, attn.attentionWeights[iQ], attn.V.map((r) => r[0]), { aName: `shares of “${d.tokens[iQ]}”`, bName: 'first column of V' }),
    callout('try', `<ul>
      <li>Set every cell of <strong>Wq</strong> to 0. All questions become blank, all scores 0, and every word attends <em>equally</em> to what it can see. Watch the heatmap flatten.</li>
      <li>Make one number in <strong>Wk</strong> large (say 5). One badge becomes very “loud”; see a column of the attention table darken.</li>
      <li>Untick “no peeking”. The top-right of the table fills in — words now look at the future.</li>
    </ul>`),
    callout('key', `<p>Attention is just: <em>score every pair, turn scores into shares, blend</em>. Real models run several of these side by side (“heads”) and stack many layers, but each head is exactly this page.</p>`),
  ]);

  content.replaceChildren(why, lenses, scoring, tidy, softmax, collect, chapterNav('attention.html'));
}

bindRender(render);
