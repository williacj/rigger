// ABOUTME: Throwaway for #1462: recomputes #1429's kill-to-next-attempt times from its published evidence,
// its transcript's kill times and its event histories, at the ref given.

// Usage: node temporal.mjs <ref>
import { execFileSync } from 'node:child_process';

const base = 'docs/spikes/temporal-dispatch-under-failure';
const show = (path) => execFileSync('git', ['show', `${process.argv[2]}:${base}/${path}`], { encoding: 'utf8', maxBuffer: 1e9 });
const transcript = show('transcript.txt').split('\n');
// Each kill's own command prints its time first, on the first line after the command's that holds it.
const killed = (command) => {
  const at = transcript.findIndex((line) => line.startsWith('===') && line.includes(command));
  return transcript.slice(at + 1, at + 6).map((line) => /kill-at (\S+)/.exec(line)?.[1]).find(Boolean);
};
for (const [os, command] of [['linux', 'kill -9 1010'], ['windows', 'Stop-Process -Id 19380'], ['macos', 'kill -9 34568']]) {
  const second = JSON.parse(show(`histories/card-kill-${os}.json`)).events.find((event) => event.eventType === 'EVENT_TYPE_ACTIVITY_TASK_STARTED' && event.activityTaskStartedEventAttributes.attempt === 2);
  const at = killed(command);
  console.log(`${os}: killed ${at}, attempt 2 started ${second.eventTime}, ${((Date.parse(second.eventTime) - Date.parse(at)) / 1000).toFixed(2)} s`);
}
