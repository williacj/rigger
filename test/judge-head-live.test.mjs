// ABOUTME: A gated Claude judge run on detached main and head worktrees, proving L2's composed
// instruction gets a diff, tests the provisioned head and posts findings without a denial.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { judgeAnswer } from '../src/workflow/judges.mjs';
import { invocation } from '../src/substrate/providers/claude.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import { detachedWorktreeAt, gitIn, repositoryAt } from './git-repository.mjs';
import { SESSION, callsOf, eventsOf, forgetting, pastRefusing, put, scratch, skip } from './claude-live.mjs';
import { onPath } from './on-path.mjs';

/** The repository's own Claude settings and command gate, committed into the fixture. */
const project = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** One fixture repository with two detached worktrees at the SHAs the pull request names. */
function pair(t) {
  const root = scratch();
  const repository = repositoryAt(join(root, 'repository'), {
    README: 'base\n',
    '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Judge this pull request.\n---\n\nFollow the prompt and post findings.\n',
    '.claude/settings.json': project('templates/claude/settings.json'),
    '.claude/hooks/refuse-reserved-git-commands.mjs': project('templates/claude/hooks/refuse-reserved-git-commands.mjs'),
    'package.json': JSON.stringify({ name: 'judge-head-fixture', version: '1.0.0', private: true, scripts: { test: 'node cwd.cjs' } }),
    'cwd.cjs': '// ABOUTME: Records where the fixture package test ran.\nrequire("node:fs").writeFileSync(process.env.RIGGER_HEAD_MARKER, process.cwd());\n',
  });
  const base = gitIn(repository, 'rev-parse', 'HEAD').trim();
  put(repository, 'README', 'head\n');
  gitIn(repository, 'add', 'README');
  gitIn(repository, 'commit', '-qm', 'head');
  const headSha = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const main = detachedWorktreeAt(repository, join(root, 'main'), base);
  const head = detachedWorktreeAt(repository, join(root, 'head'), headSha);
  forgetting(t, main);

  const marker = join(root, 'npm-test-cwd');
  const calls = join(root, 'gh-calls');
  const bin = join(root, 'bin');
  put(bin, 'gh', '#!/bin/sh\nprintf "%s\\0" "$@" >> "$RIGGER_GH_CALLS"\n');
  chmodSync(join(bin, 'gh'), 0o755);
  return { root, main, head, base, headSha, marker, calls, bin };
}

/** The real L2 answer for this fixture's pull request. */
function promptFor({ main, base, headSha }) {
  const read = (value) => ({ status: 'fulfilled', value });
  const card = {
    number: 7,
    title: 'Change README',
    body: '## Acceptance\n\n- npm test runs in head.\n',
    labels: ['type:change'],
    forge: {
      pull: read({ number: 70, base, head: headSha }),
      comments: read([]),
      editedAt: read(null),
      diff: read(gitIn(main, 'diff', base, headSha)),
    },
  };
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  const roles = { reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'standard' } };
  const answer = judgeAnswer(card, kinds, undefined, { roles });
  assert.equal(answer.action, 'judge');
  const { instruction, evidence } = answer.judges[0];
  return instruction + evidence;
}

// proves R-EVIDENCE-6
test('a live Claude judge uses L2 instructions to diff the pull request, test in head and post findings', { skip, timeout: 2 * SESSION }, async (t) => {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed past the refusing CLI');
  const dirs = pair(t);
  const { command, args, input, unset, env: set } = await invocation({
    agent: join(dirs.main, '.claude', 'agents', 'reviewer.md'),
    tier: 'standard',
    prompt: promptFor(dirs),
    directory: dirs.main,
    reach: [dirs.head],
    emitter: { emit() {} },
  });
  const env = { ...process.env, PATH: `${dirs.bin}:${pastRefusing()}`, RIGGER_HEAD_MARKER: dirs.marker, RIGGER_GH_CALLS: dirs.calls };
  for (const variable of unset) delete env[variable];
  Object.assign(env, set);
  const result = await runCommand({ command, args, input, cwd: dirs.main, env, timeout: SESSION, emitter: { emit() {} } });
  const events = eventsOf(result.stdout);
  const bash = callsOf(events).filter(({ name }) => name === 'Bash');
  const record = events.find((event) => event.type === 'result');
  t.diagnostic(`Claude calls: ${JSON.stringify(bash)}`);
  t.diagnostic(`Claude result: ${JSON.stringify(record)}`);
  t.diagnostic(`Claude exit: ${result.exit}; stderr: ${result.stderr.toString('utf8')}`);

  assert.equal(result.exit, 0);
  assert.equal(readFileSync(dirs.marker, 'utf8'), dirs.head);
  assert.ok(bash.some(({ input: call, result: output }) => call.command.includes('git diff') && call.command.includes(dirs.base) && call.command.includes(dirs.headSha) && output?.is_error !== true), 'no successful Bash diff held both SHAs');
  const gh = readFileSync(dirs.calls, 'utf8').split('\0').filter(Boolean);
  assert.deepEqual(gh.slice(0, 3), ['pr', 'comment', '70']);
  assert.equal(gh.filter((arg) => arg === 'pr').length, 1, `more than one pr comment: ${gh}`);
  assert.deepEqual((record?.permission_denials ?? []).filter((denial) => denial.tool_name === 'Bash' && /(?:\.\.\/head|\/head)\b/.test(JSON.stringify(denial.tool_input))), []);
});
