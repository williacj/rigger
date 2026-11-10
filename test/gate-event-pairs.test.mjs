// ABOUTME: Checks the gate event-pair reader against finite YAML layouts and semantic faults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateEventPairs } from './gate-event-pairs.mjs';
import { parseWorkflow } from './ci-policy-fixtures.mjs';

// Literal contract from card 1361; this oracle is independent of the reader.
const EXPECTED = [
  ['pull_request_target', 'opened'],
  ['pull_request_target', 'synchronize'],
  ['pull_request_target', 'reopened'],
  ['pull_request_target', 'edited'],
  ['issue_comment', 'created'],
  ['issue_comment', 'edited'],
  ['issue_comment', 'deleted'],
  ['issues', 'edited'],
  ['issues', 'labeled'],
  ['issues', 'unlabeled'],
];
const EVENTS = {
  pull_request_target: { types: ['opened', 'synchronize', 'reopened', 'edited'] },
  issue_comment: { types: ['created', 'edited', 'deleted'] },
  issues: { types: ['edited', 'labeled', 'unlabeled'] },
};

/** Check each authored layout's parsed premise before the independent ordered-pair oracle. */
function assertLayout(workflow, message) {
  assert.deepEqual(parseWorkflow(workflow).on, EVENTS, 'layout declares the fixed events and activities');
  assert.deepEqual(gateEventPairs(workflow), EXPECTED, message);
}

/** Fault premises and expected results are supplied independently of the reader under test. */
function assertFault(workflow, premise, expected, message) {
  assert.deepEqual(parseWorkflow(workflow).on, premise, message);
  const actual = gateEventPairs(workflow);
  assert.deepEqual(actual, expected, message);
  assert.throws(() => assert.deepEqual(actual, EXPECTED), { code: 'ERR_ASSERTION' }, message);
}

test('gate event pairs preserve the fixed order for block activity lists', () => {
  const workflow = `on:
  pull_request_target:
    types:
      - opened
      - synchronize
      - reopened
      - edited
  issue_comment:
    types:
      - created
      - edited
      - deleted
  issues:
    types:
      - edited
      - labeled
      - unlabeled
`;
  assertLayout(workflow, 'block activity lists retain all ten ordered pairs');
});

test('gate event pairs read the live workflow in the fixed order', () => {
  const workflow = readFileSync(new URL('../.github/workflows/rigger-gate.yml', import.meta.url), 'utf8');
  assertLayout(workflow, 'layout retains all ten ordered pairs');
});

test('gate event pairs preserve the fixed order for mixed activity lists', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types:
      - created
      - edited
      - deleted
  issues:
    types: [edited, labeled, unlabeled]
`;
  assertLayout(workflow, 'layout retains all ten ordered pairs');
});

test('gate event pairs preserve the fixed order with wider indentation', () => {
  const workflow = `on:
    pull_request_target:
        types:
            - opened
            - synchronize
            - reopened
            - edited
    issue_comment:
        types: [created, edited, deleted]
    issues:
        types:
            - edited
            - labeled
            - unlabeled
`;
  assertLayout(workflow, 'layout retains all ten ordered pairs');
});

test('gate event pairs preserve the fixed order with comments and quoted activities', () => {
  const workflow = `# Events retain insertion order.
on:
  pull_request_target:
    # A flow list can quote each scalar.
    types: ['opened', "synchronize", reopened, 'edited']
  issue_comment:
    types:
      - "created"
      # A comment between activities changes no association.
      - 'edited'
      - deleted
  issues:
    types: ["edited", 'labeled', unlabeled]
`;
  assertLayout(workflow, 'layout retains all ten ordered pairs');
});

test('gate event pairs expose a missing required event', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issues:
    types: [edited, labeled, unlabeled]
`;
  assertFault(workflow, {
    pull_request_target: EVENTS.pull_request_target,
    issues: EVENTS.issues,
  }, EXPECTED.filter(([event]) => event !== 'issue_comment'), 'fixture omits exactly issue_comment');
});

test('gate event pairs expose a missing required activity', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types: [created, edited]
  issues:
    types: [edited, labeled, unlabeled]
`;
  assertFault(workflow, {
    ...EVENTS, issue_comment: { types: ['created', 'edited'] },
  }, EXPECTED.filter(([event, type]) => event !== 'issue_comment' || type !== 'deleted'), 'fixture omits exactly issue_comment.deleted');
});

test('gate event pairs expose an extra activity', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types: [created, edited, deleted]
  issues:
    types: [edited, labeled, unlabeled, opened]
`;
  assertFault(workflow, {
    ...EVENTS, issues: { types: ['edited', 'labeled', 'unlabeled', 'opened'] },
  }, [...EXPECTED, ['issues', 'opened']], 'fixture adds exactly issues.opened');
});

test('gate event pairs expose an activity under the wrong event', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types: [created, edited]
  issues:
    types: [edited, labeled, unlabeled, deleted]
`;
  assertFault(workflow, {
    ...EVENTS,
    issue_comment: { types: ['created', 'edited'] },
    issues: { types: ['edited', 'labeled', 'unlabeled', 'deleted'] },
  }, [
    ...EXPECTED.filter(([event, type]) => event !== 'issue_comment' || type !== 'deleted'),
    ['issues', 'deleted'],
  ], 'fixture moves deleted from issue_comment to issues');
});

test('gate event pairs reject scalar activity types', () => {
  const workflow = `on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]
  issue_comment:
    types: created
  issues:
    types: [edited, labeled, unlabeled]
`;
  assert.deepEqual(parseWorkflow(workflow).on, {
    ...EVENTS, issue_comment: { types: 'created' },
  }, 'fixture gives issue_comment.types a scalar rather than a sequence');
  assert.throws(() => gateEventPairs(workflow), {
    message: 'issue_comment.types must be a sequence',
  }, 'scalar activity fixture is rejected with its event name');
});

test('gate event pairs reject malformed mappings and unsupported reader syntax', () => {
  const fixtures = [
    { name: 'malformed event mapping', workflow: 'on:\n  issue_comment\n', badLine: '  issue_comment' },
    { name: 'unsupported flow mapping', workflow: 'on:\n  issue_comment: {types: [created]}\n', badLine: '  issue_comment: {types: [created]}' },
    { name: 'unsupported multiline flow sequence', workflow: 'on:\n  issue_comment:\n    types: [created,\n      edited]\n', badLine: '    types: [created,' },
  ];
  for (const { name, workflow, badLine } of fixtures) {
    assert.ok(workflow.split('\n').includes(badLine), name + ' contains its authored invalid form');
    assert.throws(() => gateEventPairs(workflow), /line \d+/, name + ' is rejected with a reader line diagnostic');
  }
});
