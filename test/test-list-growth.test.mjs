// ABOUTME: Proves transitional test-list growth and event comparison rules with explicit supplied facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listGrowth, checkGrowth } from '../.github/scripts/check-test-list-growth.mjs';

test('a conversion-list entry absent at the base is named as growth', () => {
  const before = { converting: ['test/known.test.mjs'], awaiting: [] };
  const after = { converting: ['test/known.test.mjs', 'test/added.test.mjs'], awaiting: [] };
  assert.deepEqual(listGrowth(before, after), ['converting grew: test/added.test.mjs']);
});

test('an awaiting-split entry absent at the base is named as growth', () => {
  const before = { converting: [], awaiting: ['test/known.test.mjs'] };
  const after = { converting: [], awaiting: ['test/known.test.mjs', 'test/added.test.mjs'] };
  assert.deepEqual(listGrowth(before, after), ['awaiting grew: test/added.test.mjs']);
});

test('unchanged and shrunk lists have no growth', () => {
  const before = { converting: ['test/a.test.mjs', 'test/b.test.mjs'], awaiting: ['test/c.test.mjs'] };
  assert.deepEqual(listGrowth(before, before), []);
  assert.deepEqual(listGrowth(before, { converting: ['test/b.test.mjs'], awaiting: [] }), []);
});

// GitHub event fields below are literal examples of #823's event table.
const head = 'a'.repeat(40), before = 'b'.repeat(40), parent = 'c'.repeat(40), ancestor = 'd'.repeat(40);
const empty = { converting: [], awaiting: [] };
function comparison(eventName, ref, event, extra = {}) {
  const reads = [];
  const result = checkGrowth({ eventName, ref, sha: head, event: { repository: { default_branch: 'main' }, ...event } }, {
    present: () => true, firstParent: () => parent, mergeBase: () => ancestor,
    listsExist: () => true, readLists: (sha) => { reads.push(sha); return empty; }, ...extra,
  });
  return { result, reads };
}

test('default-branch push uses before across a multi-commit push', () => {
  const { result, reads } = comparison('push', 'refs/heads/main', { before });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [before, head]);
});

test('default-branch zero-before push uses the first parent', () => {
  const { result, reads } = comparison('push', 'refs/heads/main', { before: '0'.repeat(40) });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [parent, head]);
});

test('other-branch existing push preserves an entry already present at before', () => {
  const lists = { converting: ['test/branch-entry.test.mjs'], awaiting: [] };
  const { result, reads } = comparison('push', 'refs/heads/topic', { before }, { readLists: () => lists });
  assert.equal(result.ok, true);
  const observed = comparison('push', 'refs/heads/topic', { before });
  assert.deepEqual(observed.reads, [before, head]);
});

test('other-branch zero-before push uses the merge base with the default branch', () => {
  const { result, reads } = comparison('push', 'refs/heads/topic', { before: '0'.repeat(40) }, {
    mergeBase: (sha, ref) => { assert.equal(sha, head); assert.equal(ref, 'refs/remotes/origin/main'); return ancestor; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [ancestor, head]);
});

test('pull request compares the synthetic checked-out SHA with the payload base SHA', () => {
  const { result, reads } = comparison('pull_request', 'refs/pull/7/merge', { pull_request: { base: { sha: before } } });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [before, head]);
});

test('merge group compares github SHA with the payload group base', () => {
  const { result, reads } = comparison('merge_group', 'refs/heads/gh-readonly-queue/main/batch', { merge_group: { base_sha: before } });
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [before, head]);
});

test('main schedule compares the checked-out SHA with its first parent', () => {
  const { result, reads } = comparison('schedule', 'refs/heads/main', {});
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [parent, head]);
});

test('main workflow dispatch compares the checked-out SHA with its first parent', () => {
  const { result, reads } = comparison('workflow_dispatch', 'refs/heads/main', {});
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [parent, head]);
});

test('unsupported events and refs fail naming both event and ref', () => {
  for (const [event, ref] of [['release', 'refs/tags/v1'], ['push', 'refs/tags/v1'], ['schedule', 'refs/heads/topic'], ['workflow_dispatch', 'refs/heads/topic']]) {
    const { result, reads } = comparison(event, ref, {});
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes(event));
    assert.ok(result.errors[0].includes(ref));
    assert.deepEqual(reads, []);
  }
});

test('an unavailable declared base fails naming that base before any list read', () => {
  const { result, reads } = comparison('push', 'refs/heads/main', { before }, { present: (sha) => sha !== before });
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes(before));
  assert.deepEqual(reads, []);
});

test('root commits fail where default push or main regression requires a first parent', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    const { result } = comparison(event, 'refs/heads/main', { before: '0'.repeat(40) }, { firstParent: () => null });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /root.*first parent/);
  }
});

test('new other-branch push with no common ancestor fails explicitly', () => {
  const { result, reads } = comparison('push', 'refs/heads/topic', { before: '0'.repeat(40) }, { mergeBase: () => null });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no common ancestor/);
  assert.deepEqual(reads, []);
});

test('a base preceding the list introduction passes with a notice naming the base', () => {
  const { result } = comparison('push', 'refs/heads/main', { before }, {
    listsExist: (sha) => { assert.equal(sha, before); return false; },
    readLists: (sha) => { assert.equal(sha, head); return empty; },
  });
  assert.equal(result.ok, true);
  assert.ok(result.notice.includes(before));
});

test('a readable-history base with unreadable lists fails naming base and reason', () => {
  let result;
  assert.doesNotThrow(() => { result = comparison('push', 'refs/heads/main', { before }, {
    readLists: (sha) => { if (sha === before) throw new Error('controlled base read refusal'); return empty; },
  }).result; });
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes(before));
  assert.match(result.errors[0], /base.*controlled base read refusal/);
});

test('unreadable head lists fail with the head and reason even when the base predates lists', () => {
  for (const listsExist of [true, false]) {
    const { result } = comparison('push', 'refs/heads/main', { before }, {
      listsExist: () => listsExist,
      readLists: (sha) => { if (sha === head) throw new Error('controlled head read refusal'); return empty; },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes(head));
    assert.match(result.errors[0], /head.*controlled head read refusal/);
  }
});

test('event comparison propagates conversion and awaiting list growth as failure', () => {
  for (const [lists, expected] of [
    [{ converting: ['test/convert-added.test.mjs'], awaiting: [] }, 'converting grew: test/convert-added.test.mjs'],
    [{ converting: [], awaiting: ['test/await-added.test.mjs'] }, 'awaiting grew: test/await-added.test.mjs'],
  ]) {
    const { result } = comparison('push', 'refs/heads/main', { before }, { readLists: (sha) => sha === head ? lists : empty });
    assert.deepEqual(result, { ok: false, errors: [expected] });
  }
});

test('missing or malformed payload commit values fail before any list is read', () => {
  for (const event of [{}, { before: 'not-a-commit' }]) {
    const { result, reads } = comparison('push', 'refs/heads/main', event);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /base.*unavailable|base.*invalid/);
    assert.deepEqual(reads, []);
  }
});

test('fast and nightly run the unconditional list-growth command before npm test', () => {
  const source = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of ['fast', 'nightly']) {
    const job = source.split('\n  ' + name + ':\n')[1].split(/\n  [a-z_]+:\n/)[0];
    const steps = job.split('      - ').slice(1);
    const index = steps.findIndex((step) => step.startsWith('run: node .github/scripts/check-test-list-growth.mjs\n'));
    assert.ok(index !== -1, name + ' must run the list-growth script');
    assert.equal(steps[index], 'run: node .github/scripts/check-test-list-growth.mjs\n');
    assert.ok(index < steps.findIndex((step) => step.startsWith('run: npm test\n')), name + ' order');
  }
});

test('an invalid head is refused before history or lists are read', () => {
  for (const sha of [undefined, '--help', 'not-a-commit']) {
    const result = checkGrowth({ eventName: 'push', ref: 'refs/heads/main', sha, event: { before } }, {
      present: () => true, listsExist: () => true, readLists: () => empty,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /head.*invalid|head.*unavailable/);
  }
});
