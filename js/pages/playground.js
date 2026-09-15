import { tokenize, forwardIds, generate, topK, lossOf, trainStep } from '../transformer.js';
import { getExperiment, getDerived, untrainedExperiment, setPlayground, addWords, train } from '../state.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, chapterNav, matrixTable, attentionArcs } from '../ui.js';
import { player, groupControls } from '../player.js';
import { worked } from '../scenes.js';

initPage('playground.html');
const content = document.getElementById('content');

let rerolls = 0;          // session-only: which random draw to use when sampling

// Training timeline: deterministic replay of the recorded steps from the
// fresh model, cached per step. checkpoint === null means "now".
const replay = { cache: [], key: null, busy: false, target: null };
let checkpoint = null;
function replayKey(s) { return `${s.seed}|${s.config.dim}|${s.config.hidden}|${s.vocab.length}|${s.trainingHistory.length}`; }
function weightsAt(s, fresh, k) {
  if (replay.key !== replayKey(s)) { replay.cache = [fresh.weights]; replay.key = replayKey(s); }
  if (replay.cache.length > k) return replay.cache[k];
  return null; // not computed yet — replayTo() fills the cache in chunks
}
function replayTo(s, fresh, k) {
  replay.target = k;
  if (replay.busy) return;
  replay.busy = true;
  const chunk = () => {
    const cur = getExperiment();
    if (replayKey(cur) !== replay.key) { replay.cache = [fresh.weights]; replay.key = replayKey(cur); }
    const t0 = performance.now();
    while (replay.cache.length <= replay.target && performance.now() - t0 < 60) {
      const i = replay.cache.length - 1;
      const lr = cur.trainingHistory[i]?.learningRate ?? cur.learningRate;
      replay.cache.push(trainStep({ ...fresh, weights: replay.cache[i] }, lr).weights);
    }
    render();
    if (replay.cache.length <= replay.target) setTimeout(chunk, 0); else replay.busy = false;
  };
  setTimeout(chunk, 0);
}

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

function generateScene(model, ids, pg, out) {
  const n = out.length;
  return {
    total: n,
    frame(k) {
      const chips = [
        ...ids.map((id) => el('span', { class: 'chip prompt', text: model.vocab[id] })),
        ...out.slice(0, k).map((g, i) => el('span', { class: `chip gen ${i === k - 1 ? 'pulse' : ''}`, style: `--conf:${g.prob.toFixed(2)}`, title: `${pct(g.prob, 1)} sure` }, [g.token, el('small', { text: pct(g.prob) })])),
        ...out.slice(k).map(() => el('span', { class: 'chip gen todo', text: '…' })),
      ];
      const body = el('div', { class: 'chips' }, chips);
      if (ids.length === 0) return { body, caption: 'Type a word the model knows to give it something to continue.' };
      if (!k) return { body, caption: `Press play to let it write ${n} word${n > 1 ? 's' : ''}, one at a time.` };
      const g = out[k - 1];
      const ctx = g.context.map((id) => model.vocab[id]);
      const bars = el('div', { class: 'bars' }, ctx.map((w, j) => el('div', { class: 'barrow' }, [
        el('span', { class: 'w', text: w }),
        el('span', { class: 'bar', style: `width:${Math.max(2, g.attention[j] * 160)}px` }),
        el('span', { class: 'p', text: pct(g.attention[j]) }),
      ])));
      const bets = topK(g.probs, 4).map((t) => `${model.vocab[t.id]} ${pct(t.p)}`).join(' · ');
      return {
        body,
        caption: `Word <b>${k}</b>: run the whole block on “${esc(ctx.join(' '))}”, take the last position's bet — <b>“${esc(g.token)}”</b> at ${pct(g.prob)}${pg.temperature > 0 ? ' (drawn from the bets, not always the favourite)' : ''} — and append it.` + (k === n ? ' <span class="done-mark">Done.</span>' : ''),
        worked: el('div', { class: 'trace' }, [
          el('p', { class: 'fig-caption', style: 'margin:0 0 .4rem', text: 'What the last position listened to (Chapter 3, live):' }),
          attentionArcs({ tokens: ctx, rows: [{ i: ctx.length - 1, w: g.attention }], focus: ctx.length - 1 }),
          bars,
          el('p', { class: 'fig-caption', style: 'margin:.5rem 0 0', text: `Top bets: ${bets}` }),
        ]),
      };
    },
  };
}

function modelCard(title, sub, model, ids, pg, which) {
  return el('div', { class: `card model ${which}` }, [
    el('div', { class: 'model-head' }, [el('h3', { style: 'margin:0', text: title }), el('span', { class: 'fig-caption', style: 'margin:0', text: sub })]),
    el('div', { class: 'sub', text: 'Next-word suggestions' }),
    suggestionBar(model, ids, which),
    el('div', { class: 'sub', text: 'Let it write' }),
    player({
      id: `gen-${which}`, track: false,
      key: JSON.stringify([ids, pg.steps, pg.temperature, rerolls, model.updatedAt, model.trainingHistory.length, which === 'yours' ? checkpoint : null]),
      scene: generateScene(model, ids, pg, generate(model, ids, { steps: pg.steps, temperature: pg.temperature, seed: rerolls })),
    }),
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
  const rerollBtn = el('button', { text: 'Different draw', onclick: () => { rerolls++; render(); }, disabled: pg.temperature <= 0 });
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

  // Which version of "your model" to show: now, or a replayed checkpoint.
  let yours = s;
  let yoursSub = `${steps} training step${steps === 1 ? '' : 's'}${steps ? '' : ' (edits only)'} · surprise ${fmt(lossNow, 2)}`;
  let timelineNote = '';
  if (checkpoint != null && checkpoint < steps) {
    const w = weightsAt(s, fresh, checkpoint);
    if (w) {
      yours = { ...s, weights: w, trainingHistory: s.trainingHistory.slice(0, checkpoint) };
      yoursSub = `replayed to step ${checkpoint} of ${steps} · surprise ${fmt(lossOf(yours), 2)}`;
    } else {
      replayTo(s, fresh, checkpoint);
      timelineNote = `replaying… ${replay.cache.length - 1} / ${checkpoint}`;
      yoursSub = `replaying to step ${checkpoint}…`;
    }
  }
  const timeline = steps ? el('div', { class: 'card timeline' }, [
    el('div', { class: 'timeline-head' }, [
      el('strong', { text: 'Training timeline' }),
      el('span', { class: 'fig-caption', style: 'margin:0', text: timelineNote || (checkpoint == null || checkpoint >= steps ? `now — after all ${steps} steps` : `after ${checkpoint} step${checkpoint === 1 ? '' : 's'}`) }),
    ]),
    el('input', { type: 'range', min: 0, max: steps, value: checkpoint ?? steps, style: 'width:100%', 'aria-label': 'Training step',
      oninput: (e) => { const k = Number(e.target.value); checkpoint = k >= steps ? null : k; render(); } }),
    el('div', { class: 'timeline-ticks' }, [el('span', { text: 'fresh (0)' }), el('span', { text: `now (${steps})` })]),
    s.handEdited ? el('p', { class: 'fig-caption', text: 'You also edited weights by hand, so the replay will not land exactly on your current model.' }) : null,
    el('p', { class: 'fig-caption', text: 'Drag to watch the same prompt through the model at any point in its training. Every step is recomputed from the fresh weights, so this is the real history, not a recording.' }),
  ]) : null;

  // Cards first: they create the players the group bar drives.
  const cards = el('div', { class: 'compare' }, [
    modelCard('Fresh model', `same seed, never trained · surprise on your text ${fmt(lossFresh, 2)}`, fresh, ids, pg, 'fresh'),
    modelCard(checkpoint != null && checkpoint < steps ? `Your model, step ${checkpoint}` : 'Your model', yoursSub, yours, ids, pg, 'yours'),
  ]);
  const compare = el('div', { class: 'stack' }, [
    timeline,
    el('div', { class: 'card flush' }, groupControls(['gen-fresh', 'gen-yours'], { label: 'Both models, in step' })),
    cards,
  ]);

  const demo = lesson('Fresh vs. trained', [
    controls,
    compare,
    prose(`<p>The suggestion keys are the model's top three bets for the next word (tap one to accept it, like on a phone). Press play under “Let it write” to watch it continue the prompt one word at a time — each step shows which earlier words it paid attention to and what else it considered.</p>`),
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
  } else if (active && active.getAttribute('aria-label') === 'Training step') {
    const next = document.querySelector('input[aria-label="Training step"]');
    if (next) next.focus({ preventScroll: true });
  }
}

bindRender(render);
