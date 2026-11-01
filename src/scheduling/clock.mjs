// ABOUTME: Wakes L3 through one timer on an injectable clock: at each report occurrence, and, while
// L3 polls, at each poll of the board.

import { schedule } from '../config/validate.mjs';
import { whenElapsed } from '../substrate/process.mjs';

/**
 * Arms `triggers`' report occurrences after this run's start, keeping only the newest due
 * occurrence per wake, and, from each `poll()` on, a poll `interval` milliseconds later. One timer
 * serves both, and it holds the process open. A wake awaits each callback it makes, so no two
 * firings and no two polls run at once: it fires the due occurrences first, earlier first and then
 * by name, each through `fire`, which answers whether it settled the occurrence. Then a due poll
 * calls `polled`, which answers whether to poll again, `interval` milliseconds after it settled.
 * Answers `{ poll, stop }`: `poll` starts polling, and `stop` cancels the timer for good.
 */
export function clockWakes({ triggers, poll: interval } = {}, clock = {}, { fire, polled }) {
  const entries = Object.entries(triggers ?? {}).filter(([, trigger]) => trigger.job === 'report');
  const now = clock.now ?? Date.now;
  const started = now();
  const last = new Map();
  let cancel = () => {};
  let active = true;
  let waking = false;
  let pollAt;
  const arm = () => {
    cancel();
    cancel = () => {};
    if (!active || waking) return;
    const occurrence = Math.min(...entries.map(([, trigger]) => schedule(trigger, now()).next ?? Infinity));
    const next = Math.min(occurrence, pollAt ?? Infinity);
    if (next !== Infinity) cancel = whenElapsed(Math.max(0, next - now()), wake, { schedule: clock.schedule, cancel: clock.cancel, hold: true });
  };
  const wake = async () => {
    if (!active) return;
    waking = true;
    try {
      const current = now();
      const due = entries.flatMap(([name, trigger]) => {
        const occurrence = schedule(trigger, current).newest;
        return occurrence !== null && occurrence > (last.get(name) ?? started) ? [{ name, occurrence }] : [];
      }).sort((a, b) => a.occurrence - b.occurrence || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of due) if (active && await fire(entry)) last.set(entry.name, entry.occurrence);
      if (active && pollAt !== undefined && pollAt <= now()) {
        pollAt = undefined;
        if (await polled()) pollAt = now() + interval;
      }
    } finally {
      waking = false;
      arm();
    }
  };
  arm();
  return {
    poll: () => {
      pollAt = now() + interval;
      arm();
    },
    stop: () => {
      active = false;
      cancel();
    },
  };
}
