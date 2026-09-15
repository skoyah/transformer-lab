import { getExperiment, getDerived, setWeightCell, setWeights } from '../state.js';
import { initPage, bindRender, el, esc, fmt, lesson, prose, callout, underHood, matrixTable, normStrip, chapterNav, tokenLabels, dimLabels } from '../ui.js';
import { player, chapterControls, SPEEDS } from '../player.js';
import { matmulScene, rowScene, vec } from '../scenes.js';

initPage('ffn.html');
const content = document.getElementById('content');
const STAGES_HERE = ['residual1', 'norm1', 'ffnHidden', 'ffnOutput', 'residual2', 'norm2'];

function layerNormExplain(input, output, tokens, dims, speed) {
  return (i) => {
    const r = input[i];
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length;
    return {
      caption: `Row <b>${i}</b> (“${esc(tokens[i])}”): subtract its average ${fmt(mean)}, divide by its spread ${fmt(Math.sqrt(variance + 1e-5))}.`,
      worked: `<span class="a">${vec(r)}</span><span class="eq">− ${fmt(mean)}</span><span class="eq">÷ ${fmt(Math.sqrt(variance + 1e-5))}</span><span class="eq">=</span><span class="result">${vec(output[i])}</span>`,
      extra: normStrip({ values: r, labels: dims, stepMs: SPEEDS[speed] || SPEEDS.normal }),
    };
  };
}

function addExplain(aName, A, bName, B, C, tokens) {
  return (i) => ({
    caption: `Row <b>${i}</b> (“${esc(tokens[i])}”): ${aName} plus ${bName}, number by number.`,
    worked: `<span class="a">${vec(A[i])}</span><span class="eq">+</span><span class="b">${vec(B[i])}</span><span class="eq">=</span><span class="result">${vec(C[i])}</span>`,
  });
}

function render() {
  const s = getExperiment();
  const d = getDerived();
  const dims = dimLabels(s.config.dim);
  const hid = dimLabels(s.config.hidden, 'h');
  const toks = tokenLabels(d);

  const residual = lesson('Keep the original, add what you heard', [
    prose(`<p>After attention, each word holds Z — a blend of other words' notes. But we don't want the word to <em>forget itself</em>. So instead of replacing X with Z, we add them: the word keeps its own row and gets the gathered information on top. This is called a <strong>residual connection</strong>, and it is one of the reasons deep networks are trainable at all.</p>`),
    callout('idea', `<p>It's editing with track changes rather than retyping the document. The original text stays; attention only has to propose the <em>changes</em>. Small, safe edits are much easier to learn than rewriting everything from scratch.</p>`),
    player({ id: 'residual1', scene: rowScene({
      inputs: [
        { title: 'X (input)', matrix: d.positionalInput, rowLabels: toks, colLabels: dims },
        { title: 'Z (attention)', matrix: d.attentionOutput, rowLabels: toks, colLabels: dims },
      ],
      ops: ['+'],
      output: { title: 'R₁', matrix: d.residual1, rowLabels: toks, colLabels: dims },
      idle: 'Press play to add the attention output back onto the input, row by row.',
      explain: addExplain('the original X', d.positionalInput, 'what attention gathered', d.attentionOutput, d.residual1, d.tokens),
    }) }),
  ]);

  const norm = lesson('Normalise the volume', [
    prose(`<p>Adding things together makes numbers drift: some rows end up loud, others quiet. Before the next step we standardise each row so it has an average of 0 and a typical spread of 1. This is <strong>layer normalisation</strong>. It removes each row's average and rescales its spread, which keeps every later stage working in a comfortable range.</p>`),
    player({ id: 'norm1', scene: rowScene({
      inputs: [{ title: 'R₁', matrix: d.residual1, rowLabels: toks, colLabels: dims }],
      output: { title: 'N₁ — normalised', matrix: d.norm1, rowLabels: toks, colLabels: dims },
      idle: 'Press play to normalise each row.',
      explain: layerNormExplain(d.residual1, d.norm1, d.tokens, dims, s.animation.speed),
      done: 'Every row now averages 0 with spread 1.',
    }) }),
    underHood('N[i] = (R[i] − mean(R[i])) / sqrt(var(R[i]) + ε)', `<p>Done independently for each row. Real models also learn a scale and shift per column; we leave those out to keep the picture clean.</p>`),
  ]);

  const think = lesson('A moment of private thought', [
    prose(`<p>Attention moved information <em>between</em> words. Now each word, on its own, gets to process what it has. It goes through a tiny two-layer network — the <strong>feed-forward</strong> block:</p>
      <ol>
        <li>expand from ${s.config.dim} numbers to ${s.config.hidden} (W₁, plus a bias b₁) — more room to think;</li>
        <li>keep only the positive results (<strong>ReLU</strong>) — the only non-linear step inside this block; without it the two layers would collapse into one multiplication;</li>
        <li>squeeze back to ${s.config.dim} numbers (W₂, plus b₂).</li>
      </ol>
      <p>The same small network is applied to every row separately; the rows don't interact here at all.</p>`),
    callout('idea', `<p>ReLU is a bouncer that only lets good news through: anything negative becomes 0, anything positive passes unchanged. It sounds crude, but “detect a feature, ignore it if absent” is exactly what a network needs to build up rules.</p>`),
    el('div', { class: 'card figure' }, [
      el('div', { class: 'figure-row' }, [
        matrixTable({ title: 'W₁ — expand', matrix: s.weights.W1, rowLabels: dims, colLabels: hid, editable: true, onEdit: (r, c, v) => setWeightCell('W1', r, c, v) }),
        matrixTable({ title: 'b₁', matrix: [s.weights.b1], rowLabels: ['bias'], colLabels: hid, editable: true, onEdit: (r, c, v) => setWeightCell('b1', r, c, v) }),
      ]),
      el('div', { class: 'figure-row', style: 'margin-top:1rem' }, [
        matrixTable({ title: 'W₂ — squeeze', matrix: s.weights.W2, rowLabels: hid, colLabels: dims, editable: true, onEdit: (r, c, v) => setWeightCell('W2', r, c, v) }),
        matrixTable({ title: 'b₂', matrix: [s.weights.b2], rowLabels: ['bias'], colLabels: dims, editable: true, onEdit: (r, c, v) => setWeightCell('b2', r, c, v) }),
      ]),
      el('p', { class: 'fig-caption', text: 'The feed-forward weights. In real models this block holds most of the parameters — it is where “knowledge” tends to live.' }),
    ]),
    player({ id: 'ffnHidden', scene: matmulScene({
      A: d.norm1, B: s.weights.W1, C: d.ffnHidden, aTitle: 'N₁', bTitle: 'W₁', cTitle: 'H', aRows: toks, aCols: dims, bCols: hid,
      idle: 'Press play to expand each row: dot product, add the bias, then ReLU.',
      tail: (i, j) => {
        const pre = d.norm1[i].reduce((acc, x, k) => acc + x * s.weights.W1[k][j], 0) + s.weights.b1[j];
        return ` <span class="eq">+ b₁[${j}]</span> <b>${fmt(s.weights.b1[j])}</b> <span class="eq">= ${fmt(pre)} → ReLU →</span> <span class="result">${fmt(d.ffnHidden[i][j])}</span>${pre < 0 ? ' <span class="eq">(negative, so 0)</span>' : ''}`;
      },
      done: 'Zeros are where ReLU said no.',
    }) }),
    el('div', { class: 'card flush fires' }, [
      el('strong', { style: 'font: 600 13px/1.3 var(--sans)', text: 'What each hidden unit responds to' }),
      el('p', { class: 'fig-caption', style: 'margin:.2rem 0 .5rem', text: 'A hidden unit “fires” for a token when ReLU lets its value through. Untrained, this is noise; after training, units tend to specialise.' }),
      el('div', { class: 'fires-list' }, hid.map((h, j) => {
        const firing = d.tokens.map((t, i) => ({ t, v: d.ffnHidden[i][j] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
        return el('div', { class: 'fire' }, [
          el('code', { text: h }),
          el('span', { text: firing.length ? ` fires for ${firing.map((x) => `${x.t} (${fmt(x.v, 1)})`).join(', ')}` : ' never fires for this text' }),
        ]);
      })),
    ]),
    player({ id: 'ffnOutput', scene: matmulScene({
      A: d.ffnHidden, B: s.weights.W2, C: d.ffnOutput, aTitle: 'H', bTitle: 'W₂', cTitle: 'F', aRows: toks, aCols: hid, bCols: dims,
      idle: 'Press play to squeeze each row back to the usual size.',
      tail: (i, j) => ` <span class="eq">+ b₂[${j}]</span> <b>${fmt(s.weights.b2[j])}</b> <span class="eq">=</span> <span class="result">${fmt(d.ffnOutput[i][j])}</span>`,
      done: 'F is each word\'s private thought, ready to be added back.',
    }) }),
  ]);

  const again = lesson('And once more: add, then normalise', [
    prose(`<p>Same trick as before. The thought F is added onto the row it came from, and the result is normalised. That's the end of one transformer <strong>block</strong>. Big models stack dozens of these; the output of one block is simply the X of the next.</p>`),
    player({ id: 'residual2', scene: rowScene({
      inputs: [
        { title: 'N₁', matrix: d.norm1, rowLabels: toks, colLabels: dims },
        { title: 'F', matrix: d.ffnOutput, rowLabels: toks, colLabels: dims },
      ],
      ops: ['+'],
      output: { title: 'R₂', matrix: d.residual2, rowLabels: toks, colLabels: dims },
      idle: 'Press play to add the thought back onto the row it came from.',
      explain: addExplain('N₁', d.norm1, 'the thought F', d.ffnOutput, d.residual2, d.tokens),
    }) }),
    player({ id: 'norm2', scene: rowScene({
      inputs: [{ title: 'R₂', matrix: d.residual2, rowLabels: toks, colLabels: dims }],
      output: { title: 'N₂ — the block\'s output', matrix: d.norm2, rowLabels: toks, colLabels: dims },
      idle: 'Press play to normalise once more.',
      explain: layerNormExplain(d.residual2, d.norm2, d.tokens, dims, s.animation.speed),
      done: 'One final vector per token. Chapter 5 turns these into predictions.',
    }) }),
    callout('try', `<ul>
      <li>Set every value of <strong>b₁</strong> to −5. ReLU now blocks everything, H becomes all zeros, and F collapses to just b₂ for every word.</li>
      <li>Set <strong>W₂</strong> to all zeros. The block's thought contributes nothing; N₂ becomes a normalised copy of N₁ — the residual path alone carries the signal.</li>
    </ul>`, null, [
      { label: 'b₁ → −5 everywhere', run: () => setWeights({ b1: s.weights.b1.map(() => -5) }), then: 'ffnHidden' },
      { label: 'W₂ → all zeros', run: () => setWeights({ W2: s.weights.W2.map((r) => r.map(() => 0)) }), then: 'norm2' },
    ]),
    callout('key', `<p>A transformer block is two moves, each wrapped in “add to the original and normalise”: <em>attention</em> (words exchange information) and <em>feed-forward</em> (each word processes it alone).</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), residual, norm, think, again, chapterNav('ffn.html'));
}

bindRender(render);
