// ABOUTME: L2's pure gate rule over verdict markers, configured judges, and required check states.

import { readMarkers } from './marker.mjs';

export const GATE_CONTEXT = 'rigger/gate';

/**
 * The gate's answer for a card round. `comments` have the forge read's shape; `card`, `pull`,
 * `head`, `digest` and acceptance-item `count` identify the round; `judges` is the kind's ordered
 * list, and `checks` is the required contexts' state map. Each refusal names a judge or check and
 * its reason. The caller determines the judges and checks before asking this pure rule.
 */
export function gateAnswer({ comments, card, pull, head, digest, count, judges, checks }) {
  const { governing, markers } = readMarkers(comments, { card, pull, head, digest, count });
  const refusals = judges.flatMap((judge) => {
    const held = governing.get(judge);
    if (held === undefined) {
      const olderDigest = markers.filter((each) => each.role === judge && each.head === head && each.digest !== digest).at(-1);
      if (olderDigest) return [{ judge, reason: `stale digest: ${olderDigest.digest}; current digest: ${digest}` }];
      const older = markers.filter((each) => each.role === judge && each.head !== head).at(-1);
      return [{ judge, reason: older ? `stale head: ${older.head}; current head: ${head}` : 'no marker' }];
    }
    if (held.edited) return [{ judge, reason: 'marker edited' }];
    if (held.state === 'unreadable') return [{ judge, reason: `unreadable: ${held.reason}` }];
    if (held.marker.verdict !== 'sound') return [{ judge, reason: `verdict ${held.marker.verdict}` }];
    if (held.marker.coverage === 'insufficient') return [{ judge, reason: `coverage insufficient: ${held.marker.coverageReason}` }];
    return held.marker.items.flatMap((item, index) => item === 'met' ? [] : [{ judge, reason: `item ${index + 1} unmet` }]);
  });
  if (judges.length === 0) refusals.push({ judge: '(none)', reason: 'no judges configured' });
  for (const [check, { state }] of Object.entries(checks)) {
    if (state !== 'passed') refusals.push({ check, reason: ['failed', 'pending', 'absent'].includes(state) ? state : `unknown check state: ${state}` });
  }
  return refusals.length === 0 ? { admit: true } : { admit: false, refusals };
}
