// ABOUTME: Rigger's own config: the board it works, the roles it dispatches, the kinds of work it
// ABOUTME: binds, and the steps that provision a card. Rigger is its own first consumer.

// This is L4 for this repository, so it is the consumer's file rather than the engine's, and it
// carries no line budget (`ARCHITECTURE.md`, "Budgets"). It declares the extension points that
// document's table marks `Yes`, in the spelling its published config shape gives them, and
// `src/config/validate.mjs` refuses anything else.
//
// `rigger init` writes this file for a new consumer (`docs/v0-build-plan.md`, M0). What it writes
// and what the validator accepts are one artifact, which is why this one is written here rather
// than derived from a run of a verb that does not exist yet.
export default {
  repo: 'williacj/rigger',
  board: { project: 1, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } },
  concurrency: 3,
  roles: {
    engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard' },
    reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'high' },
    pm: { agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high' },
    spikeEngineer: { agent: '.claude/agents/spike-engineer.md', provider: 'claude', tier: 'high' },
  },
  kinds: {
    // One judge. `rounds` omitted, so the default of three applies (`R-LOOP-9`).
    change: {
      select: { labels: ['type:change'] },
      maker: 'engineer',
      judges: ['reviewer'],
      provisioning: ['npm-ci'],
    },
    // The panel case: two agent judges concurrently, the owner last.
    spec: {
      select: { labels: ['type:spec'] },
      maker: 'pm',
      judges: ['reviewer', 'engineer', 'owner'],
      rounds: 2,
      provisioning: ['npm-ci'],
    },
    spike: {
      select: { labels: ['type:spike'] },
      maker: 'spikeEngineer',
      judges: ['reviewer'],
      provisioning: ['npm-ci'],
    },
  },
  provisioning: {
    'npm-ci': { run: 'npm ci', required: true },
    // Only cards that touch the demo tape pay for this, and it declares nothing about whether the
    // work requires it, so the work does not (`R-PROV-1`).
    vhs: { run: 'brew list vhs || brew install vhs', select: { labels: ['area:demo'] } },
  },
  escalate: ['recorded-decision', 'critical', 'ambiguous'],
  telemetry: { push: false },
};
