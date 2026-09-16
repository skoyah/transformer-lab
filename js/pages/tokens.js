import { getExperiment, getDerived, setSentence, sentenceProblem, usedIds } from '../state.js';
import { bpeFor, tokenize, tokenizerOf, tokenizeWords, tokenSpans, WORD_START, BPE_PLAYER_STEPS } from '../transformer.js';
import { CORPUS } from '../corpus.js';
import { initPage, bindRender, el, esc, lesson, prose, callout, underHood, matrixTable, chapterNav, caption, windowOf, sliceRows, lensBar, pieceChips, recap } from '../ui.js';
import { player, chapterControls } from '../player.js';
import { tokenizeScene, idScene, bpeScene } from '../scenes.js';

initPage('tokens.html');
const content = document.getElementById('content');
const STAGES_HERE = ['tokens', 'tokenIds'];
let anyText = 'strawberry'; // session: the tokenise-anything box

// Type anything, see its pieces. Session-only; never touches the model.
function tokeniseAnything(cut) {
  const input = el('input', { type: 'text', value: anyText, 'aria-label': 'Text to tokenise', placeholder: 'type any word or sentence…' });
  const out = el('div', { class: 'stack' });
  const show = () => {
    const pieces = cut(input.value);
    const letters = [...input.value.replace(/\s+/g, '')].length;
    const bytes = new TextEncoder().encode(input.value.replace(/\s+/g, '')).length;
    const wordsN = tokenizeWords(input.value).length;
    out.replaceChildren(
      pieces.length ? pieceChips(pieces) : el('span', { class: 'fig-caption', text: '…' }),
      el('div', { class: 'stats', text: pieces.length ? `${letters} characters (${bytes} bytes) · ${wordsN} word${wordsN === 1 ? '' : 's'} · ${pieces.length} piece${pieces.length === 1 ? '' : 's'} — about ${(letters / Math.max(1, pieces.length)).toFixed(1)} characters per piece. Pieces with the same underline colour belong to the same word.` : '' }),
    );
  };
  input.addEventListener('input', () => { anyText = input.value; show(); });
  show();
  return el('div', { class: 'card' }, [
    el('strong', { style: 'font: 600 14px/1.3 var(--sans)', text: 'Tokenise anything' }),
    el('p', { class: 'fig-caption', style: 'margin:.2rem 0 .7rem', text: 'Common words stay whole; rare or foreign words fall into fragments; a made-up word still gets pieces; an accented letter or an emoji becomes its bytes (⟨C3⟩⟨A3⟩ is “ã”). Try “Hello” and “hello”. (This box only shows pieces — it does not change the model.)' }),
    el('div', { class: 'tok-any' }, [input]),
    out,
  ]);
}

function strawberryCallout(cut) {
  const word = 'strawberry';
  const pieces = cut(word);
  const rs = [...word].filter((c) => c === 'r').length;
  const per = pieces.map((p) => `“${esc(p.replace(WORD_START, ''))}”${[...p].filter((c) => c === 'r').length ? ` (${[...p].filter((c) => c === 'r').length} r)` : ''}`).join(' + ');
  return callout('key', `<p><strong>Why chatbots struggle to count the r's in “strawberry”.</strong> The model never receives letters. It receives ${pieces.length} tickets — ${per} — and each ticket is just a number: that “ber” contains an r is written nowhere in its ticket. Real tokenizers cut the word into different pieces than ours, but none of them hands the model the letters. To answer, the model has to have <em>learned</em>, from text, how each piece is spelled. That is a strange thing to be bad at and a natural consequence of tokenization; it also explains why models are clumsy with rhymes, character counts and reversing words.</p>`, 'Consequence');
}

function render() {
  const s = getExperiment();
  const d = getDerived();
  const win = windowOf(d.tokens.length);
  const tok = tokenizerOf(s);
  const bpe = bpeFor(CORPUS, tok.merges);
  const corpusWords = tokenizeWords(CORPUS).length;
  const words = tokenizeWords(s.sentence);
  const chars = [...s.sentence.replace(/\s+/g, '')].length;
  const cut = (text) => tokenize(text, tok);

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
    prose(`<p>The model doesn't work with a sentence, it works with a list of <strong>tokens</strong> — pieces of text. Most pieces are whole words; a rare or unusual word is cut into smaller pieces; in the worst case a piece is a single character. Press play to watch your sentence being cut. Each token also gets a <strong>position</strong>: 0 for the first, 1 for the second, and so on. Hold on to that; it matters in Chapter 2.</p>`),
    lensBar(d.tokens),
    player({ id: 'tokens', scene: tokenizeScene({ sentence: s.sentence, tokens: d.tokens, spans: tokenSpans(s.sentence, tok), win, idle: `Press play to scan the sentence and pull out one token at a time${win.partial ? ` (positions ${win.start}–${win.end - 1}; slide the lens for the rest)` : ''}.` }) }),
    prose(`<p>Why pieces, and not simply words? One token per word has two problems. A word the model has never seen is a dead end — there is no row for it. And the dictionary grows without bound, because every spelling, every name and every typo needs its own entry. Cutting into single letters fixes both, but then every sentence becomes a very long list and the model has to relearn what “cat” is from c, a, t each time. Pieces are the compromise real models use: “tokenization” might become “token” + “ization”; a rare name becomes a handful of fragments; “the” stays one piece.</p>`),
    tokeniseAnything(cut),
    strawberryCallout(cut),
    el('details', { class: 'under-hood detour' }, [
      el('summary', { text: 'Where do the pieces come from? (a short detour)' }),
      prose(`<p>The recipe is called <strong>byte-pair encoding</strong> (BPE), used in some variant by GPT, Llama and Mistral. It is learned, not designed. Start from the smallest units — not letters but the <strong>256 possible bytes</strong>, so that any character in any language, and any emoji, can be represented (a letter like “ã” is two bytes, “🍓” is four). Count which two neighbouring symbols sit next to each other most often, glue them into one new symbol, and repeat. A real tokenizer learns from billions of words; this book learns its ${bpe.merges.length} merges once from a small corpus of ${corpusWords} words of plain English that ships with it. The merges are then frozen; your sentence is cut with them, it does not change them. Case is kept: “Hello” and “hello” end up as different tokens.</p>`),
      callout('idea', `<p>It is how you learn to read fast. At first you spell out c-a-t; after seeing “cat” a few hundred times, it is one glance. Rare words you still sound out in chunks. BPE does the same by counting.</p>`),
      player({ id: 'bpe', track: false, key: `corpus|${tok.merges}`, scene: bpeScene({
        initial: bpe.initial, merges: bpe.merges, steps: bpe.steps, corpusWords, totalMerges: bpe.merges.length,
        idle: `Press play to watch the first ${BPE_PLAYER_STEPS} of the ${bpe.merges.length} merges being learned from the corpus. Each step first lights up every place the winning pair occurs, then glues it. ▁ is the space byte in front of a word, so “${WORD_START}t” (t starting a word) and “t” (t inside a word) are different symbols.`,
      }) }),
      prose(`<p>With the merges learned, tokenising is mechanical: cut every word into bytes and apply the ${bpe.merges.length} merges in order. Your text is ${chars} characters, ${words.length} words, and ${d.tokens.length} tokens.</p>`),
    ]),
  ]);

  const numbering = lesson('Step two: give every piece a number', [
    prose(`<p>Next comes the <strong>dictionary</strong>: every piece the tokenizer can produce, with a number next to it. It is fixed before training starts — every piece already has a ticket, whether or not your text uses it. Turning the tokens into numbers is then just a lookup.</p>`),
    callout('idea', `<p>It works like a coat check. Hand over a piece, get a ticket number. Hand over the same piece later and you get the <em>same</em> number — “${esc(d.tokens[0])}” is always ticket ${d.tokenIds[0]} in this dictionary, no matter where it appears.</p>`),
    player({ id: 'tokenIds', scene: idScene({ tokens: sliceRows(d.tokens, win), ids: sliceRows(d.tokenIds, win), vocab: s.vocab, offset: win.start, showIds: usedIds(), idle: 'Press play to look each token up in the dictionary.' }) }),
    caption(`The dictionary has ${s.vocab.length} pieces — the 256 single bytes (tickets 0–255) and one ticket per learned merge (256–${s.vocab.length - 1}) — fixed before any training. Only the rows your text uses are shown.`),
    callout('try', `<ul>
      <li>Add a word that isn't in the text yet — say, <em>“hat”</em>. It is cut into pieces, and every piece already has a ticket; a new row of the dictionary simply becomes used.</li>
      <li>Repeat a word. Its pieces get the same IDs each time. The model can't yet tell the two copies apart — Chapter 2 fixes that.</li>
      <li>Put a made-up word, or an emoji, in your prompt in Chapter 6. It still becomes tokens the model can use — that is the whole point of a byte-level dictionary: it can never meet a piece it doesn't know.</li>
    </ul>`, null, [
      { label: 'Add the word “hat” to my text', run: () => setSentence(`${getExperiment().sentence} hat`), then: 'tokenIds' },
      { label: `Repeat “${esc(words[0] || '')}” at the end of my text`, run: () => setSentence(`${getExperiment().sentence} ${words[0] || ''}`), then: 'tokenIds' },
    ]),
    callout('key', `<p>A token is whatever the tokenizer says it is — often a word, sometimes a fragment, occasionally a single character. Ticket numbers carry no meaning: “cat” being 1 and “sat” being 2 does not make them similar. Meaning is added in the next chapter, and it is learned. Real vocabularies hold from about 30,000 pieces (BERT) through 50,257 (GPT-2) and 128,000 (Llama 3) to 256,000 (Gemma), learned once from a huge corpus and then frozen.</p>`),
    underHood('merges = learnBpe(corpus, 300)   tokens = applyBpe(text, merges)   ids = tokens.map(t => vocab.indexOf(t))   vocab = 256 bytes + 300 merges',
      `<p>Byte-pair encoding: Sennrich, Haddow &amp; Birch (2016); the byte-level variant with a leading-space convention is GPT-2's (Radford et al. 2019), which also lays the vocabulary out this way: bytes first, then merges in the order they were learned. Other subword families exist — WordPiece (BERT) and Unigram (T5) — and solve the same problem. Punctuation gets a leading space byte too, so “mat.” and “mat .” tokenise the same here; GPT-2's pre-tokenizer keeps that distinction.</p>`),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), intro, pieces, numbering, recap([
    'Text is cut into <strong>pieces</strong> (tokens) by a fixed recipe learned from a corpus: common words stay whole, rare ones fragment, nothing is ever unknown.',
    'Every piece the tokenizer can make already has a <strong>ticket number</strong> in a fixed dictionary; your text is now a list of those numbers.',
    'The numbers carry no meaning yet — that is the next chapter.',
  ]), chapterNav('tokens.html'));
}

bindRender(render, { quietKeys: ['view'] });
