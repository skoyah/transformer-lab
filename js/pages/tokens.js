import { getExperiment, getDerived, setSentence, sentenceProblem, setTokenizer } from '../state.js';
import { learnBpe, tokenizeWords, tokenizeChars, tokenize, WORD_START } from '../transformer.js';
import { initPage, bindRender, el, esc, lesson, prose, callout, underHood, matrixTable, chapterNav, caption, windowOf, sliceRows, lensBar } from '../ui.js';
import { player, chapterControls } from '../player.js';
import { tokenizeScene, idScene, bpeScene } from '../scenes.js';

initPage('tokens.html');
const content = document.getElementById('content');
const STAGES_HERE = ['tokens', 'tokenIds'];
let bpeMergesPreview = null; // session: merges shown in the BPE player while the scheme is not bpe

function render() {
  const s = getExperiment();
  const d = getDerived();
  const win = windowOf(d.tokens.length);

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

  const chopping = lesson('Step one: chop it up', [
    prose(`<p>The model doesn't work with a sentence, it works with a list of <strong>tokens</strong>. To begin with, ours are simple: lowercase words, with punctuation marks kept as tokens of their own. Real models use fancier pieces — chunks of words — and the last section of this chapter lets you switch to those. The idea is always the same: a fixed menu of units.</p>
      <p>Each token also gets a <strong>position</strong>, 0 for the first, 1 for the second, and so on. Hold on to that; it matters in Chapter 2.</p>`),
    player({ id: 'tokens', scene: tokenizeScene({ sentence: s.sentence, tokens: d.tokens, win, idle: `Press play to scan the sentence and pull out one token at a time${win.partial ? ` (positions ${win.start}–${win.end - 1}; slide the lens for the rest)` : ''}.` }) }),
  ]);

  const numbering = lesson('Step two: give every word a number', [
    prose(`<p>Next the model keeps a <strong>dictionary</strong>: every distinct word it has ever seen, with a number next to it. Turning the tokens into numbers is then just a lookup.</p>`),
    callout('idea', `<p>It works like a coat check. Hand over a word, get a ticket number. Hand over the same word later and you get the <em>same</em> number — “${esc(s.vocab[0])}” is always ticket 0 in this dictionary, no matter where it appears.</p>`),
    player({ id: 'tokenIds', scene: idScene({ tokens: sliceRows(d.tokens, win), ids: sliceRows(d.tokenIds, win), vocab: s.vocab, offset: win.start, idle: 'Press play to look each token up in the dictionary.' }) }),
    caption('Highlighted dictionary rows are words in your current text. Words from earlier texts keep their tickets.'),
    callout('try', `<ul>
      <li>Add a word that isn't in the dictionary yet — say, <em>“hat”</em>. It gets the next free ticket and nothing else changes.</li>
      <li>Repeat a word. Notice it gets the same ID each time. The model can't yet tell the two copies apart — Chapter 2 fixes that.</li>
    </ul>`, null, [
      { label: 'Add “hat” to the text', run: () => setSentence(`${getExperiment().sentence} hat`), then: 'tokenIds' },
      { label: `Repeat “${esc(d.tokens[0])}” at the end`, run: () => setSentence(`${getExperiment().sentence} ${d.tokens[0]}`), then: 'tokenIds' },
    ]),
    callout('key', `<p>Ticket numbers carry no meaning. “cat” being 1 and “sat” being 2 does not make them neighbours or similar in any way. Meaning is added in the next chapter, and it is learned, not assigned.</p>`),
    underHood('tokens = sentence.toLowerCase().match(/[a-z0-9\']+|[^\\sa-z0-9\']/g);  ids = tokens.map(t => vocab.indexOf(t))',
      `<p>The vocabulary only ever grows: a new word is appended, existing IDs are never renumbered, so every word's row in the embedding table (next chapter) stays put.</p>`),
  ]);

  // ---- Tokens are not always words ----
  const scheme = s.config.tokenizer || 'words';
  const mergesN = s.config.merges ?? 20;
  const bpe = learnBpe(s.sentence, scheme === 'bpe' ? mergesN : (bpeMergesPreview ?? mergesN));
  const counts = { words: tokenizeWords(s.sentence).length, chars: tokenizeChars(s.sentence).length, bpe: tokenize(s.sentence, { scheme: 'bpe', merges: mergesN, trainingText: s.sentence }).length };
  const pick = (value, label, hint) => el('label', { class: 'inline' }, [
    el('input', { type: 'radio', name: 'scheme', value, checked: scheme === value, onchange: () => setTokenizer({ scheme: value }) }),
    el('span', {}, [el('strong', { text: label }), ` — ${hint} (${counts[value]} tokens)`]),
  ]);
  const mergesInput = el('input', { type: 'number', min: 0, max: 200, value: mergesN, style: 'width:5rem', onchange: (e) => setTokenizer({ merges: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }) });
  const sample = 'tokenization';
  const sampleBpe = tokenize(sample, { scheme: 'bpe', merges: mergesN, trainingText: s.sentence });
  const notWords = lesson('Tokens are not always words', [
    prose(`<p>Splitting on spaces is the simplest possible tokenizer, and it has two problems. A word the model has never seen is a dead end (there is no row for it). And the dictionary grows without bound — every spelling, every name, every typo needs its own ticket. Real models solve this by splitting text into <strong>pieces</strong> that range from a single character up to a whole common word. “tokenization” might become “token” + “ization”; a rare name becomes a handful of fragments. A word is never a dead end, because in the worst case it falls apart into single characters — and GPT-style tokenizers go one step further and start from the 256 possible <em>bytes</em>, so that literally any text can be tokenised.</p>
      <p>The most common way to decide the pieces is <strong>byte-pair encoding</strong> (BPE, Sennrich et al. 2016; the name comes from an older compression trick on bytes): start from the smallest units, count which two neighbouring symbols occur together most often, glue them into one new symbol, and repeat. Every merge is learned from the text. Ours starts from characters and merges only within words, like the original; other families exist (WordPiece in BERT, Unigram in T5), but they solve the same problem. Try it on your own text below.</p>`),
    el('div', { class: 'card' }, [
      el('div', { class: 'scheme-picker' }, [
        el('strong', { style: 'font: 600 13px/1 var(--sans); color: var(--muted); margin-right: .3rem', text: 'TOKENIZER (saved)' }),
        pick('words', 'Words', 'split on spaces'),
        pick('chars', 'Characters', 'one token per character, ▁ for a space'),
        pick('bpe', 'Subwords (BPE)', `characters glued by ${mergesN} learned merges`),
        el('label', { class: 'inline' }, ['merges to learn', mergesInput]),
      ]),
      el('p', { class: 'fig-caption', text: `Changing the tokenizer re-tokenises the text; every stage after this goes back to waiting for play. With BPE, “${sample}” would become ${sampleBpe.map((t) => `“${t}”`).join(' + ')} using the merges learned from your text.` }),
    ]),
    player({ id: 'bpe', track: false, key: `${s.sentence}|${scheme === 'bpe' ? mergesN : bpeMergesPreview ?? mergesN}`, scene: bpeScene({
      initial: bpe.initial, merges: bpe.merges, steps: bpe.steps,
      idle: `Press play to learn the merges from your text, one at a time. ▁ marks the start of a word; “${WORD_START}t” and “t” are different symbols.`,
    }) }),
    callout('key', `<p>A token is whatever the tokenizer says it is: a word, a character, or a learned fragment. Everything after this page works the same way regardless — it only ever sees the ticket numbers. Real vocabularies range from about 30,000 pieces (BERT) through 50,257 (GPT-2) and 128,000 (Llama 3) to 256,000 (Gemma), learned once from a huge corpus and then frozen.</p>`),
    callout('try', `<ul>
      <li>Switch to <strong>Characters</strong>: the sequence gets much longer, the dictionary tiny. Attention (Chapter 3) then has to work much harder to relate letters that belong together.</li>
      <li>Switch to <strong>Subwords</strong> and set merges to 0, 5, 20: watch the token count fall as common pairs get glued.</li>
      <li>Put a word in your prompt (Chapter 6) that is not in the text. With words it is skipped entirely; with subwords it is cut into pieces, and any piece that already has a ticket can be used — only pieces never seen before are skipped. (Ours learns from your text alone, so that happens more than it would with a tokenizer trained on the whole web.)</li>
    </ul>`, null, [
      { label: 'Use characters', run: () => setTokenizer({ scheme: 'chars' }), then: 'tokens' },
      { label: 'Use subwords (BPE)', run: () => setTokenizer({ scheme: 'bpe' }), then: 'bpe' },
      { label: 'Back to words', run: () => setTokenizer({ scheme: 'words' }), then: 'tokens' },
    ]),
  ]);

  content.replaceChildren(chapterControls(STAGES_HERE), lensBar(d.tokens.length), intro, chopping, numbering, notWords, chapterNav('tokens.html'));
}

bindRender(render, { quietKeys: ['view'] });
