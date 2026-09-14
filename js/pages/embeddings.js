import { getExperiment, getDerived, setWeightCell } from '../state.js';
import {
  initPage, bindRender, el, esc, lesson, prose, callout, underHood, figure, op, matrixTable,
  sumExample, chapterNav, tokenLabels, dimLabels,
} from '../ui.js';

initPage('embeddings.html');
const content = document.getElementById('content');

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const n = d.tokens.length;
  const used = new Set(s.tokenIds);
  const usedPositions = new Set(Array.from({ length: n }, (_, i) => i));
  const dimCount = s.config.dim;

  const location = lesson('Give every word a location', [
    prose(`<p>A word's ID says <em>which</em> word it is, nothing more. What the model needs is something it can do arithmetic with. So each word gets a row of <strong>${dimCount} numbers</strong> — its <strong>embedding</strong>. You can think of them as coordinates: every word is a point in a ${dimCount}-dimensional space, and words that behave alike end up near each other.</p>
      <p>Nobody types these numbers in. They start random and are <em>learned</em> — in Chapter 5 you'll watch them move. Real models use hundreds or thousands of numbers per word; we use ${dimCount} so you can read them.</p>`),
    callout('idea', `<p>Imagine describing food with ${dimCount} sliders — sweet, salty, spicy, crunchy. Every dish becomes ${dimCount} numbers, and “similar dishes” means “similar slider settings”. An embedding is the same idea for words, except the model decides for itself what the sliders mean.</p>`),
    el('div', { class: 'card figure' }, [
      matrixTable({
        title: 'Embedding table E', matrix: s.weights.embedding, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims,
        editable: true, highlightRows: used, cornerLabel: 'id', onEdit: (r, c, v) => setWeightCell('embedding', r, c, v),
      }),
      el('p', { class: 'fig-caption', text: 'One row per dictionary word. Blue is negative, orange positive; stronger colour, bigger number. Highlighted rows are used by your text. Click any number to change it — it is saved, and everything downstream recalculates.' }),
    ]),
  ]);

  const lookup = lesson('Look up each token', [
    prose(`<p>Turning IDs into embeddings is not a calculation, it's a lookup: position <em>i</em> simply copies row <code>id[i]</code> of the table. The result has one row per token.</p>`),
    figure('embeddings', [
      matrixTable({ title: 'Rows picked for your text', matrix: d.embeddings, rowLabels: tokenLabels(d), colLabels: dims }),
    ], 'Row i is a copy of E[id[i]]. Repeated words get identical rows.'),
  ]);

  const positions = lesson('Same word, different seat', [
    prose(`<p>There's a catch. If “the” appears twice, both copies get exactly the same row — and later stages have no idea which came first. Word order matters in language, so we need to <strong>stamp the position onto each row</strong>.</p>
      <p>We keep a second table, <strong>P</strong>, with one row per position. Row 0 is a fixed pattern for “first”, row 1 for “second”, and so on. Adding P[pos] to the word's embedding gives every copy of a word its own flavour.</p>`),
    callout('idea', `<p>It's the seat number on a ticket. Two people can hold tickets for the same film (same word), but seat 3 and seat 7 are different tickets (same word + different position).</p>`),
    el('div', { class: 'card figure' }, [
      matrixTable({
        title: 'Position table P', matrix: s.weights.positional, rowLabels: s.weights.positional.map((_, i) => `pos ${i}`), colLabels: dims,
        editable: true, highlightRows: usedPositions, onEdit: (r, c, v) => setWeightCell('positional', r, c, v),
      }),
      el('p', { class: 'fig-caption', text: 'Starts as a wave pattern (sines and cosines of the position), which is what the original transformer used. Only the highlighted rows are needed for your text. Editable and saved like any weight.' }),
    ]),
  ]);

  const first = d.tokens[0];
  const x = lesson('Put them together', [
    prose(`<p>Add the two tables row by row and we have <strong>X</strong>, the input to the transformer block. Every row now says both <em>which word</em> and <em>where it is</em>.</p>`),
    figure('positionalInput', [
      matrixTable({ title: 'E[id]', matrix: d.embeddings, rowLabels: tokenLabels(d), colLabels: dims, small: true }),
      op('+'),
      matrixTable({ title: 'P[pos]', matrix: s.weights.positional.slice(0, n), rowLabels: tokenLabels(d), colLabels: dims, small: true }),
      op('='),
      matrixTable({ title: 'X', matrix: d.positionalInput, rowLabels: tokenLabels(d), colLabels: dims }),
    ]),
    prose(`<p>For instance, the first number of the first row, <strong>X[0][0]</strong>, is the first coordinate of “${esc(first)}” plus the first coordinate of “position 0”:</p>`),
    sumExample('X[0][0]', [[`E[${d.tokenIds[0]}][0]`, d.embeddings[0][0]], ['P[0][0]', s.weights.positional[0][0]]]),
    callout('try', `<ul>
      <li>Set an entire row of E to 0. That word becomes “blank”: its rows in X are now purely position. Watch what happens to it in Chapter 3.</li>
      <li>Make P all zeros. Repeated words become identical again, and the model loses any sense of order.</li>
    </ul>`),
    callout('key', `<p>From this point on, nothing is saved. X and everything after it are <span class="tag derived">recomputed</span> from E, P and the token IDs whenever any of them change.</p>`),
    underHood('X[i] = E[ id[i] ] + P[i]', `<p>E is <code>vocab × d</code>, P is <code>positions × d</code>, X is <code>tokens × d</code>. Real models often learn P too, or use cleverer position tricks, but “add a position pattern” is the core idea.</p>`),
  ]);

  content.replaceChildren(location, lookup, positions, x, chapterNav('embeddings.html'));
}

bindRender(render);
