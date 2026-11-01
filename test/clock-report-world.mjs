// ABOUTME: Gives clock-trigger tests a controllable clock and a loop world with a report job.

import config from '../rigger.config.mjs';
import { world } from './loop-world.mjs';

export const START = Date.parse('2026-10-29T12:00:00.000Z');

export function manualClock(start = START) {
  let now = start;
  let nextId = 0;
  const pending = new Map();
  return {
    now: () => now,
    schedule: (call, delay) => {
      const id = ++nextId;
      pending.set(id, { at: now + delay, call });
      return { id, unref() {} };
    },
    cancel: ({ id }) => pending.delete(id),
    pending: () => pending.size,
    advance: async (at) => {
      now = at;
      for (let turn = 0; turn < 100; turn += 1) {
        const due = [...pending].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) return;
        pending.delete(due[0]);
        await due[1].call();
      }
      throw new Error('clock scheduled more than 100 immediate wakes');
    },
  };
}

export function reportWorld(clock, { triggers = { hourly: {
  interval: 1000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report',
} }, ...options } = {}) {
  const hadClock = Object.hasOwn(config, 'clock');
  const former = config.clock;
  config.clock = { poll: 1000, triggers };
  try { return world({ cards: [1], concurrency: 1, clock, ...options }); }
  finally {
    if (hadClock) config.clock = former;
    else delete config.clock;
  }
}
