import { getExperiment, getDerived, setSentence } from '../state.js';
import { initPage, bindRender, el, esc, lesson, prose, callout, underHood, matrixTable, chapterNav, caption } from '../ui.js';
import { player, chapterControls } from '../player.js';
import { tokenizeScene, idScene } from '../scenes.js';

initPage('tokens.html');
const content = document.getElementById('content');
const STAGES_HERE = ['tokens', 'tokenIds'];

function render() {
  const s = getExperiment();
  const d = getDerived();

  const textarea = el('textarea', { text: s.sentence, 'aria-label': 'Training text' });
  const apply = () => { if (!setSentence(textarea.value)) textarea.value = getExperiment().sentence; };
  textarea.addEventListener('change', apply);
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } });

  const intro = lesson('Start with a sentence', [
    prose(`<p>This is the text the whole book follows. It is one of the very few things that is actually <span class="tag stored">saved</span>; every other number you will meet is computed from it. Change it whenever you like — press Enter to apply. Nothing is worked out until you press play on a stage.</p>`),
    el('div', { class: 'card' }, [textarea]),
  ]);

  const chopping = lesson('Step one: chop it up', [
    prose(`<p>The model doesn't work with a sentence, it works with a list of <strong>tokens</strong>. Ours are simple: lowercase words, with punctuation marks kept as tokens of their own. Real models use fancier pieces (often chunks of words), but the idea is the same — a fixed menu of units.</p>
      <p>Each token also gets a <strong>position</strong>, 0 for the first, 1 for the second, and so on. Hold on to that; it matters in Chapter 2.</p>`),
    player({ id: 'tokens', scene: tokenizeScene({ sentence: s.sentence, tokens: d.tokens, idle: 'Press play to scan the sentence and pull out one token at a time.' }) }),
  ]);

  const numbering = lesson('Step two: give every word a number', [
    prose(`<p>Next the model keeps a <strong>dictionary</strong>: every distinct word it has ever seen, with a number next to it. Turning the tokens into numbers is then just a lookup.</p>`),
    callout('idea', `<p>It works like a coat check. Hand over a word, get a ticket number. Hand over the same word later and you get the <em>same</em> number — “the” is always ticket 0 in this dictionary, no matter where it appears.</p>`),
    player({ id: 'tokenIds', scene: idScene({ tokens: d.tokens, ids: d.tokenIds, vocab: s.vocab, idle: 'Press play to look each token up in the dictionary.' }) }),
    caption('Highlighted dictionary rows are words in your current text. Words from earlier texts keep their tickets.'),
    callout('try', `<ul>
      <li>Add a word that isn't in the dictionary yet — say, <em>“hat”</em>. It gets the next free ticket and nothing else changes.</li>
      <li>Repeat a word. Notice it gets the same ID each time. The model can't yet tell the two copies apart — Chapter 2 fixes that.</li>
    </ul>`),
    callout('key', `<p>Ticket numbers carry no meaning. “cat” being 1 and “sat” being 2 does not make them neighbours or similar in any way. Meaning is added in the next chapter, and it is learned, not assigned.</p>`),
    underHood('tokens = sentence.toLowerCase().match(/[a-z0-9\']+|[^\\sa-z0-9\']/g);  ids = tokens.map(t => vocab.indexOf(t))',
      `<p>The vocabulary only ever grows: a new word is appended, existing IDs are never renumbered, so every word's row in the embedding table (next chapter) stays put.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), intro, chopping, numbering, chapterNav('tokens.html'));
}

bindRender(render, { quietKeys: ['progress'] });
