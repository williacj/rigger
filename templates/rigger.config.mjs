// ABOUTME: This repository's Rigger config: the board it works, the roles it dispatches, the
// kinds of work it binds, and the steps that provision a card.

// This file is L4, the consumer's own layer, so it is yours rather than the engine's and it
// carries no line budget. It declares the extension points Rigger's architecture marks as the
// consumer's, in the spelling that document's published config shape gives them, and Rigger
// refuses any declaration it does not offer.
//
// `rigger init` wrote this file, and filled `repo` in from this repository's `origin` remote. It
// left the board number as `PROJECT_NUMBER`, because a board number is GitHub's and nothing
// `init` can read names it: set it to the number your board's URL ends in, and until you do
// Rigger refuses this config rather than work a board nobody chose. Everything else arrives as
// the template had it, so the column display names, the roles and the kinds of work are starting
// points rather than answers: change them to match your board, and run `rigger doctor` to check
// what you changed.
export default {
  repo: 'OWNER/REPOSITORY',
  board: { project: 'PROJECT_NUMBER', columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } },
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
