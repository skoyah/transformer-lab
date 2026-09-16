// js/quiz.js — "Check yourself": two or three questions per chapter with
// instant feedback. Answers are saved (state.quiz) so ticks persist.
import { el } from './ui.js';
import { getExperiment, setQuiz } from './state.js';
import { QUIZZES } from './quiz-data.js';
export { QUIZZES };

export function checkYourself(page) {
  const qs = QUIZZES[page];
  if (!qs) return null;
  const saved = (getExperiment().quiz || {})[page] || {};
  const box = el('section', { class: 'card quiz' }, [
    el('div', { class: 'label', text: 'Check yourself' }),
    ...qs.map((item, qi) => {
      const chosen = saved[qi];
      const feedback = el('p', { class: 'quiz-feedback', hidden: chosen == null });
      const render = (c) => {
        feedback.hidden = c == null;
        feedback.className = `quiz-feedback ${c === item.ok ? 'ok' : 'miss'}`;
        feedback.textContent = c == null ? '' : (c === item.ok ? '✓ ' : '✗ ') + item.why;
      };
      render(chosen);
      return el('div', { class: 'quiz-q' }, [
        el('p', { class: 'quiz-question', text: `${qi + 1}. ${item.q}` }),
        el('div', { class: 'quiz-answers' }, item.a.map((text, ai) => el('button', { class: `quiz-a ${chosen === ai ? (ai === item.ok ? 'ok' : 'miss') : ''} ${chosen != null && ai === item.ok ? 'reveal' : ''}`, text,
          onclick: (e) => { setQuiz(page, qi, ai); render(ai); e.target.parentElement.querySelectorAll('.quiz-a').forEach((b, k) => { b.className = `quiz-a ${k === ai ? (ai === item.ok ? 'ok' : 'miss') : ''} ${k === item.ok ? 'reveal' : ''}`; }); } }))),
        feedback,
      ]);
    }),
  ]);
  return box;
}

export function quizScore(page) {
  const qs = QUIZZES[page] || [];
  const saved = (getExperiment().quiz || {})[page] || {};
  return { right: qs.filter((q, i) => saved[i] === q.ok).length, total: qs.length };
}
