// js/train.worker.js — runs training steps off the main thread.
// Message in:  { id, state, learningRate, steps = 1 }   (state = persistent experiment)
// Message out: one { id, i, weights, lossBefore, lossAfter, gradNorm, done } per step
import { trainStep } from './transformer.js';

self.onmessage = (e) => {
  const { id, learningRate, steps = 1 } = e.data;
  let state = e.data.state;
  for (let i = 1; i <= steps; i++) {
    const result = trainStep(state, learningRate);
    state = { ...state, weights: result.weights };
    self.postMessage({ id, i, ...result, done: i === steps });
  }
};
