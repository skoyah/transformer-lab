import { STAGES, shapeOf } from '../transformer.js';
import {
  getExperiment, getDerived, setSentence, setModelConfig, setCausal, setLearningRate,
  setAnimation, resetExperiment, saveSnapshot, loadSnapshot, deleteSnapshot, exportSnapshot,
  importSnapshot, DIM_OPTIONS, HIDDEN_OPTIONS,
} from '../state.js';
import { initPage, bindRender, el, fmt, pct, esc, lesson, prose, callout, flowDiagram, CHAPTERS } from '../ui.js';
import { onChange } from '../state.js';

const arrivedFrom = getExperiment().currentStep;
initPage('index.html');
const content = document.getElementById('content');

const STAGE_WHAT = {
  tokens: 'chop the text into words', tokenIds: 'look each word up in the dictionary',
  embeddings: 'swap each ID for its coordinates', positionalInput: 'stamp on where the word sits',
  Q: 'what each word is asking', K: 'what each word is offering', V: 'what each word would say',
  KT: 'flip K so questions can meet offers', scores: 'how well every question matches every offer',
  scaledScores: 'tame the numbers, hide the future', attentionWeights: 'turn matches into shares of attention',
  attentionOutput: 'each word collects what it listened to', residual1: 'keep the original, add what was heard',
  norm1: 'normalise the volume', ffnHidden: 'a moment of private thought', ffnOutput: 'back to the usual size',
  residual2: 'keep the original, add the thought', norm2: 'normalise again',
  logits: 'score every dictionary word', probs: 'turn scores into a bet', prediction: 'pick the favourite',
};

function heroPanel() {
  const s = getExperiment();
  const d = getDerived();
  const last = s.tokenIds.length - 1;
  const pred = d.prediction[last];
  const sentence = el('textarea', { text: s.sentence, 'aria-label': 'Training text' });
  const apply = () => { if (!setSentence(sentence.value)) sentence.value = getExperiment().sentence; };
  sentence.addEventListener('change', apply);
  sentence.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } });

  return el('div', { class: 'hero' }, [
    el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0', text: 'Your text' }),
      prose(`<p>Everything in this book is computed from this text. A sentence or two is plenty — the model is small and you'll want to read every number. Press Enter to apply.</p>`),
      sentence,
      el('p', { class: 'fig-caption', text: `${d.tokens.length} tokens · ${s.vocab.length} words in the dictionary · ${s.config.dim} numbers per word` }),
    ]),
    el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0', text: 'Right now the model thinks…' }),
      prose(`<p>…that after <strong>“${esc(d.tokens[last])}”</strong> the next word is <strong>“${esc(pred.token)}”</strong> (${pct(pred.prob)} sure).${s.trainingHistory.length ? '' : ' It has never been trained, so this is no better than a random guess — by Chapter 5 you will fix that.'}</p>`),
      el('p', { style: 'margin:0' }, [
        el('button', { class: 'primary', text: arrivedFrom && arrivedFrom !== 'index.html' ? 'Continue reading →' : 'Start with Chapter 1 →',
          onclick: () => { location.href = arrivedFrom && arrivedFrom !== 'index.html' ? arrivedFrom : 'tokens.html'; } }),
      ]),
    ]),
  ]);
}

function howToRead() {
  return lesson('How to read this book', [
    prose(`
      <p>Six short chapters follow the text through the model, in the order the model itself works: words → numbers → meaning → attention → thinking → prediction → and finally a working autocomplete built from it all.</p>
      <p>Every stage is a small player. Nothing is computed in front of you until you press <strong>play</strong>; then it happens one cell or one row at a time, with a line explaining that step. Step back, scrub, or skip to the end whenever you like. If you change an input, the stages after it simply wait to be played again.</p>
      <p>Two kinds of numbers appear throughout:</p>
      <ul>
        <li><span class="tag stored">saved input</span> — a value you can edit. There are only a handful: the text, a random seed, and the weight tables. These are the model's memory, and they are saved in your browser.</li>
        <li><span class="tag derived">recomputed</span> — everything else. These are never stored; they are recalculated from the inputs whenever something upstream changes, like formulas in a spreadsheet.</li>
      </ul>`),
    callout('idea', `<p>Think of a spreadsheet. A few cells hold typed-in values; every other cell is a formula. Change one input and the dependent cells have to be recalculated. This model is exactly that — except here you turn the crank yourself: edit a weight, and the panel in the corner lists which stages are waiting for you to press play.</p>`),
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
        el('label', {}, ['Numbers per word (d)', dim]),
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
    prose(`<p>A bookmark saves the model as it is right now — text, dictionary, seed, settings and every weight — so you can experiment freely and come back. It stores only the inputs; all the derived numbers are recomputed when you load it.</p>`),
    el('div', { class: 'card' }, [
      el('div', { class: 'controls' }, [
        el('label', {}, ['Name', name]),
        el('button', { class: 'primary', text: 'Bookmark this state', onclick: () => { saveSnapshot(name.value); name.value = ''; } }),
        el('button', { text: 'Export as file', onclick: () => download(null, 'transformer-lab-experiment') }),
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
  content.replaceChildren(heroPanel(), howToRead(), machinePanel(), tocPanel(), settingsPanel(), snapshotsPanel());
}

// Progress changes (this tab or another) only need the diagram and list refreshed.
onChange((event) => {
  if (event.quiet && event.changedKeys.includes('progress')) render();
});

bindRender(render, { quietKeys: ['snapshots'] });
