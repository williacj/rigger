// ABOUTME: L2's pure gate rule over verdict markers, configured judges, and required check states.

import { readMarkers } from './marker.mjs';

export const GATE_CONTEXT = 'rigger/gate';

/**
 * The owner's role, as the config validator's `OWNER` spells it, which a test holds equal to
 * this. The rule tells the owner from an agent judge by this name, never by whether a provider is
 * handed (`D24`; the delta's section 3), and imports nothing but the marker reader to know it.
 */
export const OWNER = 'owner';

/** A provider's form, as the marker's `provider` is read: one or more characters and no whitespace. */
const PROVIDER = /^\S+$/;

/**
 * The gate's answer for a card round. `comments` have the forge read's shape; `card`, `pull`,
 * `head`, `digest` and acceptance-item `count` identify the round; `judges` is the kind's ordered
 * panel, as L2's panel function answers it: `{ role: 'owner' }` for the owner, `{ role, provider }`
 * for an agent judge, `provider` the one the config requires of it for the card, or one `{ conflict
 * }` in place of every entry, which refuses the card with its reason and reads no marker. `checks`
 * is the required contexts' state map. Each refusal names a judge or check and its reason. For one
 * judge it is the first that applies: no fresh marker, edited, unreadable, the provider, the
 * verdict, the coverage, then each unmet item. The caller determines the judges and checks before
 * asking this pure rule.
 */
export function gateAnswer({ comments, card, pull, head, digest, count, judges, checks }) {
  const conflict = judges.find((entry) => entry.conflict !== undefined);
  const refusals = conflict === undefined ? judgeRefusals({ comments, card, pull, head, digest, count, judges }) : [{ judge: '(panel)', reason: conflict.conflict }];
  for (const [check, { state }] of Object.entries(checks)) {
    if (state !== 'passed') refusals.push({ check, reason: ['failed', 'pending', 'absent'].includes(state) ? state : `unknown check state: ${state}` });
  }
  return refusals.length === 0 ? { admit: true } : { admit: false, refusals };
}

/** The refusals of each of `judges`, a panel holding no conflict, read from `comments` at the round. */
function judgeRefusals({ comments, card, pull, head, digest, count, judges }) {
  const { governing, markers } = readMarkers(comments, { card, pull, head, digest, count });
  const refusals = judges.flatMap(({ role: judge, provider }) => {
    const owner = judge === OWNER;
    if (!owner && !(typeof provider === 'string' && PROVIDER.test(provider))) return [{ judge, reason: 'no provider is required of it, so the panel is malformed' }];
    const held = governing.get(judge);
    if (held === undefined) {
      const olderDigest = markers.filter((each) => each.role === judge && each.head === head && each.digest !== digest).at(-1);
      if (olderDigest) return [{ judge, reason: `stale digest: ${olderDigest.digest}; current digest: ${digest}` }];
      const older = markers.filter((each) => each.role === judge && each.head !== head).at(-1);
      return [{ judge, reason: older ? `stale head: ${older.head}; current head: ${head}` : 'no marker' }];
    }
    if (held.edited) return [{ judge, reason: 'marker edited' }];
    if (held.state === 'unreadable') return [{ judge, reason: `unreadable: ${held.reason}` }];
    const named = held.marker.provider;
    if (owner && named !== undefined) return [{ judge, reason: `the owner's marker names a provider: ${named}` }];
    if (!owner && named === undefined) return [{ judge, reason: `names no provider; the config requires ${provider}` }];
    if (!owner && named !== provider) return [{ judge, reason: `provider ${named}; the config requires ${provider}` }];
    if (held.marker.verdict !== 'sound') return [{ judge, reason: `verdict ${held.marker.verdict}` }];
    if (held.marker.coverage === 'insufficient') return [{ judge, reason: `coverage insufficient: ${held.marker.coverageReason}` }];
    return held.marker.items.flatMap((item, index) => item === 'met' ? [] : [{ judge, reason: `item ${index + 1} unmet` }]);
  });
  if (judges.length === 0) refusals.push({ judge: '(none)', reason: 'no judges configured' });
  return refusals;
}
