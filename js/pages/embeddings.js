import { getExperiment, getDerived, setWeightCell, setWeights, untrainedExperiment } from '../state.js';
import { initPage, bindRender, el, esc, fmt, lesson, prose, callout, underHood, matrixTable, compareToggle, compareOn, chapterNav, tokenLabelsWin, dimLabels, windowOf, sliceRows, lensBar } from '../ui.js';
import { player, chapterControls } from '../player.js';
import { lookupScene, rowScene, vec } from '../scenes.js';

initPage('embeddings.html');
const content = document.getElementById('content');
const STAGES_HERE = ['embeddings', 'positionalInput'];

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const n = d.tokens.length;
  const win = windowOf(n);
  const toks = tokenLabelsWin(d.tokens, win);
  const used = new Set(s.tokenIds);
  const dimCount = s.config.dim;
  const fresh = compareOn() ? untrainedExperiment() : null;

  const location = lesson('Give every word a location', [
    prose(`<p>A word's ID says <em>which</em> word it is, nothing more. What the model needs is something it can do arithmetic with. So each word gets a row of <strong>${dimCount} numbers</strong> — its <strong>embedding</strong>. You can think of them as coordinates: every word is a point in a ${dimCount}-dimensional space, and words that behave alike end up near each other.</p>
      <p>Nobody types these numbers in. They start random and are <em>learned</em> — in Chapter 5 you'll watch them move. Real models use hundreds or thousands of numbers per word; we use ${dimCount} so you can read them.</p>`),
    callout('idea', `<p>Imagine describing food with ${dimCount} sliders — sweet, salty, spicy, crunchy. Every dish becomes ${dimCount} numbers, and “similar dishes” means “similar slider settings”. An embedding is the same idea for words, except the model decides for itself what the sliders mean.</p>`),
    el('div', { class: 'card figure' }, [
      compareToggle(render),
      matrixTable({
        title: 'Embedding table E', matrix: s.weights.embedding, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims,
        editable: true, highlightRows: used, cornerLabel: 'id', onEdit: (r, c, v) => setWeightCell('embedding', r, c, v),
        compare: fresh ? fresh.weights.embedding : null,
      }),
      el('p', { class: 'fig-caption', text: 'One row per dictionary word. Blue is negative, orange positive; stronger colour, bigger number. Highlighted rows are used by your text. Click any number to change it — it is saved, and the stages after it go back to waiting for play. Keyboard: ↑/↓ nudge by 0.1 (Shift ±1, Alt ±0.01), ←/→ move between cells, Enter saves and moves down, Esc reverts.' }),
    ]),
  ]);

  const lookup = lesson('Look up each token', [
    prose(`<p>Turning IDs into embeddings is not a calculation, it's a lookup: position <em>i</em> simply copies row <code>id[i]</code> of the table. The result has one row per token.</p>`),
    player({ id: 'embeddings', scene: lookupScene({
      table: { title: 'E', matrix: s.weights.embedding, rowLabels: s.vocab.map((w, i) => `${i} ${w}`), colLabels: dims },
      ids: sliceRows(d.tokenIds, win), tokens: sliceRows(d.tokens, win),
      output: { title: 'Rows picked for your text', matrix: sliceRows(d.embeddings, win), rowLabels: toks, colLabels: dims },
      idle: 'Press play to copy one row of E per token.',
      explain: (i) => { const g = win.rows[i]; return `Position <b>${g}</b> is “${esc(d.tokens[g])}”, ticket ${d.tokenIds[g]} — copy row ${d.tokenIds[g]} of E.` + (d.tokenIds.indexOf(d.tokenIds[g]) < g ? ' Same word as earlier, so the very same row.' : ''); },
      done: 'Repeated words have identical rows — the model cannot yet tell them apart.',
    }) }),
  ]);

  const positions = lesson('Same word, different seat', [
    prose(`<p>There's a catch. If “the” appears twice, both copies get exactly the same row — and later stages have no idea which came first. Word order matters in language, so we need to <strong>stamp the position onto each row</strong>.</p>
      <p>We keep a second table, <strong>P</strong>, with one row per position. Row 0 is a fixed pattern for “first”, row 1 for “second”, and so on. Adding P[pos] to the word's embedding gives every copy of a word its own flavour.</p>`),
    callout('idea', `<p>It's the seat number on a ticket. Two people can hold tickets for the same film (same word), but seat 3 and seat 7 are different tickets (same word + different position).</p>`),
    el('div', { class: 'card figure' }, [
      matrixTable({
        title: 'Position table P', matrix: s.weights.positional, rowLabels: s.weights.positional.map((_, i) => `pos ${i}`), colLabels: dims,
        editable: true, highlightRows: new Set(win.rows), onEdit: (r, c, v) => setWeightCell('positional', r, c, v),
      }),
      el('p', { class: 'fig-caption', text: 'Starts as a wave pattern (sines and cosines of the position), which is what the original transformer used. Why waves? Any distinct pattern per position would do, but with sines the pattern for “two seats further along” looks the same wherever you are in the text, so the model can learn relative distances once and reuse them. Only the highlighted rows are needed for your text. Editable and saved like any weight.' }),
    ]),
  ]);

  const x = lesson('Put them together', [
    prose(`<p>Add the two tables row by row and we have <strong>X</strong>, the input to the transformer block. Every row now says both <em>which word</em> and <em>where it is</em>.</p>`),
    player({ id: 'positionalInput', scene: rowScene({
      inputs: [
        { title: 'E[id]', matrix: sliceRows(d.embeddings, win), rowLabels: toks, colLabels: dims },
        { title: 'P[pos]', matrix: sliceRows(s.weights.positional, win), rowLabels: toks, colLabels: dims },
      ],
      ops: ['+'],
      output: { title: 'X', matrix: sliceRows(d.positionalInput, win), rowLabels: toks, colLabels: dims },
      idle: 'Press play to add the position pattern to each row.',
      explain: (i) => { const g = win.rows[i]; return {
        caption: `Row <b>${g}</b>: the embedding of “${esc(d.tokens[g])}” plus the pattern for position ${g}.`,
        worked: `<span class="lhs">X[${g}]</span><span class="eq">=</span><span class="a">${vec(d.embeddings[g])}</span><span class="eq">+</span><span class="b">${vec(s.weights.positional[g])}</span><span class="eq">=</span><span class="result">${vec(d.positionalInput[g])}</span>`,
      }; },
      done: 'X is the input to the transformer block. From here on nothing is saved — everything is recomputed from E, P and the IDs.',
    }) }),
    callout('try', `<ul>
      <li>Set an entire row of E to 0. That word becomes “blank”: its rows in X are now purely position. Watch what happens to it in Chapter 3.</li>
      <li>Make P all zeros. Repeated words become identical again, and the model loses any sense of order.</li>
    </ul>`, null, [
      { label: `Blank out “${esc(d.tokens[0])}” (row ${d.tokenIds[0]} of E → 0)`, run: () => {
        const E = getExperiment().weights.embedding.map((r) => r.slice()); E[d.tokenIds[0]] = E[d.tokenIds[0]].map(() => 0); setWeights({ embedding: E });
      }, then: 'embeddings' },
      { label: 'Zero the position table', run: () => setWeights({ positional: getExperiment().weights.positional.map((r) => r.map(() => 0)) }), then: 'positionalInput' },
    ]),
    callout('key', `<p>From this point on, nothing is saved. X and everything after it are <span class="tag derived">recomputed</span> from E, P and the token IDs whenever any of them change — but only when you press play.</p>`),
    underHood('X[i] = E[ id[i] ] + P[i]', `<p>E is <code>vocab × d</code>, P is <code>positions × d</code>, X is <code>tokens × d</code>. Real models often learn P too, or use cleverer position tricks, but “add a position pattern” is the core idea.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), lensBar(n), location, lookup, positions, x, chapterNav('embeddings.html'));
}

bindRender(render, { quietKeys: ['view'] });
