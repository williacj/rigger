// ABOUTME: Throwaway for #1462: the arithmetic its report gives beyond the counts, from the counts'
// own published rows: what the deaths cost, and how much a count of so few events can say.

// Usage: node calc.mjs <counts>
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter((line) => /^event \d+: /.test(line));
const sum = (pattern) => rows.reduce((total, row) => total + Number(pattern.exec(row)[1]), 0);
const [least, most] = [sum(/elapsed (\d+) to/), sum(/elapsed \d+ to (\d+) ms/)];
console.log(`events: ${rows.length}`);
console.log(`elapsed dispatch time lost, all events: ${least} to ${most} ms`);
console.log(`redo dispatches' ms, all events: ${sum(/redo dispatch (\d+) ms/)}`);
console.log(`longest wait from a run's last event to a redo's pull: ${Math.max(...rows.map((row) => Number(/redo pulled (\d+) ms/.exec(row)[1])))} ms`);

/** P(X <= k) for a Poisson count of mean m. */
const atMost = (k, m) => { let term = Math.exp(-m); let total = term; for (let n = 1; n <= k; n += 1) { term *= m / n; total += term; } return total; };
const solve = (f) => { let [low, high] = [0, 1000]; for (let n = 0; n < 200; n += 1) { const mid = (low + high) / 2; if (f(mid)) low = mid; else high = mid; } return low; };
/** The exact two-sided 95% interval for the mean of a count of k. */
const interval = (k) => [k === 0 ? 0 : solve((m) => 1 - atMost(k - 1, m) < 0.025), solve((m) => atMost(k, m) > 0.025)];
for (const k of [0, 1, 2, 3, 4, 5]) { const [low, high] = interval(k); console.log(`count ${k}: 95% interval ${low.toFixed(3)} to ${high.toFixed(3)}${k === 0 ? '' : `, ratio ${(high / low).toFixed(1)}`}`); }
const none = solve((m) => atMost(0, m) > 0.05);
console.log(`count 0: one-sided 95% upper bound ${none.toFixed(3)}`);
console.log(`engine hours with no death that put 5 per 100 engine hours outside that bound: ${(none / 0.05).toFixed(1)}`);
