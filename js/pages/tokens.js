import { getExperiment, getDerived, setSentence, sentenceProblem } from '../state.js';
import { learnBpe, tokenizeWords, tokenizeChars, WORD_START } from '../transformer.js';
import { initPage, bindRender, el, esc, lesson, prose, callout, underHood, matrixTable, chapterNav, caption, windowOf, sliceRows, lensBar } from '../ui.js';
import { player, chapterControls } from '../player.js';
import { tokenizeScene, idScene, bpeScene } from '../scenes.js';

initPage('tokens.html');
const content = document.getElementById('content');
const STAGES_HERE = ['tokens', 'tokenIds'];

function render() {
  const s = getExperiment();
  const d = getDerived();
  const win = windowOf(d.tokens.length);
  const mergesN = s.config.merges ?? 50;
  const bpe = learnBpe(s.sentence, mergesN);
  const words = tokenizeWords(s.sentence);
  const chars = tokenizeChars(s.sentence).length;

  const textarea = el('textarea', { text: s.sentence, 'aria-label': 'Training text' });
  const problem = el('p', { class: 'fig-caption problem', hidden: !s.notice, text: s.notice || '' });
  const apply = () => {
    const why = sentenceProblem(textarea.value);
    problem.textContent = why || '';
    problem.hidden = !why;
    if (!why && !setSentence(textarea.value)) textarea.value = getExperiment().sentence;
  };
  textarea.addEventListener('input', () => { const why = sentenceProblem(textarea.value); problem.textContent = why || ''; problem.hidden = !why; });
  textarea.addEventListener('change', apply);
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } });

  const intro = lesson('Start with a sentence', [
    prose(`<p>This is the text the whole book follows. It is one of the very few things that is actually <span class="tag stored">saved</span>; every other number you will meet is computed from it. Change it whenever you like — press Enter to apply. Nothing is worked out until you press play on a stage.</p>`),
    el('div', { class: 'card' }, [textarea, problem]),
  ]);

  const pieces = lesson('Step one: cut it into pieces', [
    prose(`<p>The model doesn't work with a sentence, it works with a list of <strong>tokens</strong>. The obvious choice — one token per word — has two problems. A word the model has never seen is a dead end: there is no row for it. And the dictionary grows without bound, because every spelling, every name and every typo needs its own entry. Cutting into single letters fixes both, but then a sentence becomes a very long list and the model has to relearn what “cat” is from c, a, t every time.</p>
      <p>So real models cut text into <strong>pieces</strong> that range from a single character up to a whole common word: “tokenization” might become “token” + “ization”; a rare name becomes a handful of fragments; “the” stays one piece. Nothing is a dead end, because in the worst case a word falls apart into characters. This book uses the most common way of deciding the pieces, <strong>byte-pair encoding</strong> (BPE), which is what GPT, Llama and Mistral use.</p>
      <p>BPE is learned, not designed. Start from single characters. Count which two neighbouring symbols sit next to each other most often, glue them into one new symbol, and repeat. Every merge is learned from the text — here, from yours. (The name comes from an older compression trick on bytes; GPT-style tokenizers literally start from the 256 possible bytes, so that any text at all can be tokenised. Ours starts from characters and, like the original recipe, merges only inside words.)</p>`),
    callout('idea', `<p>It is how you learn to read fast. At first you spell out c-a-t; after seeing “cat” a few hundred times, it is one glance. Rare words you still sound out in chunks. BPE does the same by counting.</p>`),
    player({ id: 'bpe', track: false, key: `${s.sentence}|${mergesN}`, scene: bpeScene({
      initial: bpe.initial, merges: bpe.merges, steps: bpe.steps,
      idle: `Press play to learn the merges from your text, one at a time. ▁ marks the start of a word; “${WORD_START}t” (t starting a word) and “t” (t inside a word) are different symbols.`,
    }) }),
    el('p', { class: 'fig-caption', text: `Merges stop when no pair occurs at least twice${bpe.merges.length < mergesN ? ` (after ${bpe.merges.length} here)` : ` or after ${mergesN}`}. Your text is ${chars} characters, ${words.length} words, and ${d.tokens.length} tokens.` }),
    prose(`<p>With the merges learned, tokenising is mechanical: cut every word into characters and apply the merges in order. Each token also gets a <strong>position</strong>, 0 for the first, 1 for the second, and so on. Hold on to that; it matters in Chapter 2.</p>`),
    player({ id: 'tokens', scene: tokenizeScene({ sentence: s.sentence, tokens: d.tokens, win, idle: `Press play to scan the sentence and pull out one token at a time${win.partial ? ` (positions ${win.start}–${win.end - 1}; slide the lens for the rest)` : ''}.` }) }),
  ]);

  const numbering = lesson('Step two: give every piece a number', [
    prose(`<p>Next the model keeps a <strong>dictionary</strong>: every distinct piece it has ever seen, with a number next to it. Turning the tokens into numbers is then just a lookup.</p>`),
    callout('idea', `<p>It works like a coat check. Hand over a piece, get a ticket number. Hand over the same piece later and you get the <em>same</em> number — “${esc(s.vocab[0])}” is always ticket 0 in this dictionary, no matter where it appears.</p>`),
    player({ id: 'tokenIds', scene: idScene({ tokens: sliceRows(d.tokens, win), ids: sliceRows(d.tokenIds, win), vocab: s.vocab, offset: win.start, idle: 'Press play to look each token up in the dictionary.' }) }),
    caption('Highlighted dictionary rows are pieces in your current text. Pieces from earlier texts keep their tickets.'),
    callout('try', `<ul>
      <li>Add a word that isn't in the text yet — say, <em>“hat”</em>. It is cut into pieces; pieces already in the dictionary keep their tickets, new ones get the next free numbers.</li>
      <li>Repeat a word. Its pieces get the same IDs each time. The model can't yet tell the two copies apart — Chapter 2 fixes that.</li>
      <li>Put a made-up word in your prompt in Chapter 6. It still becomes tokens — that is the whole point of subwords. (Pieces never seen in your text have no ticket yet; a tokenizer trained on the whole web almost never meets one.)</li>
    </ul>`, null, [
      { label: 'Add “hat” to the text', run: () => setSentence(`${getExperiment().sentence} hat`), then: 'tokenIds' },
      { label: `Repeat “${esc(words[0] || '')}” at the end`, run: () => setSentence(`${getExperiment().sentence} ${words[0] || ''}`), then: 'tokenIds' },
    ]),
    callout('key', `<p>A token is whatever the tokenizer says it is — often a word, sometimes a fragment, occasionally a single character. Ticket numbers carry no meaning: “cat” being 1 and “sat” being 2 does not make them similar. Meaning is added in the next chapter, and it is learned. Real vocabularies hold from about 30,000 pieces (BERT) through 50,257 (GPT-2) and 128,000 (Llama 3) to 256,000 (Gemma), learned once from a huge corpus and then frozen.</p>`),
    underHood('merges = learnBpe(text, 50)   tokens = applyBpe(text, merges)   ids = tokens.map(t => vocab.indexOf(t))',
      `<p>Byte-pair encoding: Sennrich, Haddow &amp; Birch (2016). Other subword families exist — WordPiece (BERT) and Unigram (T5) — and solve the same problem. The vocabulary only ever grows: a new piece is appended, existing IDs are never renumbered, so every piece's row in the embedding table (next chapter) stays put.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), lensBar(d.tokens.length), intro, pieces, numbering, chapterNav('tokens.html'));
}

bindRender(render, { quietKeys: ['view'] });
