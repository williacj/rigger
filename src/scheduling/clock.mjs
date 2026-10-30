// ABOUTME: Wakes L3 at the next configured report occurrence through an injectable clock.

import { schedule } from '../config/validate.mjs';
import { whenElapsed } from '../substrate/process.mjs';

/** Arm report triggers after this run's start, keeping only the newest due occurrence per wake. */
export function clockReports(triggers, clock = {}, fire) {
  const entries = Object.entries(triggers ?? {}).filter(([, trigger]) => trigger.job === 'report');
  if (entries.length === 0) return () => {};
  const now = clock.now ?? Date.now;
  const started = now();
  const last = new Map();
  let cancel = () => {};
  let active = true;
  const arm = () => {
    const next = Math.min(...entries.map(([, trigger]) => schedule(trigger, now()).next ?? Infinity));
    if (next !== Infinity) cancel = whenElapsed(Math.max(0, next - now()), wake, { schedule: clock.schedule, cancel: clock.cancel });
  };
  const wake = () => {
    if (!active) return;
    const current = now();
    const due = entries.flatMap(([name, trigger]) => {
      const occurrence = schedule(trigger, current).newest;
      return occurrence !== null && occurrence > (last.get(name) ?? started) ? [{ name, occurrence }] : [];
    }).sort((a, b) => a.occurrence - b.occurrence || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of due) if (fire(entry)) last.set(entry.name, entry.occurrence);
    arm();
  };
  arm();
  return () => { active = false; cancel(); };
}
