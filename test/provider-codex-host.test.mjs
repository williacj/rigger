// ABOUTME: Proves Codex probe PATH lookup and the session boundaries requiring executable stand-ins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as codex from '../src/substrate/providers/codex.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { keeping, DECLARATION, layout, onPath, following, answerOf, dispatchLayout, throughL1 } from './provider-codex-fixtures.mjs';

test('H1: omitting the host starts the skill probe with the stand-in codex found on PATH', async (t) => {
  const { directory, scratch: made, agent } = layout(t);
  const stand = onPath({ skills: [] });
  await assert.doesNotReject(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() }), 'the default host must start the PATH executable');
  assert.equal(stand.probes().length, 1, 'the PATH stand-in must observe a real probe');
  assert.deepEqual(stand.probes()[0].args.slice(-2), ['debug', 'prompt-input']);
  assert.equal(realpathSync.native(stand.probes()[0].cwd), realpathSync.native(directory));
});

test('given a Codex role dispatch through L1, a file the session writes under its TMPDIR lands in the role\'s temporary directory (O93)', async (t) => {
  const { root, directory, base, repository, state, sink } = dispatchLayout(t);
  const stand = onPath({ skills: [] });
  // A `codex` ahead of the stand-in that writes one file under its TMPDIR, then hands the run on.
  const writer = join(root, 'writer');
  mkdirSync(writer);
  writeFileSync(join(writer, 'codex'), `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = prompt-input ] && exec '${join(stand.dir, 'codex')}' "$@"; done\nprintf landed > "$TMPDIR/landed-by-the-session"\nexec '${join(stand.dir, 'codex')}' "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${writer}:${process.env.PATH}`;

  const result = await throughL1({ answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: process.env.PATH, TMPDIR: join(root, 'handed-tmp') }, sink, state });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(readFileSync(join(realpathSync.native(base), 'engineer', 'tmp', 'landed-by-the-session'), 'utf8'), 'landed');
  assert.equal(existsSync(join(root, 'handed-tmp', 'landed-by-the-session')), false, 'the file landed under the TMPDIR the caller handed');
});

test('given a Codex judge dispatch through L1 against the fake forge, the stand-in codex receives -C naming main and --add-dir naming head', async (t) => {
  const { root, base, repository, state, sink } = dispatchLayout(t);
  const judge = join(root, 'judges', 'rigger-1412', 'reviewer');
  const main = join(judge, 'main');
  const head = join(judge, 'head');
  for (const each of [join(main, '.codex'), join(main, '.claude', 'agents'), head]) mkdirSync(each, { recursive: true });
  writeFileSync(join(main, '.codex', 'config.toml'), DECLARATION);
  writeFileSync(join(main, '.claude', 'agents', 'reviewer.md'), '# Reviewer\n');
  const fake = installFakeGh(join(root, 'judges'), { repo: 'acme/widgets', project: 12 });
  const stand = onPath({ skills: [] });
  const path = stand.first(`${dirname(fake.gh)}:${process.env.PATH}`);

  const result = await throughL1({ answer: answerOf({ role: 'reviewer', agent: '.claude/agents/reviewer.md', instruction: 'Judge pull request #9.\n' }), cwd: main, directory: judge, scratch: base, repository, reach: [head], env: { PATH: path }, sink, state });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const [session] = stand.sessions();
  assert.deepEqual(following(session.args, '-C'), [main]);
  assert.deepEqual(following(session.args, '--add-dir'), [head, join(realpathSync.native(join(base, 'reviewer')), 'tmp')]);
  assert.equal(realpathSync.native(session.cwd), realpathSync.native(main));
});
