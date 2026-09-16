// js/quiz.js — "Check yourself": two or three questions per chapter with
// instant feedback. Answers are saved (state.quiz) so ticks persist.
import { el } from './ui.js';
import { getExperiment, setQuiz } from './state.js';

export const QUIZZES = {
  'tokens.html': [
    { q: 'A word the tokenizer has never seen before…', a: ['is skipped — the model cannot use it', 'is cut into smaller pieces it does know', 'gets a brand-new ticket number'], ok: 1,
      why: 'BPE falls back to smaller pieces, down to single bytes, so nothing is ever unknown.' },
    { q: 'What does ticket number 259 tell you about a piece?', a: ['Nothing except which piece it is', 'That it is similar to piece 258', 'That it is a common word'], ok: 0,
      why: 'Ticket numbers carry no meaning; meaning is added in Chapter 2 and learned.' },
    { q: 'Why is “strawberry” hard for a chatbot to spell out?', a: ['It is a rare word', 'The model receives pieces, never letters', 'Fruit names are not in the dictionary'], ok: 1,
      why: 'The model sees tickets for pieces like “stra” and “ber”; the letters inside them are not in the numbers.' },
  ],
  'embeddings.html': [
    { q: 'Two copies of the same piece in a sentence start with…', a: ['different embedding rows', 'the same embedding row plus different position patterns', 'the same row and nothing to tell them apart'], ok: 1,
      why: 'X = E[id] + P[pos]: same row from E, different row from P.' },
    { q: 'Who decides what the numbers in an embedding row mean?', a: ['The author of the book', 'Training, by moving the numbers', 'The tokenizer'], ok: 1,
      why: 'Embedding rows are weights: they start random and are learned.' },
  ],
  'attention.html': [
    { q: 'In the analogy, a token’s “badge” is its…', a: ['query', 'key', 'value'], ok: 1, why: 'Question = query, badge = key, note = value.' },
    { q: 'Each row of the attention table adds up to…', a: ['the number of tokens', '1 (100%)', 'the score of the best match'], ok: 1, why: 'Softmax turns scores into shares that sum to 1.' },
    { q: 'With “no peeking” on, position 3 may listen to…', a: ['positions 0 to 3', 'every position', 'only position 2'], ok: 0, why: 'The causal mask hides later positions; a token sees itself and everything before it.' },
  ],
  'ffn.html': [
    { q: 'Why add the attention result onto the original row instead of replacing it?', a: ['To save memory', 'So the token keeps what it already had and attention only proposes a change', 'Because the numbers would be too small otherwise'], ok: 1,
      why: 'That is the residual connection — it is what makes deep networks trainable.' },
    { q: 'ReLU does what to a number?', a: ['Keeps it if positive, sets it to 0 if negative', 'Divides it by the row’s spread', 'Makes it positive by flipping the sign'], ok: 0, why: 'ReLU is the bouncer: negatives become 0, positives pass.' },
  ],
  'output.html': [
    { q: 'The model gave the real next piece a probability of 10%. Its surprise there is about…', a: ['0.1', '2.3', '10'], ok: 1, why: '−log(0.10) ≈ 2.3. Surprise grows as the probability shrinks.' },
    { q: 'One training step changes…', a: ['the text', 'every weight, a little, in the direction that lowers surprise', 'only the output table Wout'], ok: 1, why: 'Backpropagation gives every weight its slope; each one takes a small step.' },
    { q: 'A language model is trained to…', a: ['answer questions', 'predict the next piece of text', 'translate between languages'], ok: 1, why: 'Everything else a chatbot does is a side effect of getting good at next-piece prediction.' },
  ],
  'playground.html': [
    { q: 'Typing at a chatbot for an hour…', a: ['trains it a little', 'changes none of its weights', 'adds your words to its dictionary'], ok: 1, why: 'Using a model is inference: the weights are frozen.' },
    { q: 'Temperature 0 means the model…', a: ['always picks its favourite piece', 'picks a random piece', 'refuses to answer'], ok: 0, why: 'Higher temperature adds randomness; 0 is greedy.' },
  ],
};

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
