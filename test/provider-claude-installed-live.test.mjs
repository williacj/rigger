// ABOUTME: A gated live run of a real `claude` session dispatched through Rigger installed from a
// tarball, showing the consumer's own skill and hook load and the package's do not. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AGENT, SESSION, callsOf, forgetting, pastRefusing, transcriptsOf, unclassified, withheldBy, put, scratch, session, skip } from './claude-live.mjs';
import { installFromTarball } from './installed-rigger.mjs';
import { onPath } from './on-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// proves R-SAFE-6, R-SAFE-7
test('a live dispatch through the installed package loads the consumer\'s skill and hook, and none of the same names the installed package\'s templates hold', { skip, timeout: 2 * SESSION + 120_000 }, async (t) => {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const base = scratch();
  const { consumer } = installFromTarball(root, base);
  forgetting(t, consumer);
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  // The installed package's own templates, holding a skill and a hook of the consumer's names.
  put(installed, 'templates/claude/skills/marker-skill/SKILL.md', '---\nname: marker-skill\ndescription: A marker.\n---\n\nThe skill marker is HERON-packageskill-480.\n');
  put(installed, 'templates/claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `/usr/bin/touch "${join(base, 'package-hook-ran')}"; echo HERON-packagehook-480` }] }] } }));
  // The consumer's own, in the repository the package is installed in.
  put(consumer, '.claude/skills/marker-skill/SKILL.md', '---\nname: marker-skill\ndescription: A marker.\n---\n\nThe skill marker is HERON-consumerskill-480.\n');
  put(consumer, '.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `/usr/bin/touch "${join(base, 'consumer-hook-ran')}"; echo HERON-consumerhook-480` }] }] } }));
  put(consumer, '.claude/agents/live.md', AGENT('HERON-agentend-480b'));

  const adapters = {
    invocation: (await import(pathToFileURL(join(installed, 'src', 'substrate', 'providers', 'claude.mjs')).href)).invocation,
    runCommand: (await import(pathToFileURL(join(installed, 'src', 'substrate', 'process.mjs')).href)).runCommand,
  };
  const prompt = [
    'Answer each item on its own line, using no tool but Read.',
    '1. Name every skill your context lists, or say NONE.',
    '2. Read the file .claude/skills/marker-skill/SKILL.md in your working directory and quote its marker.',
  ].join('\n');
  const run = await session(adapters, { agent: join(consumer, '.claude', 'agents', 'live.md'), tier: 'standard', prompt, directory: consumer });
  t.diagnostic(`args: ${JSON.stringify(run.args)}`);
  t.diagnostic(`init: ${JSON.stringify(run.init)}`);
  t.diagnostic(`hooks: ${JSON.stringify(run.events.filter((event) => /^hook_/.test(event.subtype ?? '')))}`);
  t.diagnostic(`calls: ${JSON.stringify(callsOf(run.events))}`);
  t.diagnostic(`answer: ${JSON.stringify(run.answer)}`);

  assert.equal(run.result.exit, 0);
  assert.deepEqual(run.killed, [], 'the session left processes L0 killed');
  assert.deepEqual(run.init.plugins, [], 'a plugin the directory does not declare reached the session');
  assert.deepEqual(run.init.tools.filter((tool) => withheldBy(run.args).includes(tool)), [], 'a withheld tool reached the session');
  assert.deepEqual(unclassified(run.init.tools), [], 'the session was offered a tool nobody has classified');
  assert.equal(run.init.tools.includes('Task') || run.init.tools.includes('Agent'), false, 'the agent tool reached the session (O45)');
  assert.equal(run.init.tools.includes('Workflow'), false, 'Workflow reached the session (O52)');
  assert.equal(existsSync(transcriptsOf(consumer)), false, 'the session left a transcript in the owner\'s home');
  assert.deepEqual(callsOf(run.events).filter(({ name }) => name === 'Bash'), [], 'the session made a Bash call');
  assert.ok(existsSync(join(base, 'consumer-hook-ran')), 'the consumer\'s hook did not run');
  assert.equal(existsSync(join(base, 'package-hook-ran')), false, 'the package\'s hook ran');
  const hooks = JSON.stringify(run.events.filter((event) => /^hook_/.test(event.subtype ?? '')));
  assert.match(hooks, /HERON-consumerhook-480/);
  assert.doesNotMatch(hooks, /HERON-packagehook-480/);
  assert.match(run.answer, /HERON-consumerskill-480/);
  assert.doesNotMatch(run.answer, /HERON-packageskill-480/);
  assert.equal(readFileSync(join(installed, 'templates', 'claude', 'skills', 'marker-skill', 'SKILL.md'), 'utf8').includes('HERON-packageskill-480'), true);
});

// Host reason: wiring; an installed Claude Code session must traverse installed L3 and L1.
// Rigger decision: test/kept-output.test.mjs — O1: a completed maker keeps both streams byte for byte under its recorded dispatch id
// proves R-RECORD-19
test('a live L3 role dispatch keeps Claude Code final result output under its recorded id', { skip, timeout: 2 * SESSION }, async (t) => {
  const { mkdirSync } = await import('node:fs');
  const { repositoryAt, worktreeAt } = await import('./git-repository.mjs');
  const { createFakeBoard } = await import('./fake-board.mjs');
  assert.ok(onPath('claude', pastRefusing()), 'no live Claude Code is installed');
  const base = scratch();
  const { consumer } = installFromTarball(root, base);
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  const { loop } = await import(pathToFileURL(join(installed, 'src/scheduling/loop.mjs')).href);
  const { openSink, readEvents } = await import(pathToFileURL(join(installed, 'src/observation/sink.mjs')).href);
  const repository = repositoryAt(join(base, 'repository'), { 'agent.md': '# Live output fixture\nAnswer exactly as instructed. Use no tool.\n' });
  const workspace = worktreeAt(repository, join(base, 'rigger-1380'), 'rigger-1380');
  const home = join(base, 'claude-home');
  mkdirSync(home);
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: 'r-1380-live', now: Date.now });
  const columns = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };
  const fake = createFakeBoard({ columns: Object.values(columns), items: [{ type: 'issue', repository: 'acme/widgets', number: 1380, title: 'Live output', body: '', labels: [], column: 'Ready' }] });
  // ARCHITECTURE.md's role answer and L3 board-handle contracts; this live test claims wiring only.
  const maker = { role: 'engineer', agent: 'agent.md', provider: 'claude', tier: 'standard', timeout: SESSION,
    instruction: 'Reply with HERON-1380-LIVE-RESULT. Use no tool.\n', evidence: '' };
  const built = loop({ config: { concurrency: 1, board: { columns } },
    board: { readColumns: async () => columns, readPriority: async () => ({ items: await fake.operations.readItems(), declared: null, options: null }) },
    facts: async () => () => ({ action: 'dispatch', kind: 'change', maker }), decide: () => ({ action: 'ignore' }),
    l2: { claimed: async () => {}, settled: async () => undefined }, sink,
    kill: async () => {}, workspace: async () => ({ path: workspace, branch: 'rigger-1380', scratch: join(base, 'scratch', 'rigger-1380'), repository }),
    judgeDirectory: async () => { throw new Error('this wiring fixture has no judge'); }, removeDirectories: async () => {},
    state, environment: { ...process.env, PATH: pastRefusing(), CLAUDE_CONFIG_DIR: home }, run: 'r-1380-live' });
  const [ended] = await built.pull();
  assert.equal(ended.outcome.status, 'fulfilled', ended.outcome.reason?.message);
  assert.equal(ended.outcome.value.exit, 0, `${ended.outcome.value.stderr.toString('utf8')}\n${ended.outcome.value.stdout.toString('utf8')}`);
  const start = readEvents(state).find((event) => event.event === 'dispatch.start');
  const path = join(state, 'output', start.dispatch, 'stdout');
  assert.ok(existsSync(path), 'the live L3 dispatch has no kept stdout');
  const bytes = readFileSync(path);
  assert.deepEqual(bytes, ended.outcome.value.stdout, 'the kept stream differs from the real CLI result');
  assert.deepEqual(readFileSync(join(state, 'output', start.dispatch, 'stderr')), ended.outcome.value.stderr);
  const final = bytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).findLast((event) => event.type === 'result');
  assert.ok(final && final.result.includes('HERON-1380-LIVE-RESULT'), 'the kept stdout has no final result event');
  t.diagnostic(`live output: ${JSON.stringify({ dispatch: start.dispatch, path, home, final })}`);
});
