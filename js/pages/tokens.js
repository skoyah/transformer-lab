import { getExperiment, getDerived, setSentence } from '../state.js';
import { initPage, bindRender, el, esc, lesson, prose, callout, underHood, figure, matrixTable, chapterNav, caption } from '../ui.js';

initPage('tokens.html');
const content = document.getElementById('content');

function render() {
  const s = getExperiment();
  const d = getDerived();
  const used = new Set(s.tokenIds);

  const textarea = el('textarea', { text: s.sentence, 'aria-label': 'Training text' });
  const apply = () => { if (!setSentence(textarea.value)) textarea.value = getExperiment().sentence; };
  textarea.addEventListener('change', apply);
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } });

  const intro = lesson('Start with a sentence', [
    prose(`<p>This is the text the whole book follows. It is one of the very few things that is actually <span class="tag stored">saved</span>; every other number you will meet is computed from it. Change it whenever you like — press Enter to apply.</p>`),
    el('div', { class: 'card' }, [textarea]),
  ]);

  const chopping = lesson('Step one: chop it up', [
    prose(`<p>The model doesn't work with a sentence, it works with a list of <strong>tokens</strong>. Ours are simple: lowercase words, with punctuation marks kept as tokens of their own. Real models use fancier pieces (often chunks of words), but the idea is the same — a fixed menu of units.</p>
      <p>Each token also gets a <strong>position</strong>, 0 for the first, 1 for the second, and so on. Hold on to that; it matters in Chapter 2.</p>`),
    figure('tokens', [el('div', { class: 'chips' }, d.tokens.map((t, i) => el('span', { class: 'chip' }, [t, el('small', { text: `#${i}` })])))],
      `${d.tokens.length} tokens. The small number is the position.`),
  ]);

  const numbering = lesson('Step two: give every word a number', [
    prose(`<p>Next the model keeps a <strong>dictionary</strong>: every distinct word it has ever seen, with a number next to it. Turning the tokens into numbers is then just a lookup.</p>`),
    callout('idea', `<p>It works like a coat check. Hand over a word, get a ticket number. Hand over the same word later and you get the <em>same</em> number — “the” is always ticket 0 in this dictionary, no matter where it appears.</p>`),
    el('div', { class: 'figure-row' }, [
      el('div', { class: 'card figure', style: 'flex: 0 1 auto' }, [
        matrixTable({ title: 'The dictionary', matrix: s.vocab.map((w, id) => [id]), rowLabels: s.vocab, colLabels: ['ticket'], decimals: 0, heat: null, highlightRows: used, small: true }),
        caption('Highlighted words appear in your current text. Words from earlier texts keep their tickets.'),
      ]),
      el('div', { class: 'card figure', dataset: { stage: 'tokenIds' }, id: 'tokenIds', style: 'flex: 1 1 20rem' }, [
        el('div', { class: 'chips' }, d.tokens.map((t, i) => el('span', { class: 'chip arrow' }, [t, ' → ', el('b', { text: d.tokenIds[i] })]))),
        caption('The token IDs. From here on, the model never sees the words again — only these numbers.'),
      ]),
    ]),
    callout('try', `<ul>
      <li>Add a word that isn't in the dictionary yet — say, <em>“hat”</em>. It gets the next free ticket and nothing else changes.</li>
      <li>Repeat a word. Notice it gets the same ID each time. The model can't yet tell the two copies apart — Chapter 2 fixes that.</li>
    </ul>`),
    callout('key', `<p>Ticket numbers carry no meaning. “cat” being 1 and “sat” being 2 does not make them neighbours or similar in any way. Meaning is added in the next chapter, and it is learned, not assigned.</p>`),
    underHood('tokens = sentence.toLowerCase().match(/[a-z0-9\']+|[^\\sa-z0-9\']/g);  ids = tokens.map(t => vocab.indexOf(t))',
      `<p>The vocabulary only ever grows: a new word is appended, existing IDs are never renumbered, so every word's row in the embedding table (next chapter) stays put.</p>`),
  ]);

  content.replaceChildren(intro, chopping, numbering, chapterNav('tokens.html'));
}

bindRender(render);
