// js/scenes.js
// Scene builders: turn a computed stage into a sequence of small captioned
// steps for player.js. Scenes only describe presentation order and wording;
// every number comes from transformer.js via getDerived().

import { el, esc, fmt, pct, matrixTable, dotExample, op } from './ui.js';
import { flyGhost } from './player.js';

const row = (children) => el('div', { class: 'figure-row' }, children);
// "= output" wraps as one unit so the equals sign is never orphaned at a line end.
const result = (node) => el('div', { class: 'figure-row result' }, [op('='), node]);
export const worked = (html) => el('div', { class: 'worked', html });
export const vec = (v, d = 2) => `[${v.map((x) => fmt(x, d)).join(', ')}]`;

function doneCaption(text) { return `<span class="done-mark">Done.</span> ${text}`; }

// A clickable reference to a cell of the result table: the player flashes it.
export function cellRef(r, c, html) { return `<a class="cellref" href="#" data-cell="${r},${c}">${html}</a>`; }

// C[i][j] = A[i] · B[:,j]  — one cell per step, row-major.
export function matmulScene({
  A, B, C, aTitle, bTitle, cTitle, aRows, aCols, bCols, bByRow = false,
  idle, tail = null, cHeat = 'diverging', cDecimals = 2, done, extra = null,
}) {
  const n = C.length;
  const m = C[0].length;
  const colOf = (j) => (bByRow ? B[j] : B.map((r) => r[j]));
  const extraOf = (i, j) => (extra ? extra(i, j) : null);
  // Big tables step one row at a time so a player always finishes in a sitting.
  if (n * m > 240) return matmulRowScene({ A, B, C, aTitle, bTitle, cTitle, aRows, aCols, bCols, bByRow, idle, tail, cHeat, cDecimals, done, colOf });
  return {
    total: n * m,
    hover: (i, j) => ({
      sources: [{ table: 0, row: i }, bByRow ? { table: 1, row: j } : { table: 1, col: j }],
      worked: dotExample(`${cTitle}[${aRows[i].replace(/^.* /, '')}][${j}]`, A[i], colOf(j), { aName: `${aTitle}[${aRows[i]}]`, bName: `${bTitle}[${bByRow ? bCols[j] : ':,' + bCols[j]}]`, tail: tail ? tail(i, j) : '', extra: extraOf(i, j) }),
    }),
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
      const caption = `${cellRef(i, j, `<b>${cTitle}[${i}][${j}]</b>`)} — row “${esc(aRows[i])}” of ${aTitle} dotted with ${bByRow ? 'row' : 'column'} <b>${esc(bCols[j])}</b> of ${bTitle}.`
        + (k === n * m ? ` ${doneCaption(done || `All ${n}×${m} cells of ${cTitle} are computed.`)}` : '');
      const tailHtml = tail ? tail(i, j) : '';
      return { body, caption, worked: dotExample(`${cTitle}[${aRows[i].replace(/^.* /, '')}][${j}]`, A[i], colOf(j), { aName: `${aTitle}[${aRows[i]}]`, bName: `${bTitle}[${bByRow ? bCols[j] : ':,' + bCols[j]}]`, tail: tailHtml, extra: extraOf(i, j) }) };
    },
  };
}

function matmulRowScene({ A, B, C, aTitle, bTitle, cTitle, aRows, aCols, bCols, bByRow, idle, tail, cHeat, cDecimals, done, colOf }) {
  const n = C.length;
  const m = C[0].length;
  return {
    total: n,
    hover: (i, j) => ({
      sources: [{ table: 0, row: i }, bByRow ? { table: 1, row: j } : { table: 1, col: j }],
      worked: dotExample(`${cTitle}[${i}][${j}]`, A[i], colOf(j), { aName: `${aTitle}[${i}]`, bName: `${bTitle}[${bByRow ? j : ':,' + j}]`, tail: tail ? tail(i, j) : '' }),
    }),
    frame(k) {
      const i = k ? Math.min(k, n) - 1 : null;
      const body = row([
        matrixTable({ title: aTitle, matrix: A, rowLabels: aRows, colLabels: aCols, hlRow: i, small: true }),
        op('·'),
        bByRow
          ? matrixTable({ title: bTitle, matrix: B, rowLabels: bCols, colLabels: aCols, small: true })
          : matrixTable({ title: bTitle, matrix: B, rowLabels: aCols, colLabels: bCols, small: true }),
        result(matrixTable({ title: cTitle, matrix: C, rowLabels: aRows, colLabels: bCols, heat: cHeat, decimals: cDecimals, filled: (r) => r < k, hlRow: i })),
      ]);
      if (!k) return { body, caption: `${idle} (${n}×${m} cells — this table is big, so each step fills a whole row; hover any cell for its arithmetic.)` };
      const caption = `Row <b>${i}</b> — “${esc(aRows[i])}” of ${aTitle} dotted with every ${bByRow ? 'row' : 'column'} of ${bTitle}: ${m} dot products.`
        + (k === n ? ` ${doneCaption(done || `All ${n}×${m} cells of ${cTitle} are computed.`)}` : '');
      return { body, caption, worked: dotExample(`${cTitle}[${i}][0]`, A[i], colOf(0), { aName: `${aTitle}[${i}]`, bName: `${bTitle}[${bByRow ? 0 : ':,0'}]`, tail: tail ? tail(i, 0) : ' <span class="eq">… and likewise for the other cells of the row</span>' }) };
    },
  };
}

// Output row i depends on row i of each input — one row per step.
export function rowScene({ inputs, ops = [], output, idle, explain, done, extra = null }) {
  const n = output.matrix.length;
  return {
    total: n,
    hover: (i) => {
      const ex = explain(i);
      return { sources: inputs.map((_, t) => ({ table: t, row: i })), worked: ex.worked ? worked(ex.worked) : null };
    },
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
      const workedNode = ex.worked ? worked(ex.worked) : null;
      return { body, caption, worked: ex.extra ? el('div', {}, [workedNode, ex.extra]) : workedNode };
    },
  };
}

// Output row i is a copy of table row ids[i] — one token per step.
export function lookupScene({ table, ids, tokens, output, idle, explain, done }) {
  const n = ids.length;
  return {
    total: n,
    hover: (i) => ({ sources: [{ table: 0, row: ids[i] }], worked: worked(`<span class="lhs">row ${i}</span><span class="eq">=</span> ${esc(table.title)}[${ids[i]}] — “${esc(tokens[i])}”`) }),
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

// Sentence → tokens, one token per step. The reading head scans the token's
// letters one by one (lower-casing them), then the token flies into its chip.
export function tokenizeScene({ sentence, tokens, idle, win = null }) {
  const lower = sentence.toLowerCase();
  const spans = [];
  let cursor = 0;
  for (const t of tokens) {
    // ▁ (word start) is not in the text: match the rest, skipping whitespace; a lone ▁ is a space.
    const bare = t.replace(/^▁/, '');
    let at;
    if (bare === '') { at = lower.indexOf(' ', cursor); if (at < 0) at = cursor; spans.push([at, at + 1]); cursor = at + 1; continue; }
    at = lower.indexOf(bare, cursor);
    if (at < 0) at = cursor;
    spans.push([at, at + bare.length]);
    cursor = at + bare.length;
  }
  // With a lens, only the window's tokens are stepped; earlier ones show as already seen.
  const first = win ? win.start : 0;
  const n = win ? win.size : tokens.length;
  const cur = (k) => first + k - 1;
  return {
    total: n,
    frame(k) {
      const pieces = [];
      let pos = 0;
      spans.forEach(([a, b], i) => {
        if (a > pos) pieces.push(el('span', { class: 'gap', text: sentence.slice(pos, a) }));
        if (i === cur(k)) {
          const original = sentence.slice(a, b);
          pieces.push(el('span', { class: 'cur' }, [...original].map((ch, j) => {
            const lc = ch.toLowerCase();
            return el('span', { class: `ch ${ch !== lc ? 'lowercased' : ''}`, style: `--i:${j}`, dataset: { lc } }, ch);
          })));
        } else {
          const seen = i < cur(k) || (k === 0 && i < first);
          pieces.push(el('span', { class: seen ? 'seen' : 'todo', text: seen ? lower.slice(a, b) : sentence.slice(a, b) }));
        }
        pos = b;
      });
      if (pos < sentence.length) pieces.push(el('span', { class: 'gap', text: sentence.slice(pos) }));
      const shown = tokens.slice(first, first + k);
      const body = el('div', { class: 'stack' }, [
        el('div', { class: 'sentence-scan' }, [el('span', { class: 'head' }), ...pieces]),
        el('div', { class: 'chips' }, [
          first > 0 ? el('span', { class: 'chip todo', text: `… ${first} earlier` }) : null,
          ...shown.map((t, i) => el('span', { class: `chip ${i === k - 1 ? 'pulse' : ''}` }, [t, el('small', { text: `#${first + i}` })])),
        ]),
      ]);
      if (!k) return { body, caption: idle };
      const g = cur(k);
      const t = tokens[g];
      const bare = t.replace(/^▁/, '');
      const kind = t.startsWith('▁') ? (bare.length ? 'the start of a word (▁ marks it)' : 'a space') : /^[a-z0-9']+$/.test(t) ? (t.length === 1 ? 'a character' : 'a word') : 'a punctuation mark';
      const changedCase = sentence.slice(spans[g][0], spans[g][1]) !== bare;
      return {
        body,
        caption: `Token <b>#${g}</b>: “${esc(t)}” — ${kind}${changedCase ? ', lower-cased' : ''}, at position ${g}.` + (k === n ? ` ${doneCaption(`${tokens.length} tokens in total.`)}` : ''),
        animate(root, ms) {
          const cur = root.querySelector('.sentence-scan .cur');
          const chip = root.querySelector('.chips .chip.pulse');
          const chars = [...root.querySelectorAll('.sentence-scan .cur .ch')];
          const perChar = Math.max(25, Math.min(110, (ms * 0.32) / Math.max(1, chars.length)));
          chars.forEach((c, j) => {
            c.style.animationDelay = `${j * perChar}ms`;
            if (c.classList.contains('lowercased')) setTimeout(() => { c.textContent = c.dataset.lc; }, j * perChar + perChar * 0.6);
          });
          const scanMs = chars.length * perChar;
          if (chip) {
            chip.style.visibility = 'hidden';
            setTimeout(() => flyGhost(root, cur, chip, { duration: Math.max(220, Math.min(600, ms * 0.28)), text: t, className: 'chip-ghost' }), scanMs + 40);
          }
        },
      };
    },
  };
}

// Tokens → IDs, one lookup per step: the token travels to its dictionary
// row, and the ticket number travels back into the chip.
export function idScene({ tokens, ids, vocab, idle, offset = 0 }) {
  const n = tokens.length;
  return {
    total: n,
    frame(k) {
      const i = k ? k - 1 : null;
      const body = row([
        matrixTable({ title: 'The dictionary', matrix: vocab.map((w, id) => [id]), rowLabels: vocab, colLabels: ['ticket'], decimals: 0, heat: null, hlRow: k ? ids[i] : null, small: true }),
        op('→'),
        el('div', { class: 'chips', style: 'align-self:center' }, [
          offset > 0 ? el('span', { class: 'chip todo', text: `… ${offset} earlier` }) : null,
          ...tokens.map((t, idx) => el('span', { class: `chip arrow ${idx === i ? 'pulse' : ''} ${idx >= k ? 'todo' : ''}`, title: `position ${offset + idx}` }, [el('span', { class: 'w', text: t }), ' → ', el('b', { text: idx < k ? ids[idx] : '?' })])),
        ]),
      ]);
      if (!k) return { body, caption: idle };
      return {
        body,
        caption: `“${esc(tokens[i])}” (position ${offset + i}) is ticket <b>${ids[i]}</b> in the dictionary.` + (k === n ? ` ${doneCaption(`These positions now read ${vec(ids, 0)} — the model never sees the words again.`)}` : ''),
        animate(root, ms) {
          const chip = root.querySelector('.chips .chip.pulse');
          const wordEl = chip && chip.querySelector('.w');
          const ticketEl = chip && chip.querySelector('b');
          const rowTh = root.querySelector(`table.matrix tr.hlrow th`);
          const rowTd = root.querySelector(`table.matrix tr.hlrow td`);
          if (!chip || !rowTh || !rowTd) return;
          const dur = Math.max(260, Math.min(520, ms * 0.28));
          ticketEl.style.visibility = 'hidden';
          flyGhost(root, wordEl, rowTh, { duration: dur, hideTarget: false, className: 'word-ghost', onLand: () => {
            flyGhost(root, rowTd, ticketEl, { duration: dur, text: String(ids[i]), className: 'ticket-ghost' });
          } });
        },
      };
    },
  };
}

// K → Kᵀ, one row-becomes-column per step.
export function transposeScene({ K, KT, tokens, dims, idle }) {
  const n = K.length;
  return {
    total: n,
    hover: (r, c) => ({ sources: [{ table: 0, row: c, col: r }], worked: worked(`<span class="lhs">Kᵀ[${r}][${c}]</span><span class="eq">=</span> K[${c}][${r}] <span class="eq">=</span> <span class="result">${fmt(K[c][r])}</span>`) }),
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
export function predictionScene({ probs, vocab, tokens, prediction, idle, nextTokens = null, offset = 0 }) {
  const n = probs.length;
  const nextOf = (r) => (nextTokens ? nextTokens[r] : (r + 1 < n ? tokens[r + 1] : null));
  return {
    total: n,
    frame(k) {
      const i = k ? k - 1 : null;
      const table = el('table', { class: 'pred' }, [
        el('thead', {}, el('tr', {}, ['after', 'bets on', 'how sure', 'actually next', ''].map((t) => el('th', { text: t })))),
        el('tbody', {}, prediction.map((p, r) => {
          const actual = nextOf(r);
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
      const actual = nextOf(i);
      const verdict = actual == null ? 'There is no next word in the text to check against.' : p.token === actual ? 'That is right.' : `The text actually continues with “${esc(actual)}”.`;
      return { body, caption: `After “${esc(tokens[i])}” (position ${offset + i}), the biggest number in the row is ${cellRef(i, p.id, `<b>${pct(p.prob)}</b>`)} for “${esc(p.token)}”. ${verdict}` + (k === n ? ` ${doneCaption('')}` : '') };
    },
  };
}

// BPE learning, one merge per step: the text as symbols, the most frequent
// adjacent pair found and merged, the sequence shrinking as it goes.
export function bpeScene({ initial, merges, steps, idle, sampleWords = 40 }) {
  const n = merges.length;
  const render = (words, highlight) => el('div', { class: 'bpe-words' }, words.slice(0, sampleWords).map((syms) => el('span', { class: 'bpe-word' },
    syms.map((sym) => el('span', { class: `sym ${highlight && sym === highlight ? 'just' : ''}`, text: sym })))).concat(words.length > sampleWords ? [el('span', { class: 'fig-caption', text: `… and ${words.length - sampleWords} more words` })] : []));
  const countTokens = (words) => words.reduce((a, w) => a + w.length, 0);
  const vocabOf = (words) => new Set(words.flat()).size;
  return {
    total: n,
    frame(k) {
      const words = k ? steps[k - 1] : initial;
      const merge = k ? merges[k - 1] : null;
      const body = el('div', { class: 'stack' }, [
        render(words, merge && merge.result),
        merge ? el('div', { class: 'bpe-pairs' }, [
          el('span', { class: 'fig-caption', style: 'margin:0', text: 'Most frequent neighbouring pairs before this merge:' }),
          ...merge.top.map(({ pair, count }) => el('span', { class: `pair ${pair[0] === merge.a && pair[1] === merge.b ? 'chosen' : ''}` }, [`${pair[0]} + ${pair[1]}`, el('small', { text: `×${count}` })])),
        ]) : null,
        el('div', { class: 'kpis small' }, [
          el('div', {}, [el('b', { text: `${countTokens(words)}` }), el('span', { text: 'tokens in the text' })]),
          el('div', {}, [el('b', { text: `${vocabOf(words)}` }), el('span', { text: 'distinct symbols' })]),
        ]),
      ]);
      if (!k) return { body, caption: idle };
      return { body, caption: `Merge <b>${k}</b>: “${esc(merge.a)}” + “${esc(merge.b)}” appear side by side <b>${merge.count}</b> times — more than any other pair — so they become one symbol, “${esc(merge.result)}”.` + (k === n ? ` ${doneCaption(`${n} merges learned. GPT-2 learned about 50,000 of these from 40 GB of web text; the procedure is exactly this.`)}` : '') };
    },
  };
}
