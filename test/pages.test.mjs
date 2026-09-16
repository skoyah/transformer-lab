// Rendering smoke test: every page builds its DOM without throwing, in Lesson
// and Lab mode, with the expected furniture present. Runs the real page
// modules against a jsdom document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PAGES = ['index', 'tokens', 'embeddings', 'attention', 'ffn', 'output', 'playground'];
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'NodeFilter', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'Event', 'CSS', 'getComputedStyle', 'requestAnimationFrame', 'location', 'history']) {
  if (w[k] !== undefined) { try { globalThis[k] = w[k]; } catch { Object.defineProperty(globalThis, k, { value: w[k], configurable: true }); } }
}
globalThis.PointerEvent = globalThis.PointerEvent || w.MouseEvent;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
if (!globalThis.CSS || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`) };
w.HTMLElement.prototype.scrollIntoView = () => {};
w.HTMLElement.prototype.animate = () => ({ onfinish: null, cancel() {} });

const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));

function mount(page) {
  const html = readFileSync(new URL(`../${page}.html`, import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.body.innerHTML = body.replace(/<script[^>]*><\/script>/g, '');
}

const state = await import('../js/state.js');
const player = await import('../js/player.js');

for (const page of PAGES) {
  test(`page renders: ${page}`, async () => {
    mount(page);
    errors.length = 0;
    await import(`../js/pages/${page}.js`);
    await new Promise((r) => setTimeout(r, 30));
    const content = document.getElementById('content');
    assert.ok(content.children.length > 0, 'content rendered');
    assert.deepEqual(errors, []);
    assert.ok(document.querySelector('#nav .brand'), 'nav mounted');
    assert.ok(document.querySelector('.chapter-progress .cp'), 'chapter progress mounted');
    assert.ok(document.querySelector('.chapter-goal'), 'learning goal shown');
    if (page !== 'index') {
      assert.ok(document.querySelector('.card.player'), 'at least one player');
      assert.ok(document.querySelector('.callout.recap'), 'recap present');
      assert.ok(document.querySelector('.card.quiz'), 'quiz present');
      if (page !== 'playground') assert.ok(document.querySelector('.chapter-controls'), 'chapter controls present');
    }
    assert.equal(document.querySelectorAll('table.matrix input').length, 0, 'Lesson mode: no editable cells');

    if (page === 'embeddings') {
      // Lab mode exposes editable cells (re-render in place), players step and finish.
      state.setMode('lab');
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(document.querySelectorAll('table.matrix input').length > 0, 'Lab mode: editable cells');
      const id = 'positionalInput';
      assert.ok(document.querySelector(`[data-player="${id}"]`), 'player present');
      player.setStep(id, 1);
      await new Promise((r) => setTimeout(r, 30));
      assert.match(document.querySelector(`[data-player="${id}"] .counter`).textContent, /^1 \//);
      player.setStep(id, 999);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(state.getExperiment().progress[id], 'done');
      state.setMode('lesson');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(document.querySelectorAll('table.matrix input').length, 0, 'back to read-only');
      assert.deepEqual(errors, []);
    }
  });
}


