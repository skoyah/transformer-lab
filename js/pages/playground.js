import { tokenize, forwardIds, generate, topK, lossOf, trainStep, crossEntropy } from '../transformer.js';
import { getExperiment, getDerived, untrainedExperiment, setPlayground, trainMany, tokenizeLike, MAX_PROMPT_TOKENS } from '../state.js';
import { initPage, bindRender, el, esc, fmt, pct, lesson, prose, callout, chapterNav, matrixTable, attentionArcs, recap } from '../ui.js';
import { checkYourself } from '../quiz.js';
import { player, groupControls } from '../player.js';
import { worked } from '../scenes.js';

initPage('playground.html');
const content = document.getElementById('content');

let rerolls = 0;          // session-only: which random draw to use when sampling
let trainingLabel = null; // while a batch of training runs, the button shows progress

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
  return words.map((w) => s.vocab.indexOf(w)).filter((id) => id >= 0);
}

// Where the prompt occurs in the training text, the words that follow it
// there are what a memorising model "should" write next.
function expectedContinuation(s, ids) {
  if (!ids.length) return null;
  const t = s.tokenIds;
  for (let i = 0; i + ids.length <= t.length; i++) {
    if (ids.every((id, j) => t[i + j] === id)) return t.slice(i + ids.length).map((id) => s.vocab[id]);
  }
  return null;
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

function generateScene(model, ids, pg, out, expected = null) {
  const n = out.length;
  return {
    total: n,
    frame(k) {
      const verdict = (i) => (expected && i < expected.length ? (out[i].token === expected[i] ? 'ok' : 'miss') : '');
      const chips = [
        ...ids.map((id) => el('span', { class: 'chip prompt', text: model.vocab[id] })),
        ...out.slice(0, k).map((g, i) => el('span', { class: `chip gen ${i === k - 1 ? 'pulse' : ''} ${verdict(i)}`, style: `--conf:${g.prob.toFixed(2)}`, title: `${pct(g.prob, 1)} sure` }, [g.token, el('small', { text: pct(g.prob) })])),
        ...out.slice(k).map(() => el('span', { class: 'chip gen todo', text: '…' })),
      ];
      const ghost = expected && expected.length ? el('div', { class: 'ghost-text' }, [
        el('span', { class: 'lbl', text: 'in your text:' }),
        ...ids.map((id) => el('span', { class: 'g prompt', text: model.vocab[id] })),
        ...expected.slice(0, Math.max(n, 1) + 2).map((w, i) => el('span', { class: `g ${i < k ? (out[i] && out[i].token === w ? 'ok' : 'miss') : ''}`, text: w })),
        expected.length > n + 2 ? el('span', { class: 'g', text: '…' }) : null,
      ]) : null;
      const hits = expected ? out.slice(0, k).filter((g, i) => expected[i] === g.token).length : 0;
      const body = el('div', { class: 'stack' }, [el('div', { class: 'chips' }, chips), ghost]);
      if (ids.length === 0) return { body, caption: 'Type a word the model knows to give it something to continue.' };
      if (!k) return { body, caption: `Press play to let it write ${n} word${n > 1 ? 's' : ''}, one at a time.${expected ? ' The grey line shows how your training text actually continues.' : ''}` };
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
        caption: `Word <b>${k}</b>: run the whole block on “${esc(ctx.join(' '))}”, take the last position's bet — <b>“${esc(g.token)}”</b> at ${pct(g.prob)}${pg.temperature > 0 ? ' (drawn from the bets, not always the favourite)' : ''} — and append it.` + (k === n ? ` <span class="done-mark">Done.</span>${expected ? ` ${hits} of ${Math.min(n, expected.length)} match your text.` : ''}` : ''),
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

// e^surprise ≈ how many words the model is effectively choosing between.
function plausibleGauge(model) {
  const V = model.vocab.length;
  const eff = Math.min(V, Math.exp(lossOf(model)));
  const w = Math.max(3, (Math.log(eff) / Math.log(Math.max(V, 2))) * 100);
  return el('div', { class: 'gauge', title: `e^surprise = ${eff.toFixed(2)} of ${V} words` }, [
    el('span', { class: 'gauge-track' }, el('span', { class: 'gauge-fill', style: `width:${w.toFixed(1)}%` })),
    el('span', { class: 'gauge-lbl', text: `hesitating between ≈ ${eff < 10 ? eff.toFixed(1) : Math.round(eff)} of ${V} words` }),
  ]);
}

function modelCard(title, sub, model, ids, pg, which) {
  return el('div', { class: `card model ${which}` }, [
    el('div', { class: 'model-head' }, [el('h3', { style: 'margin:0', text: title }), el('span', { class: 'fig-caption', style: 'margin:0', text: sub }), plausibleGauge(model)]),
    el('div', { class: 'sub', text: 'Next-word suggestions' }),
    suggestionBar(model, ids, which),
    el('div', { class: 'sub', text: 'Let it write' }),
    player({
      id: `gen-${which}`, track: false,
      key: JSON.stringify([ids, pg.steps, pg.temperature, rerolls, model.updatedAt, model.trainingHistory.length, which === 'yours' ? checkpoint : null]),
      scene: generateScene(model, ids, pg, generate(model, ids, { steps: pg.steps, temperature: pg.temperature, seed: rerolls }), expectedContinuation(model, ids)),
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
  const words = tokenizeLike(pg.prompt).slice(0, MAX_PROMPT_TOKENS);
  const promptTooLong = tokenizeLike(pg.prompt).length > MAX_PROMPT_TOKENS;
  const trained = new Set(s.tokenIds);
  const unknown = [...new Set(words.filter((w) => !trained.has(s.vocab.indexOf(w))))];
  const ids = promptIds(s, words);
  const steps = s.trainingHistory.length;
  const lossNow = lossOf(s);
  const lossFresh = lossOf(fresh);

  const intro = lesson('The keyboard on your phone', [
    prose(`<p>When you type a message and three suggested words appear above the keyboard, a language model made those bets: your words were turned into tokens, a model scored every word in its dictionary as the next one, and the top three came out. Keyboard models are small and vary in design, but that job — <em>score the next token</em> — is exactly the one in this book, and chatbots do it in a loop: pick a token, add it to the text, run again.</p>
      <p>Below, the exact model you have been reading about does both jobs. To make the difference visible, it runs twice: once with <strong>freshly rolled weights</strong> (the same random start you had before touching anything), and once with <strong>your current weights</strong>, ${steps ? `after ${steps} training step${steps > 1 ? 's' : ''}` : 'which you have not trained yet'}.</p>
      <p>Once trained, the weights stop moving: using the model — <strong>inference</strong> — is Chapters 1 to 5 with the numbers frozen. Typing at a chatbot teaches it nothing; its weights were set long before you arrived.</p>`),
    steps ? null : callout('try', `<p>You haven't trained the model yet, so both sides will look equally clueless. Press <strong>Train 25 steps</strong> below (or go to Chapter 5) and come back — that's the whole point of this page.</p>`),
  ]);

  if (document.activeElement !== prompt) prompt.value = pg.prompt;
  stepsInput.value = pg.steps;
  if (document.activeElement !== tempInput) tempInput.value = pg.temperature;
  const rerollBtn = el('button', { text: 'Different draw', onclick: () => { rerolls++; render(); }, disabled: pg.temperature <= 0 });
  const controls = el('div', { class: 'card' }, [
    el('label', {}, ['Your prompt (saved)', prompt]),
    el('p', { class: 'fig-caption', style: 'margin-top:.4rem' }, ['Cut into pieces: ', ...words.map((w) => el('span', { class: 'chip', style: 'font-size:.9rem; padding:.1rem .5rem; margin-right:.25rem', text: w }))]),
    promptTooLong ? el('p', { class: 'fig-caption problem', style: 'margin-top:.6rem', text: `Only the first ${MAX_PROMPT_TOKENS} pieces of the prompt are used.` }) : null,
    unknown.length ? el('p', { class: 'fig-caption', style: 'margin-top:.6rem', text: `${unknown.map((w) => `“${w}”`).join(', ')} never appear${unknown.length > 1 ? '' : 's'} in your training text, so their rows are still random — the model has a ticket for them but has learned nothing about them.` }) : null,
    el('div', { class: 'controls', style: 'margin-top: .9rem' }, [
      el('label', {}, ['Words to write', stepsInput]),
      el('label', {}, [`Creativity (temperature) — ${pg.temperature <= 0 ? 'always the favourite' : pg.temperature < 0.8 ? 'mostly the favourite' : pg.temperature <= 1.2 ? 'roll the dice as the model bets' : 'wild'}`, tempInput]),
      rerollBtn,
      el('button', { class: 'primary', text: trainingLabel || 'Train 25 steps', disabled: !!trainingLabel, onclick: async () => {
        trainingLabel = 'Training… 0/25'; render();
        await trainMany(25, (i) => { trainingLabel = `Training… ${i}/25`; });
        trainingLabel = null; render();
      } }),
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
      <li>Turn creativity up to 1.5 and hit “different draw” a few times. Same weights, different words — that's sampling, and it's why a chatbot with the temperature above zero rarely answers the same way twice.</li>
      <li>Change the training text on the Start page to two or three sentences that share words, train 50 steps, and see if it learns to switch between them. Then test it on a fourth sentence it never saw (the box below): <strong>low</strong> surprise on text it never saw is what <strong>generalising</strong> means, and this model, trained on a few sentences, does it badly — which is exactly why real models need trillions of pieces.</li>
    </ul>`),
  ]);

  // ---- Does it generalise? surprise on text the model was never trained on ----
  const heldOutText = pg.heldOut ?? 'the dog sat by the cat';
  const heldIds = tokenizeLike(heldOutText).map((w) => s.vocab.indexOf(w)).filter((id) => id >= 0);
  const heldLoss = heldIds.length > 1 ? crossEntropy(forwardIds(s, heldIds).probs, heldIds) : null;
  const heldFresh = heldIds.length > 1 ? crossEntropy(forwardIds(fresh, heldIds).probs, heldIds) : null;
  const heldInput = el('input', { type: 'text', value: heldOutText, 'aria-label': 'Held-out text', style: 'width:100%; font-family: var(--serif); font-size: 1.05rem',
    onchange: (e) => setPlayground({ heldOut: e.target.value }) });
  const generalise = lesson('Does it generalise?', [
    prose(`<p>So far the model has only ever been tested on the text it was trained on. That is like grading a student on the exact questions they memorised. The real test is <strong>text it has never seen</strong>: if surprise stays low there, the model has learned something general; if it shoots up, it has only memorised. Type a sentence below that is <em>not</em> your training text.</p>`),
    el('div', { class: 'card' }, [
      el('label', {}, ['A sentence the model was never trained on', heldInput]),
      el('div', { class: 'kpis', style: 'margin-top:.9rem' }, [
        el('div', {}, [el('b', { text: fmt(lossNow, 2) }), el('span', { text: 'surprise on the training text' })]),
        el('div', {}, [el('b', { text: heldLoss == null ? '–' : fmt(heldLoss, 2) }), el('span', { text: 'surprise on the unseen text' })]),
        el('div', {}, [el('b', { text: heldFresh == null ? '–' : fmt(heldFresh, 2) }), el('span', { text: 'unseen text, fresh model' })]),
        el('div', {}, [el('b', { text: fmt(Math.log(s.vocab.length), 2) }), el('span', { text: `guessing evenly among ${s.vocab.length}` })]),
      ]),
      el('p', { class: 'fig-caption', text: heldLoss == null ? 'Type a few words.'
        : lossNow > Math.log(s.vocab.length) - 0.5 ? 'The model has not learned its own text yet either — train it in Chapter 5, then come back.'
        : heldLoss > lossNow + 1
          ? `Much more surprised by the unseen text than by its own: the model has memorised ${s.sentence.split(/\s+/).length} words, not learned English. That gap is called overfitting, and it is what you get from training a few thousand weights on one sentence.`
          : `Similar surprise on seen and unseen text — it is generalising a little. Pieces it never saw in training still have random rows, so it can only do well on pieces it knows.` }),
    ]),
    callout('key', `<p>Real models are trained on trillions of pieces and judged only on held-out text. The gap you see here is why: with little data, the cheapest way to lower surprise is to memorise; with a vast, varied corpus, the cheapest way is to learn the actual regularities of language — grammar, facts, style. More data, more weights and more blocks all serve that one goal.</p>`),
  ]);

  const params = ['embedding', 'positional', 'Wq', 'Wk', 'Wv', 'W1', 'W2', 'Wout'].reduce((acc, k) => acc + s.weights[k].flat().length, 0) + s.weights.b1.length + s.weights.b2.length;
  const scale = lesson('Same recipe, a billion times bigger', [
    prose(`<p>What separates this toy from a chatbot is scale, not kind. Every ingredient you saw is there in production models — just more of it, stacked deeper, trained on trillions of words instead of one sentence.</p>`),
    el('div', { class: 'card flush' }, el('div', { class: 'scroll' }, el('table', { class: 'pred scale' }, [
      el('thead', {}, el('tr', {}, ['', 'This book', 'A large model (order of magnitude)'].map((t) => el('th', { text: t })))),
      el('tbody', {}, [
        ['Dictionary', `${s.vocab.length} pieces`, '~100,000 pieces'],
        ['Numbers per piece (d)', `${s.config.dim}`, '~10,000'],
        ['Attention heads', '1', '~100 per layer'],
        ['Blocks stacked', '1', '~100'],
        ['Weights to learn', `${params.toLocaleString()}`, '~100,000,000,000+'],
        ['Training text', `${d.tokens.length} tokens`, '~10,000,000,000,000 tokens'],
        ['How gradients are found', 'backpropagation', 'backpropagation'],
        ['Tokenizer', `byte-level BPE, 300 merges`, 'byte-level BPE, ~50,000–250,000 merges'],
      ].map((r) => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'word' : '', text: c }))))),
    ]))),
    callout('key', `<p>Tokens → embeddings → attention → feed-forward → next-word bet, repeated. If you followed the numbers in this book, you understand the machine. The rest is engineering and scale.</p>`),
  ]);

  content.replaceChildren(intro, demo, generalise, scale, recap([
    'A keyboard suggestion is one forward pass and a top-3; a chatbot is the same pass in a loop, one piece at a time.',
    'Once trained, the weights are frozen: using the model teaches it nothing. <strong>Temperature</strong> adds randomness to the pick.',
    'Trained on one sentence, this model memorises; trained on trillions of pieces, the same recipe learns grammar, facts and style — because that is the cheapest way to be less surprised.',
  ]), checkYourself('playground.html'), chapterNav('playground.html'));
  if (active === prompt || active === tempInput || active === stepsInput) {
    active.focus({ preventScroll: true });
    if (sel) prompt.setSelectionRange(sel[0], sel[1]);
  } else if (active && active.getAttribute('aria-label') === 'Training step') {
    const next = document.querySelector('input[aria-label="Training step"]');
    if (next) next.focus({ preventScroll: true });
  }
}

bindRender(render);
