import { STAGES, shapeOf, topK, generate, crossEntropy } from '../transformer.js';
import {
  getExperiment, getDerived, setSentence, sentenceProblem, setModelConfig, setCausal, setLearningRate,
  setAnimation, resetExperiment, saveSnapshot, loadSnapshot, deleteSnapshot, exportSnapshot,
  importSnapshot, DIM_OPTIONS, HIDDEN_OPTIONS, MAX_TOKENS,
} from '../state.js';
import { initPage, bindRender, el, fmt, pct, esc, lesson, prose, callout, flowDiagram, CHAPTERS, labOnly } from '../ui.js';
import { onChange, shareUrl, decodeShared, loadShared, asNumpy } from '../state.js';

const arrivedFrom = getExperiment().currentStep;
initPage('index.html');
const content = document.getElementById('content');

const STAGE_WHAT = {
  tokens: 'cut the text into pieces (BPE)', tokenIds: 'look each piece up in the dictionary',
  embeddings: 'swap each ID for its coordinates', positionalInput: 'stamp on where the piece sits',
  Q: 'what each piece is asking', K: 'what each piece is offering', V: 'what each piece would say',
  KT: 'flip K so questions can meet offers', scores: 'how well every question matches every offer',
  scaledScores: 'tame the numbers, hide the future', attentionWeights: 'turn matches into shares of attention',
  attentionOutput: 'each piece collects what it listened to', residual1: 'keep the original, add what was heard',
  norm1: 'normalise the volume', ffnHidden: 'a moment of private thought', ffnOutput: 'back to the usual size',
  residual2: 'keep the original, add the thought', norm2: 'normalise again',
  logits: 'score every piece in the dictionary', probs: 'turn scores into a bet', prediction: 'pick the favourite',
};

function heroPanel() {
  const s = getExperiment();
  const d = getDerived();
  const last = s.tokenIds.length - 1;
  const steps = s.trainingHistory.length;
  const sentence = el('textarea', { text: s.sentence, 'aria-label': 'Training text' });
  const problem = el('p', { class: 'fig-caption problem', hidden: !s.notice, text: s.notice || '' });
  const apply = () => {
    const why = sentenceProblem(sentence.value);
    problem.textContent = why || '';
    problem.hidden = !why;
    if (!why && !setSentence(sentence.value)) sentence.value = getExperiment().sentence;
  };
  sentence.addEventListener('input', () => { const why = sentenceProblem(sentence.value); problem.textContent = why || ''; problem.hidden = !why; });
  sentence.addEventListener('change', apply);
  sentence.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } });

  // Live keyboard demo: the model's top three bets after the last token, and a few words written greedily.
  const row = d.probs[last];
  const top = topK(row, 3);
  const written = generate(s, s.tokenIds, { steps: 4, temperature: 0 });
  const loss = crossEntropy(d.probs, d.tokenIds);
  const V = s.vocab.length;
  const eff = Math.min(V, Math.exp(loss));

  return el('div', { class: 'stack' }, [
    el('div', { class: 'hero' }, [
      el('div', { class: 'card' }, [
        el('h3', { style: 'margin-top:0', text: 'Your text' }),
        prose(`<p>Everything in this book is computed from this text. A sentence is easiest to follow; up to ${MAX_TOKENS} tokens work. Press Enter to apply.</p>`),
        sentence,
        problem,
        el('p', { class: 'fig-caption', text: `${d.tokens.length} tokens · ${s.config.dim} numbers per token · ${steps ? `trained ${steps} step${steps === 1 ? '' : 's'}` : 'not trained yet'}` }),
      ]),
      el('div', { class: 'card demo' }, [
        el('h3', { style: 'margin-top:0', text: 'What the model does' }),
        el('p', { class: 'fig-caption', style: 'margin:0 0 .5rem', text: `After “${d.tokens[last]}”, its three best bets for the next piece:` }),
        el('div', { class: 'keyboard' }, top.map((t, i) => el('span', { class: `key ${i === 0 ? 'best' : ''}` }, [s.vocab[t.id], el('small', { text: pct(t.p) })]))),
        el('p', { class: 'fig-caption', style: 'margin:.7rem 0 .3rem', text: 'Left to write on its own, it continues:' }),
        el('div', { class: 'chips' }, [
          ...s.tokenIds.slice(Math.max(0, last - 3), last + 1).map((id) => el('span', { class: 'chip prompt', text: s.vocab[id] })),
          ...written.map((g) => el('span', { class: 'chip gen', style: `--conf:${g.prob.toFixed(2)}` }, [g.token, el('small', { text: pct(g.prob) })])),
        ]),
        el('p', { class: 'fig-caption', style: 'margin:.7rem 0 0', text: steps
          ? `That is the whole game: bet on the next piece. Its surprise on your text is ${fmt(loss, 2)} — it is hesitating between about ${eff < 10 ? eff.toFixed(1) : Math.round(eff)} of the ${V} pieces it knows.`
          : `That is the whole game: bet on the next piece. Untrained, it is guessing — hesitating between about ${Math.round(eff)} of the ${V} pieces it knows. By Chapter 5 you will have trained it; by Chapter 6 it runs as a phone-keyboard autocomplete.` }),
      ]),
    ]),
    prose(`<p>A phone keyboard does this when it suggests your next word; a chatbot does it in a loop, one piece at a time. The machine behind it is a <strong>transformer</strong>, and this book walks through a real, tiny one: every number is on screen, and you press play to watch each step happen.</p>
      <p>The model has only one kind of memory: its <strong>weights</strong> — a few thousand numbers, in a handful of tables, that training is allowed to change. Everything else you will see is worked out from them and from your text. A chatbot's weights number in the billions; the tables are just bigger.</p>`),
    el('div', { class: 'start-row' }, [
      el('button', { class: 'primary big', text: s.currentStep && s.currentStep !== 'index.html' ? 'Continue reading →' : 'Start Chapter 1 →', onclick: () => { location.href = s.currentStep && s.currentStep !== 'index.html' ? s.currentStep : 'tokens.html'; } }),
      el('span', { class: 'fig-caption', style: 'margin:0', text: 'Six short chapters, about an hour. Nothing is computed until you press play.' }),
    ]),
  ]);
}

function howToRead() {
  return lesson('How to read this book', [
    prose(`
      <p>The chapters follow the text through the model in the order the model works: words → numbers → meaning → attention → thinking → prediction → and finally the autocomplete built from it all.</p>
      <p>Every stage is a small <strong>player</strong>. Nothing is computed in front of you until you press play; then it happens one cell or one row at a time, with a line explaining that step. If you change an input, the stages after it simply wait to be played again. Two kinds of numbers appear throughout: <span class="tag stored">saved input</span> — the text and the weights, the only things stored — and <span class="tag derived">recomputed</span> — everything else, worked out from them.</p>
      <p><strong>Lesson</strong> mode (the switch at the top right) keeps every table read-only and hides the extras; <strong>Lab</strong> mode lets you edit any weight, compare with the untrained model, export the model, and more.</p>`),
  ]);
}

let lastDone = new Set(Object.keys(getExperiment().progress || {}));

function machinePanel() {
  const s = getExperiment();
  const nowDone = new Set(Object.keys(s.progress || {}));
  const justDone = new Set([...nowDone].filter((id) => !lastDone.has(id)));
  lastDone = nowDone;
  return lesson('The machine', [
    prose(`<p>Every stage of the model, wired the way the maths is wired: straight links feed the next stage, dotted arcs are the longer connections (the residual paths that carry the original input forward, the transposed K, the values V). Orange labels are the saved inputs each stage reads. Filled dots have been played; play a stage in any tab and its dot fills in here.</p>`),
    el('div', { class: 'card flush flow-wrap' }, flowDiagram({ progress: s.progress, justDone, chapters: CHAPTERS })),
  ], { id: 'machine' });
}

function tocPanel() {
  const s = getExperiment();
  const d = getDerived();
  const items = [];
  let currentPage = null;
  for (const stage of STAGES) {
    if (stage.page !== currentPage) {
      currentPage = stage.page;
      const ch = CHAPTERS.find((c) => c.href === currentPage);
      items.push(el('li', { class: 'chapter' }, [
        el('span', { class: 'idx', text: `Ch ${ch.n}` }),
        el('a', { href: ch.href, text: ch.title }),
        el('span'),
      ]));
    }
    const value = d[stage.id];
    const played = s.progress[stage.id] === 'done';
    items.push(el('li', { dataset: { stage: stage.id }, class: played ? 'played' : '' }, [
      el('span', { class: 'idx', text: played ? '✓' : '↓' }),
      el('span', {}, [el('a', { href: `${stage.page}#${stage.id}`, text: stage.label }), el('span', { class: 'what', text: STAGE_WHAT[stage.id] || '' })]),
      el('span', { class: 'shape', text: stage.id === 'prediction' ? `${value.length}` : shapeOf(value) }),
    ]));
  }
  const ch6 = CHAPTERS[6];
  items.push(el('li', { class: 'chapter' }, [el('span', { class: 'idx', text: 'Ch 6' }), el('a', { href: ch6.href, text: ch6.title }), el('span')]));
  return lesson('The journey at a glance', [
    prose(`<p>Every stage the text goes through, in order. The numbers on the right are the shape of each result for your text (rows × columns). A tick means you have played that stage since its inputs last changed.</p>`),
    el('div', { class: 'card flush' }, el('ol', { class: 'toc' }, items)),
  ]);
}

function settingsPanel() {
  const s = getExperiment();
  const seed = el('input', { type: 'number', value: s.seed, step: 1 });
  const dim = el('select', {}, DIM_OPTIONS.map((d) => el('option', { value: d, text: d, selected: d === s.config.dim })));
  const hidden = el('select', {}, HIDDEN_OPTIONS.map((h) => el('option', { value: h, text: h, selected: h === s.config.hidden })));
  const lr = el('input', { type: 'number', value: s.learningRate, step: 0.01, min: 0.001 });
  const causal = el('input', { type: 'checkbox', checked: s.config.causal });
  const speed = el('select', {}, ['slow', 'normal', 'fast'].map((k) => el('option', { value: k, text: k, selected: k === s.animation.speed })));

  const applyModel = () => {
    const next = { seed: Number(seed.value), dim: Number(dim.value), hidden: Number(hidden.value) };
    const cur = getExperiment();
    if (next.seed === cur.seed && next.dim === cur.config.dim && next.hidden === cur.config.hidden) return;
    if (!confirm('Changing the seed or sizes re-rolls every weight table (your edits and training are lost; bookmarks are kept). Continue?')) {
      seed.value = cur.seed; dim.value = cur.config.dim; hidden.value = cur.config.hidden; return;
    }
    setModelConfig(next);
  };
  seed.addEventListener('change', applyModel);
  dim.addEventListener('change', applyModel);
  hidden.addEventListener('change', applyModel);
  lr.addEventListener('change', () => setLearningRate(lr.value));
  causal.addEventListener('change', () => setCausal(causal.checked));
  speed.addEventListener('change', () => setAnimation({ speed: speed.value }));

  return lesson('Settings', [
    prose(`<p>Sensible defaults are set. Come back here if you want a bigger model, a different random start, or a calmer panel.</p>`),
    el('div', { class: 'card' }, [
      el('div', { class: 'controls' }, [
        el('label', {}, ['Random seed', seed]),
        el('label', {}, ['Numbers per piece (d)', dim]),
        el('label', {}, ['Hidden size', hidden]),
        el('label', {}, ['Learning rate', lr]),
        el('label', { class: 'inline' }, [causal, 'No peeking at later words']),
      ]),
      el('div', { class: 'controls', style: 'margin-top: 1rem' }, [
        el('label', {}, ['Playback speed', speed]),
        el('button', { class: 'danger', text: 'Reset everything', onclick: () => confirm('Reset the text, settings and all weights to defaults? Bookmarks are kept.') && resetExperiment() }),
      ]),
    ]),
  ]);
}

function snapshotsPanel() {
  const s = getExperiment();
  const name = el('input', { type: 'text', placeholder: 'e.g. before training' });
  const file = el('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { importSnapshot(await f.text()); } catch (err) { alert(err.message); }
    e.target.value = '';
  } });
  const download = (id, label) => {
    const blob = new Blob([exportSnapshot(id)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${label.replace(/\W+/g, '-')}.json` });
    document.body.append(a); a.click(); a.remove();
  };
  return lesson('Bookmarks', [
    prose(`<p>A bookmark saves the model as it is right now — text, dictionary, seed, settings and every weight — so you can experiment freely and come back. It stores only the inputs; all the derived numbers are recomputed when you load it. A <strong>share link</strong> packs the same thing into a URL you can send to someone; <strong>Copy as NumPy</strong> gives you the weights and a forward pass as Python to check every number by hand.</p>`),
    el('div', { class: 'card' }, [
      el('div', { class: 'controls' }, [
        el('label', {}, ['Name', name]),
        el('button', { class: 'primary', text: 'Bookmark this state', onclick: () => { saveSnapshot(name.value); name.value = ''; } }),
        el('button', { text: 'Export as file', onclick: () => download(null, 'transformer-lab-experiment') }),
      el('button', { text: 'Copy share link', title: 'A link that carries this exact model (compressed into the URL)', onclick: async (e) => {
        const url = await shareUrl();
        try { await navigator.clipboard.writeText(url); e.target.textContent = 'Link copied ✓'; } catch { prompt('Copy this link:', url); }
        setTimeout(() => { e.target.textContent = 'Copy share link'; }, 1800);
      } }),
      el('button', { text: 'Copy as NumPy', title: 'The weights and a forward pass as Python, to check the numbers yourself', onclick: async (e) => {
        try { await navigator.clipboard.writeText(asNumpy()); e.target.textContent = 'Copied ✓'; } catch { prompt('Copy:', asNumpy()); }
        setTimeout(() => { e.target.textContent = 'Copy as NumPy'; }, 1800);
      } }),
        el('button', { text: 'Import file…', onclick: () => file.click() }),
        file,
      ]),
      s.snapshots.length === 0 ? el('p', { class: 'note', style: 'margin-top:.8rem', text: 'No bookmarks yet.' }) : el('ul', { class: 'snapshots' }, s.snapshots.map((snap) => {
        const e = snap.experiment;
        return el('li', {}, [
          el('strong', { text: snap.name }),
          el('span', { class: 'meta', text: `“${e.sentence}” · d=${e.config.dim} · seed ${e.seed} · ${e.trainingHistory?.length || 0} training steps · ${new Date(snap.createdAt).toLocaleString()}` }),
          el('span', { class: 'spacer' }),
          el('button', { text: 'Load', onclick: () => loadSnapshot(snap.id) }),
          el('button', { text: 'Export', onclick: () => download(snap.id, snap.name) }),
          el('button', { class: 'danger', text: 'Delete', onclick: () => { if (confirm(`Delete “${snap.name}”?`)) deleteSnapshot(snap.id); } }),
        ]);
      })),
    ]),
  ]);
}

function render() {
  const map = el('details', { class: 'map' }, [
    el('summary', { text: 'The map: every stage of the machine, and where you are' }),
    machinePanel(), tocPanel(),
  ]);
  content.replaceChildren(heroPanel(), howToRead(), map, labOnly(settingsPanel()), labOnly(snapshotsPanel()));
}

// Progress changes (this tab or another) only need the diagram and list refreshed.
onChange((event) => {
  if (event.quiet && event.changedKeys.includes('progress')) render();
});

bindRender(render, { quietKeys: ['snapshots'] });

// Arriving with #s=… : offer to load the shared experiment.
decodeShared(location.hash).then((parsed) => {
  if (!parsed) return;
  const e = parsed.experiment;
  if (confirm(`Load the shared experiment?\n\n“${e.sentence}” · d=${e.config?.dim} · ${e.trainingHistory?.length || 0} training steps\n\nYour current model is kept in the undo history (⌘Z).`)) loadShared(parsed);
  history.replaceState(null, '', location.pathname);
});
