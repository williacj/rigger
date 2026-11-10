// ABOUTME: Supplies Table O's required-only config and isolated optional-key omissions.

import { START } from './clock-report-world.mjs';

/** Required declarations written independently of the validator's SHAPES. */
export const minimalConfig = () => ({
  repo: 'acme/widgets',
  board: { project: 3, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } },
  roles: {
    engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard' },
    reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'high' },
  },
  kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'owner'] } },
});

/** Both legal trigger alternatives are present; neither declares the other's work key. */
export function fullConfig() {
  const config = minimalConfig();
  return {
    ...config,
    board: { ...config.board, owner: 'acme', priority: { field: 'Priority', options: ['High', 'Normal', 'Low'] } },
    concurrency: 2,
    worktrees: { root: '../configured-worktrees', topic: 'task-{number}' },
    epicLabel: 'type:epic',
    roles: Object.fromEntries(Object.entries(config.roles).map(([name, role]) => [name, {
      ...role, labels: { 'tier:high': 'high' }, timeout: 32123,
      providerLabels: { [name === 'engineer' ? 'maker:codex' : 'judge:codex']: 'codex' },
    }])),
    kinds: { change: { ...config.kinds.change, rounds: 5, provisioning: ['probe'] } },
    provisioning: { probe: { run: 'printf provisioned', required: true, select: { labels: ['area:probe'] }, cwd: 'build', timeout: 777 } },
    escalate: { 'recorded-decision': 'owner', critical: 'owner', ambiguous: 'reviewer' },
    telemetry: { push: true },
    clock: { poll: 1000, triggers: {
      report: { interval: 1000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' },
      audit: { interval: 1000, anchor: new Date(START).toISOString(), catchUp: 'skip',
        card: { title: 'Audit widgets', labels: ['type:change'], acceptance: '- The audit records its findings.', author: 'engineer' } },
    } },
  };
}

// The inventory is Table O at acceptance revision b781ed3d3bdb, not a generated oracle.
export const optionalCases = [
  ['O1', 'concurrency', ['concurrency']],
  ['O2', 'worktrees', ['worktrees']],
  ['O2a', 'worktrees.root', ['worktrees', 'root']],
  ['O2b', 'worktrees.topic', ['worktrees', 'topic']],
  ['O3', 'epicLabel', ['epicLabel']],
  ['O4', 'provisioning', ['provisioning']],
  ['O5', 'escalate', ['escalate']],
  ['O6', 'telemetry', ['telemetry']],
  ['O6a', 'telemetry.push', ['telemetry', 'push']],
  ['O7', 'clock', ['clock']],
  ['O7a', 'clock.triggers', ['clock', 'triggers']],
  ['O8a', 'trigger.card', ['clock', 'triggers', 'report', 'card']],
  ['O8b', 'trigger.job', ['clock', 'triggers', 'audit', 'job']],
  ['O9', 'card.author', ['clock', 'triggers', 'audit', 'card', 'author']],
  ['O10', 'board.owner', ['board', 'owner']],
  ['O11', 'board.priority', ['board', 'priority']],
  ['O12', 'role.labels', ['roles', 'engineer', 'labels']],
  ['O12', 'role.timeout', ['roles', 'engineer', 'timeout']],
  ['O13', 'role.providerLabels', ['roles', 'engineer', 'providerLabels']],
  ['O14', 'kind.rounds', ['kinds', 'change', 'rounds']],
  ['O15', 'kind.provisioning', ['kinds', 'change', 'provisioning']],
  ['O16', 'step.required', ['provisioning', 'probe', 'required']],
  ['O17', 'step.select', ['provisioning', 'probe', 'select']],
  ['O17', 'step.cwd', ['provisioning', 'probe', 'cwd']],
  ['O17', 'step.timeout', ['provisioning', 'probe', 'timeout']],
];

export const atPath = (value, path) => path.reduce((held, key) => held?.[key], value);

export function absentConfig(key) {
  const config = fullConfig();
  const entry = optionalCases.find(([, name]) => name === key);
  if (!entry) throw new Error('unlisted Table O key: ' + key);
  const path = entry[2];
  delete atPath(config, path.slice(0, -1))[path.at(-1)];
  // O4 also drops the kind's reference to the now-undeclared step (Table O preamble).
  if (key === 'provisioning') delete config.kinds.change.provisioning;
  return config;
}
