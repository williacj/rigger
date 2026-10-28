// ABOUTME: Tests the shared repository write-access list and its workflow consumers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

import * as marker from '../src/workflow/marker.mjs';
import { makerNote } from '../src/workflow/escalation.mjs';
import { reviewAnswer } from '../src/workflow/judges.mjs';
import { statusNotice } from '../src/workflow/status-issue.mjs';
import { forge } from './notice-forge.mjs';

// Independent expectations from #1036, never derived from WRITERS.
const PERMISSIONS = [['admin', true], ['maintain', true], ['write', true], ['triage', false], ['read', false]];
const HEAD = 'a'.repeat(40);
const BODY = '## Acceptance\n\n- The verb prints its help.\n';
const ROUND = { card: 7, pull: 70, head: HEAD, digest: marker.acceptanceDigest(BODY), count: 1 };
const quiet = { emitter: () => ({ emit() {} }) };

/** A forge comment with the fields the workflow reads, as its read-side contract specifies. */
const comment = (body, permission = 'write') => ({ body, permission, author: 'writer', edited: false, id: 'IC_1', createdAt: '2026-10-28T10:00:00Z' });

/** A valid marker, so a permission refusal is the only reason it would not count. */
const verdict = (changes = {}) => marker.composeMarker({
  ...ROUND, role: 'reviewer', provider: 'codex', verdict: 'sound', items: ['met'], coverage: 'covered', ...changes,
}, 'The reviewer ruled.');

// The card requires this public list; a private or incomplete list must fail here.
test('marker exports exactly the permissions that count as repository write access', () => {
  assert.deepEqual(marker.WRITERS, ['admin', 'maintain', 'write']);
});

// The card fixes the list's home: retaining a local copy must fail this import contract.
test('every workflow module with a permission list imports WRITERS from marker', () => {
  for (const file of ['escalation', 'judges', 'status-issue']) {
    const source = readFileSync(new URL(`../src/workflow/${file}.mjs`, import.meta.url), 'utf8');
    const { body } = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    assert.ok(body.some((node) => node.type === 'ImportDeclaration' && node.source.value === './marker.mjs'
      && node.specifiers.some((specifier) => specifier.type === 'ImportSpecifier' && specifier.imported.name === 'WRITERS')), file);
  }
});

// Dropping any writer permission or admitting a reader must change the governing markers.
test('marker reading counts each writer permission and neither reader permission', () => {
  for (const [permission, writer] of PERMISSIONS) {
    const { governing, markers } = marker.readMarkers([comment(verdict(), permission)], ROUND);
    assert.deepEqual([...governing.keys()], writer ? ['reviewer'] : [], permission);
    assert.equal(markers.length, writer ? 1 : 0, permission);
  }
});

// The same defect must change which maker note the workflow accepts.
test('maker notes count each writer permission and neither reader permission', () => {
  const note = { category: 'ambiguous', item: 1, reason: 'A decision is needed.', dispatch: 'd-11111111-2222-3333-4444-555555555555' };
  const body = ['```rigger-escalation', 'category: ambiguous', 'item: 1', `reason: ${note.reason}`, `dispatch: ${note.dispatch}`, '```'].join('\n');
  for (const [permission, writer] of PERMISSIONS) {
    assert.deepEqual(makerNote([comment(body, permission)], note.dispatch, 1), writer ? note : null, permission);
  }
});

// An earlier return suppresses a duplicate only when its author has write access.
test('earlier acceptance returns count each writer permission and neither reader permission', () => {
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  const roles = { reviewer: { provider: 'codex' } };
  // Keep the return check reachable when a mutant drops any one writer permission for markers.
  const insufficient = PERMISSIONS.filter(([, writer]) => writer).map(([permission], at) => ({
    ...comment(verdict({ coverage: 'insufficient', coverageReason: 'The error case is missing.' }), permission), id: `IC_${at + 1}`,
  }));
  const answer = (comments) => reviewAnswer({
    number: 7, body: BODY, labels: ['type:change'],
    forge: { stage: 'review', open: [{ number: 70, head: HEAD }], comments: { status: 'fulfilled', value: comments } },
  }, kinds, undefined, { roles, sink: quiet });
  const first = answer(insufficient);
  assert.equal(first.action, 'return', 'the marker must first produce a return');
  for (const [permission, writer] of PERMISSIONS) {
    assert.equal(answer([...insufficient, { ...comment(first.comment, permission), id: 'IC_4' }]).action, writer ? 'ignore' : 'return', permission);
  }
});

// Recovery must reuse a writer's marked issue and pass over a reader's copy of the mark.
test('status notice recovery counts each writer permission and neither reader permission', async () => {
  for (const [permission, writer] of PERMISSIONS) {
    const world = forge({ issues: [{ number: 101, title: 'A notice', body: 'Hold: `a1`', author: 'writer', labels: [] }], permissions: { writer: permission } });
    const notice = statusNotice({ ...world, columns: { owner: 'Owner' }, sink: quiet });
    const steps = notice({ closer: { id: 'a1', after: 100, reason: 'A hold', run: 'r-test' } });
    try {
      assert.deepEqual(await steps.next(), { done: false, value: { rename: writer ? 'issue' : 'after', number: 101 } }, permission);
      assert.deepEqual(world.calls.filter(([name]) => name === 'readPermission'), [['readPermission', 'writer']], permission);
      assert.deepEqual(world.issues, [{ number: 101, title: 'A notice', body: 'Hold: `a1`', author: 'writer', labels: [] }], 'selection writes no issue');
    } finally {
      await steps.return();
    }
  }
});
