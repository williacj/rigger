// ABOUTME: Throwaway for #1462: searches the public records for sentences naming a host that went away
// or a session or engine that died, whatever their tense, and prints each with its place.

// Usage: node hosts.mjs journal <ref> | node hosts.mjs comments <file>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMED = [
  /\b(?:host|laptop|mini|machine|computer|mac) (?:has |had |was |is |just |then )*(?:slept|went to sleep|asleep|rebooted|restarted|crashed|lost power|panicked|ran out)/i,
  /\b(?:after|before|since|across|during) (?:the|a|that|this) (?:host(?:'s)? )?(?:reboot|sleep|power (?:loss|cut)|crash)\b/i,
  /kernel panic|jetsam|OOM[- ]kill|battery|power (?:loss|cut|failure)/i,
  /\b(?:maker|judge|reviewer|session|coordinator|engine|wrapper|architect|attacker|codex|claude)(?:'s)? (?:process |session |thread |turn |run )?(?:had |has |was |were |is )?(?:died|crashed|killed|lost|vanished|disappeared|interrupted|ended early|terminated|hung|stalled|cut off|cut short|stopped (?:at|by|with|when)|torn down)/i,
  /\b(?:usage|session|rate|credit) limit|at capacity|stream (?:disconnected|error)/i,
];
// A spec clause, a test title or a patch line tells of no event.
const NOISE = /R-[A-Z]+-\d|mutant|fixture|[✔✖]|not ok|\bwould\b|\bgiven (?:a|an|the)\b|"name":|`dispatch`|^[-+] {2,}/i;
const [source, at] = process.argv.slice(2);
const places = source === 'journal'
  ? execFileSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', at, 'docs/journal'], { encoding: 'utf8' }).trim().split('\n').map((path) => ({ place: path.split('/').at(-1), text: execFileSync('git', ['show', `${at}:${path}`], { encoding: 'utf8', maxBuffer: 1e9 }) }))
  : readFileSync(at, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).map(({ id, issue, created_at: when, body }) => ({ place: `${issue}#${id} ${when.slice(0, 10)}`, text: body ?? '' }));
let found = 0;
const holding = new Set();
for (const { place, text } of places) {
  for (const line of text.split('\n')) {
    if (line.length > 4000 || NOISE.test(line)) continue;
    const hit = NAMED.map((pattern) => pattern.exec(line)).find(Boolean);
    if (!hit) continue;
    found += 1;
    holding.add(place);
    process.stdout.write(`${place}: ${line.slice(Math.max(0, hit.index - 120), hit.index + 160).trim()}\n`);
  }
}
process.stdout.write(`places read: ${places.length}\nplaces holding a candidate: ${holding.size}\ncandidate lines: ${found}\n`);
