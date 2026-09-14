// js/scenes.js
// Scene builders: turn a computed stage into a sequence of small captioned
// steps for player.js. Scenes only describe presentation order and wording;
// every number comes from transformer.js via getDerived().

import { el, esc, fmt, pct, matrixTable, dotExample, op } from './ui.js';

const row = (children) => el('div', { class: 'figure-row' }, children);
// "= output" wraps as one unit so the equals sign is never orphaned at a line end.
const result = (node) => el('div', { class: 'figure-row result' }, [op('='), node]);
export const worked = (html) => el('div', { class: 'worked', html });
export const vec = (v, d = 2) => `[${v.map((x) => fmt(x, d)).join(', ')}]`;

function doneCaption(text) { return `<span class="done-mark">Done.</span> ${text}`; }

// C[i][j] = A[i] · B[:,j]  — one cell per step, row-major.
export function matmulScene({
  A, B, C, aTitle, bTitle, cTitle, aRows, aCols, bCols, bByRow = false,
  idle, tail = null, cHeat = 'diverging', cDecimals = 2, done,
}) {
  const n = C.length;
  const m = C[0].length;
  const colOf = (j) => (bByRow ? B[j] : B.map((r) => r[j]));
  return {
    total: n * m,
    frame(k) {
      const idx = Math.min(k, n * m) - 1;
      const i = k ? Math.floor(idx / m) : null;
      const j = k ? idx % m : null;
      const body = row([
        matrixTable({ title: aTitle, matrix: A, rowLabels: aRows, colLabels: aCols, hlRow: i, small: true }),
        op('·'),
        bByRow
          ? matrixTable({ title: bTitle, matrix: B, rowLabels: bCols, colLabels: aCols, hlRow: j, small: true })
          : matrixTable({ title: bTitle, matrix: B, rowLabels: aCols, colLabels: bCols, hlCol: j, small: true }),
        result(matrixTable({ title: cTitle, matrix: C, rowLabels: aRows, colLabels: bCols, heat: cHeat, decimals: cDecimals,
          filled: (r, c) => r * m + c < k, hlCell: k ? [i, j] : null, pulse: k ? [i, j] : null })),
      ]);
      if (!k) return { body, caption: idle };
      const caption = `<b>${cTitle}[${i}][${j}]</b> — row “${esc(aRows[i])}” of ${aTitle} dotted with ${bByRow ? 'row' : 'column'} <b>${esc(bCols[j])}</b> of ${bTitle}.`
        + (k === n * m ? ` ${doneCaption(done || `All ${n}×${m} cells of ${cTitle} are computed.`)}` : '');
      const extra = tail ? tail(i, j) : '';
      return { body, caption, worked: dotExample(`${cTitle}[${i}][${j}]`, A[i], colOf(j), { aName: `${aTitle}[${i}]`, bName: `${bTitle}[${bByRow ? j : ':,' + j}]`, tail: extra }) };
    },
  };
}

// Output row i depends on row i of each input — one row per step.
export function rowScene({ inputs, ops = [], output, idle, explain, done, extra = null }) {
  const n = output.matrix.length;
  return {
    total: n,
    frame(k) {
      const i = k ? Math.min(k, n) - 1 : null;
      const parts = [];
      inputs.forEach((inp, idx) => {
        if (idx) parts.push(op(ops[idx - 1] || '+'));
        parts.push(matrixTable({ ...inp, hlRow: i, small: inp.small ?? true }));
      });
      parts.push(result(matrixTable({ ...output, filled: (r) => r < k, hlRow: i })));
      const body = extra ? el('div', { class: 'stack' }, [row(parts), extra(k)]) : row(parts);
      if (!k) return { body, caption: idle };
      const ex = explain(i);
      const caption = ex.caption + (k === n ? ` ${doneCaption(done || 'Every row is computed.')}` : '');
      return { body, caption, worked: ex.worked ? worked(ex.worked) : null };
    },
  };
}

// Output row i is a copy of table row ids[i] — one token per step.
export function lookupScene({ table, ids, tokens, output, idle, explain, done }) {
  const n = ids.length;
  return {
    total: n,
    frame(k) {
      const i = k ? Math.min(k, n) - 1 : null;
      const body = row([
        matrixTable({ ...table, hlRow: k ? ids[i] : null, small: true }),
        op('→'),
        matrixTable({ ...output, filled: (r) => r < k, hlRow: i }),
      ]);
      if (!k) return { body, caption: idle };
      return { body, caption: explain(i) + (k === n ? ` ${doneCaption(done || '')}` : '') };
    },
  };
}

// Sentence → tokens, one token per step.
export function tokenizeScene({ sentence, tokens, idle }) {
  const lower = sentence.toLowerCase();
  const spans = [];
  let cursor = 0;
  for (const t of tokens) {
    const at = lower.indexOf(t, cursor);
    spans.push([at, at + t.length]);
    cursor = at + t.length;
  }
  const n = tokens.length;
  return {
    total: n,
    frame(k) {
      const pieces = [];
      let pos = 0;
      spans.forEach(([a, b], i) => {
        if (a > pos) pieces.push(el('span', { class: 'gap', text: sentence.slice(pos, a) }));
        pieces.push(el('span', { class: i < k - 1 ? 'seen' : i === k - 1 ? 'cur' : 'todo', text: sentence.slice(a, b) }));
        pos = b;
      });
      if (pos < sentence.length) pieces.push(el('span', { class: 'gap', text: sentence.slice(pos) }));
      const body = el('div', { class: 'stack' }, [
        el('div', { class: 'sentence-scan' }, pieces),
        el('div', { class: 'chips' }, tokens.slice(0, k).map((t, i) => el('span', { class: `chip ${i === k - 1 ? 'pulse' : ''}` }, [t, el('small', { text: `#${i}` })]))),
      ]);
      if (!k) return { body, caption: idle };
      const t = tokens[k - 1];
      const kind = /^[a-z0-9']+$/.test(t) ? 'a word' : 'a punctuation mark';
      return { body, caption: `Token <b>#${k - 1}</b>: “${esc(t)}” — ${kind}, lower-cased, at position ${k - 1}.` + (k === n ? ` ${doneCaption(`${n} tokens.`)}` : '') };
    },
  };
}

// Tokens → IDs, one lookup per step.
export function idScene({ tokens, ids, vocab, idle }) {
  const n = tokens.length;
  return {
    total: n,
    frame(k) {
      const i = k ? k - 1 : null;
      const body = row([
        matrixTable({ title: 'The dictionary', matrix: vocab.map((w, id) => [id]), rowLabels: vocab, colLabels: ['ticket'], decimals: 0, heat: null, hlRow: k ? ids[i] : null, small: true }),
        op('→'),
        el('div', { class: 'chips', style: 'align-self:center' }, tokens.map((t, idx) => el('span', { class: `chip arrow ${idx === i ? 'pulse' : ''} ${idx >= k ? 'todo' : ''}` }, [t, ' → ', el('b', { text: idx < k ? ids[idx] : '?' })]))),
      ]);
      if (!k) return { body, caption: idle };
      return { body, caption: `“${esc(tokens[i])}” is ticket <b>${ids[i]}</b> in the dictionary.` + (k === n ? ` ${doneCaption(`The model now holds ${vec(ids, 0)} — and never sees the words again.`)}` : '') };
    },
  };
}

// K → Kᵀ, one row-becomes-column per step.
export function transposeScene({ K, KT, tokens, dims, idle }) {
  const n = K.length;
  return {
    total: n,
    frame(k) {
      const i = k ? k - 1 : null;
      const body = row([
        matrixTable({ title: 'K', matrix: K, rowLabels: tokens, colLabels: dims, hlRow: i, small: true }),
        op('⤵'),
        matrixTable({ title: 'Kᵀ', matrix: KT, rowLabels: dims, colLabels: tokens, filled: (r, c) => c < k, hlCol: i }),
      ]);
      if (!k) return { body, caption: idle };
      return { body, caption: `Row ${i} of K (the badge of “${esc(tokens[i]).replace(/ \d+$/, '')}”) becomes column ${i} of Kᵀ.` + (k === n ? ` ${doneCaption('Same numbers, turned on their side, so one multiplication can compare every question with every badge.')}` : '') };
    },
  };
}

// Probabilities → prediction, one position per step.
export function predictionScene({ probs, vocab, tokens, prediction, idle }) {
  const n = probs.length;
  return {
    total: n,
    frame(k) {
      const i = k ? k - 1 : null;
      const table = el('table', { class: 'pred' }, [
        el('thead', {}, el('tr', {}, ['after', 'bets on', 'how sure', 'actually next', ''].map((t) => el('th', { text: t })))),
        el('tbody', {}, prediction.map((p, r) => {
          const actual = r + 1 < n ? tokens[r + 1] : null;
          const hit = actual != null && p.token === actual;
          const shown = r < k;
          return el('tr', { class: r === i ? 'hlrow' : '' }, [
            el('td', { class: 'word', text: tokens[r] }),
            el('td', { class: 'word' }, shown ? el('strong', { text: p.token }) : '·'),
            el('td', {}, shown ? [el('span', { class: 'bar', style: `width:${Math.max(4, p.prob * 80)}px` }), pct(p.prob)] : ''),
            el('td', { class: 'word', text: actual ?? '— (end)' }),
            el('td', { class: !shown || actual == null ? '' : hit ? 'ok' : 'miss', text: !shown || actual == null ? '' : hit ? '✓' : '✗' }),
          ]);
        })),
      ]);
      const body = row([
        matrixTable({ title: 'Probabilities', matrix: probs, rowLabels: tokens, colLabels: vocab, heat: 'sequential', decimals: 2, hlRow: i, hlCell: k ? [i, prediction[i].id] : null, small: true }),
        op('→'),
        table,
      ]);
      if (!k) return { body, caption: idle };
      const p = prediction[i];
      const actual = i + 1 < n ? tokens[i + 1] : null;
      const verdict = actual == null ? 'There is no next word in the text to check against.' : p.token === actual ? 'That is right.' : `The text actually continues with “${esc(actual)}”.`;
      return { body, caption: `After “${esc(tokens[i])}”, the biggest number in the row is <b>${pct(p.prob)}</b> for “${esc(p.token)}”. ${verdict}` + (k === n ? ` ${doneCaption('')}` : '') };
    },
  };
}
