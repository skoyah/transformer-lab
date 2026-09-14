import { tokenize, forwardIds, generate, topK, lossOf } from '../transformer.js';
import { getExperiment, getDerived, untrainedExperiment, setPlayground, addWords, train } from '../state.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, chapterNav, matrixTable } from '../ui.js';

initPage('playground.html');
const content = document.getElementById('content');

let rerolls = 0;          // session-only: which random draw to use when sampling
let selected = null;      // session-only: which generated token's attention is shown

// These inputs live across re-renders so typing and dragging are never interrupted.
let renderTimer = null;
const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); };
const prompt = el('input', { type: 'text', 'aria-label': 'Prompt', style: 'width:100%; font-family: var(--serif); font-size: 1.15rem; padding: .6rem .8rem', placeholder: 'type a few words the model knows…',
  oninput: (e) => { setPlayground({ prompt: e.target.value }); scheduleRender(); } });
const stepsInput = el('input', { type: 'number', min: 1, max: 12, 'aria-label': 'Words to write',
  onchange: (e) => { setPlayground({ steps: Math.max(1, Math.min(12, Number(e.target.value) || 1)) }); render(); } });
const tempInput = el('input', { type: 'range', min: 0, max: 2, step: 0.1, 'aria-label': 'Creativity',
  oninput: (e) => { setPlayground({ temperature: Number(e.target.value) }); scheduleRender(); } });

function promptIds(s, words) {
  return words.filter((w) => s.vocab.includes(w)).map((w) => s.vocab.indexOf(w));
}

function suggestionBar(model, ids, label) {
  if (ids.length === 0) return el('div', { class: 'keyboard' }, [el('span', { class: 'note', text: 'Type a word the model knows…' })]);
  const d = forwardIds(model, ids);
  const row = d.probs[ids.length - 1];
  const top = topK(row, 3);
  return el('div', { class: 'keyboard' }, top.map((t, i) => el('button', {
    class: `key ${i === 0 ? 'best' : ''}`, title: `${pct(t.p, 1)} · click to append`,
    onclick: () => setPlayground({ prompt: `${getExperiment().playground.prompt.trim()} ${model.vocab[t.id]}` }),
  }, [model.vocab[t.id], el('small', { text: pct(t.p) })])));
}

function generatedText(model, ids, pg, which) {
  const out = generate(model, ids, { steps: pg.steps, temperature: pg.temperature, seed: rerolls });
  const chips = [
    ...ids.map((id) => el('span', { class: 'chip prompt', text: model.vocab[id] })),
    ...out.map((g, i) => el('button', {
      class: `chip gen ${selected && selected.which === which && selected.i === i ? 'sel' : ''}`,
      style: `--conf:${g.prob.toFixed(2)}`, title: `${pct(g.prob, 1)} sure · click to see what it looked at`,
      onclick: () => { selected = { which, i }; render(); },
    }, [g.token, el('small', { text: pct(g.prob) })])),
  ];
  let trace = null;
  if (selected && selected.which === which && out[selected.i]) {
    const g = out[selected.i];
    const ctx = g.context.map((id) => model.vocab[id]);
    trace = el('div', { class: 'trace' }, [
      el('p', { class: 'fig-caption', style: 'margin:0 0 .4rem', text: `To choose “${g.token}”, the last position listened to:` }),
      el('div', { class: 'bars' }, ctx.map((w, j) => el('div', { class: 'barrow' }, [
        el('span', { class: 'w', text: w }),
        el('span', { class: 'bar', style: `width:${Math.max(2, g.attention[j] * 160)}px` }),
        el('span', { class: 'p', text: pct(g.attention[j]) }),
      ]))),
      el('p', { class: 'fig-caption', style: 'margin:.5rem 0 0', text: `Runner-up bets: ${topK(g.probs, 4).slice(1).map((t) => `${model.vocab[t.id]} ${pct(t.p)}`).join(' · ')}` }),
    ]);
  }
  return el('div', {}, [el('div', { class: 'chips' }, chips), trace]);
}

function modelCard(title, sub, model, ids, pg, which) {
  return el('div', { class: `card model ${which}` }, [
    el('div', { class: 'model-head' }, [el('h3', { style: 'margin:0', text: title }), el('span', { class: 'fig-caption', style: 'margin:0', text: sub })]),
    el('div', { class: 'sub', text: 'Next-word suggestions' }),
    suggestionBar(model, ids, which),
    el('div', { class: 'sub', text: 'Let it write' }),
    generatedText(model, ids, pg, which),
  ]);
}

function render() {
  // Capture focus first: building the new tree moves the persistent inputs, which blurs them.
  const active = document.activeElement;
  const sel = active === prompt ? [prompt.selectionStart, prompt.selectionEnd] : null;
  const s = getExperiment();
  const d = getDerived();
  const pg = s.playground;
  const fresh = untrainedExperiment();
  const words = tokenize(pg.prompt);
  const unknown = [...new Set(words.filter((w) => !s.vocab.includes(w)))];
  const ids = promptIds(s, words);
  const steps = s.trainingHistory.length;
  const lossNow = lossOf(s);
  const lossFresh = lossOf(fresh);

  const intro = lesson('The keyboard on your phone', [
    prose(`<p>When you type a message and three suggested words appear above the keyboard, this is what happened: your words were turned into tokens, run through a model like the one in this book, and the top three bets came out. Chatbots do the same thing in a loop — pick a word, add it to the text, run again.</p>
      <p>Below, the exact model you have been reading about does both jobs. To make the difference visible, it runs twice: once with <strong>freshly rolled weights</strong> (the same random start you had before touching anything), and once with <strong>your current weights</strong>, ${steps ? `after ${steps} training step${steps > 1 ? 's' : ''}` : 'which you have not trained yet'}.</p>`),
    steps ? null : callout('try', `<p>You haven't trained the model yet, so both sides will look equally clueless. Press <strong>Train 25 steps</strong> below (or go to Chapter 5) and come back — that's the whole point of this page.</p>`),
  ]);

  if (document.activeElement !== prompt) prompt.value = pg.prompt;
  stepsInput.value = pg.steps;
  if (document.activeElement !== tempInput) tempInput.value = pg.temperature;
  const rerollBtn = el('button', { text: 'Different draw', onclick: () => { rerolls++; selected = null; render(); }, disabled: pg.temperature <= 0 });
  const controls = el('div', { class: 'card' }, [
    el('label', {}, ['Your prompt (saved)', prompt]),
    unknown.length ? el('p', { class: 'fig-caption', style: 'margin-top:.6rem' }, [
      `The model has never seen ${unknown.map((w) => `“${w}”`).join(', ')} — those words are skipped. `,
      el('button', { class: 'ghost', style: 'color: var(--accent)', text: `Teach it ${unknown.length > 1 ? 'these words' : 'this word'} (random meaning)`, onclick: () => addWords(unknown) }),
    ]) : null,
    el('div', { class: 'controls', style: 'margin-top: .9rem' }, [
      el('label', {}, ['Words to write', stepsInput]),
      el('label', {}, [`Creativity (temperature) — ${pg.temperature <= 0 ? 'always the favourite' : pg.temperature < 0.8 ? 'mostly the favourite' : pg.temperature <= 1.2 ? 'roll the dice as the model bets' : 'wild'}`, tempInput]),
      rerollBtn,
      el('button', { class: 'primary', text: 'Train 25 steps', onclick: (e) => { e.target.disabled = true; e.target.textContent = 'Training…'; setTimeout(() => train(25), 20); } }),
    ]),
  ]);

  const compare = el('div', { class: 'compare' }, [
    modelCard('Fresh model', `same seed, never trained · surprise on your text ${fmt(lossFresh, 2)}`, fresh, ids, pg, 'fresh'),
    modelCard('Your model', `${steps} training step${steps === 1 ? '' : 's'}${steps ? '' : ' (edits only)'} · surprise ${fmt(lossNow, 2)}`, s, ids, pg, 'yours'),
  ]);

  const demo = lesson('Fresh vs. trained', [
    controls,
    compare,
    prose(`<p>The suggestion keys are the model's top three bets for the next word (tap one to accept it, like on a phone). “Let it write” keeps going for ${pg.steps} words; the small number is how sure it was. Click a written word to see which earlier words it paid attention to when choosing — that's Chapter 3, live.</p>`),
    callout('try', `<ul>
      <li>Train 25 steps and compare the two columns. The fresh model spreads its bets thinly; yours should reproduce your text almost word for word — it has memorised it, which is all a tiny model trained on one sentence can do.</li>
      <li>Start the prompt with a word from the <em>middle</em> of your text. Does your model continue correctly from there?</li>
      <li>Turn creativity up to 1.5 and hit “different draw” a few times. Same weights, different words — that's sampling, and it's why a chatbot never answers exactly the same way twice.</li>
      <li>Change the training text on the Start page to two or three sentences that share words, train 50 steps, and see if it learns to switch between them.</li>
    </ul>`),
  ]);

  const params = ['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'Wout'].reduce((acc, k) => acc + s.weights[k].flat().length, 0) + s.weights.b1.length + s.weights.b2.length;
  const scale = lesson('Same recipe, a billion times bigger', [
    prose(`<p>What separates this toy from a chatbot is scale, not kind. Every ingredient you saw is there in production models — just more of it, stacked deeper, trained on trillions of words instead of one sentence.</p>`),
    el('div', { class: 'card flush' }, el('div', { class: 'scroll' }, el('table', { class: 'pred scale' }, [
      el('thead', {}, el('tr', {}, ['', 'This book', 'A large model (order of magnitude)'].map((t) => el('th', { text: t })))),
      el('tbody', {}, [
        ['Dictionary', `${s.vocab.length} words`, '~100,000 word-pieces'],
        ['Numbers per word (d)', `${s.config.dim}`, '~10,000'],
        ['Attention heads', '1', '~100 per layer'],
        ['Blocks stacked', '1', '~100'],
        ['Weights to learn', `${params.toLocaleString()}`, '~100,000,000,000+'],
        ['Training text', `${d.tokens.length} tokens`, '~10,000,000,000,000 tokens'],
        ['How gradients are found', 'try every nudge', 'backpropagation (all at once)'],
      ].map((r) => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'word' : '', text: c }))))),
    ]))),
    callout('key', `<p>Tokens → embeddings → attention → feed-forward → next-word bet, repeated. If you followed the numbers in this book, you understand the machine. The rest is engineering and scale.</p>`),
  ]);

  content.replaceChildren(intro, demo, scale, chapterNav('playground.html'));
  if (active === prompt || active === tempInput || active === stepsInput) {
    active.focus({ preventScroll: true });
    if (sel) prompt.setSelectionRange(sel[0], sel[1]);
  }
}

bindRender(render);
