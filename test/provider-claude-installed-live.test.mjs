// ABOUTME: A gated live run of a real `claude` session dispatched through Rigger installed from a
// tarball, showing the consumer's own skill and hook load and the package's do not. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AGENT, SESSION, callsOf, forgetting, pastRefusing, transcriptsOf, withheldBy, put, scratch, session, skip } from './claude-live.mjs';
import { installFromTarball } from './installed-rigger.mjs';
import { onPath } from './on-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// proves R-SAFE-6, R-SAFE-7
test('a live dispatch through the installed package loads the consumer\'s skill and hook, and none of the same names the installed package\'s templates hold', { skip, timeout: 2 * SESSION + 120_000 }, async (t) => {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const base = scratch(t);
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
