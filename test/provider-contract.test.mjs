// ABOUTME: Holds every module in L0's adapter map to the provider adapter interface, so that a
// second agent CLI's adapter answers what L1 and the verbs read from the first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The tiers Rigger fixes (`O4` on #467), which every adapter maps to a model of its own. */
const TIERS = ['standard', 'high'];

/** An emitter that fails on any event, for an adapter that is handed one and runs nothing. */
const silent = { emit: (event) => assert.fail(`the adapter emitted ${event} while answering its invocation`) };

/**
 * Every way the module `adapter`, found in the map under `key`, answers otherwise than ruling 1 Q1
 * and ruling 5 on #467 have it, each naming the module, for an invocation in `directory`.
 */
async function departures(key, adapter, directory) {
  const found = [];
  const says = (what) => found.push(`the ${key} adapter ${what}`);
  if (adapter.name !== key) says(`names itself ${JSON.stringify(adapter.name)}, not ${JSON.stringify(key)}`);
  if (!Array.isArray(adapter.auth) || adapter.auth.length === 0 || !adapter.auth.every((arg) => typeof arg === 'string')) says('exports no argv as `auth`');
  if (typeof adapter.assets !== 'string' || adapter.assets === '') says('exports no directory as `assets`');
  for (const tier of TIERS) if (typeof adapter.tiers?.[tier] !== 'string') says(`maps no model to the tier \`${tier}\``);
  if (adapter.invocation?.constructor?.name !== 'AsyncFunction') says('does not declare `invocation` async');
  if (found.length > 0) return found;
  const answer = adapter.invocation({ agent: join(directory, 'agent.md'), tier: 'standard', prompt: 'the prompt', directory, emitter: silent });
  if (!(answer instanceof Promise)) return [...found, 'answers its invocation with no promise'];
  const { command, args, input, unset, env } = await answer;
  if (typeof command !== 'string' || command.includes('/')) says(`answers the command ${JSON.stringify(command)}, which is no command name`);
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) says('answers `args` that are not all strings');
  if (!Buffer.from(input ?? '').equals(Buffer.from('the prompt'))) says('answers an `input` that is not the prompt\'s bytes');
  if (!Array.isArray(unset) || !unset.every((variable) => typeof variable === 'string')) says('answers no list of variables as `unset`');
  if (env === null || typeof env !== 'object' || Array.isArray(env) || !Object.values(env).every((value) => typeof value === 'string')) says('answers no object of variables to set as `env`');
  return found;
}

/** A scratch directory under `TMPDIR`, by its real path, removed when the test ends. */
function scratch(t) {
  const directory = realpathSync.native(temporaryDirectory('rigger-provider-contract-'));
  return directory;
}

test('every module in the adapter map answers the provider adapter interface', async (t) => {
  // Ruling 5 on #467: one declared contract, so that one test holds the Claude Code module now and
  // the Codex module once #489 adds it. The defect this catches is an adapter L1 cannot await, or
  // one that answers no `unset` for L1 to drop or no `env` for it to set (ruling 9 on #467).
  const directory = scratch(t);
  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    const repo = join(directory, key);
    mkdirSync(repo);
    assert.deepEqual(await departures(key, adapter, repo), []);
  }
});

test('the contract names the module that answers otherwise, and how', async (t) => {
  const directory = scratch(t);
  const plain = {
    name: 'other', auth: ['other', 'whoami'], assets: '.other', tiers: { standard: 'small' },
    invocation: () => ({ command: '/usr/bin/other', args: [], input: 'the prompt', unset: [] }),
  };
  const found = await departures('other', plain, directory);
  assert.ok(found.includes('the other adapter maps no model to the tier `high`'), found.join('\n'));
  assert.ok(found.includes('the other adapter does not declare `invocation` async'), found.join('\n'));

  const misnamed = { ...plain, tiers: { standard: 's', high: 'h' }, invocation: async () => ({ command: '/usr/bin/other', args: [], input: 'x', unset: 'HOME', env: ['TMPDIR'] }) };
  const answered = await departures('other', misnamed, directory);
  assert.deepEqual(answered, [
    'the other adapter answers the command "/usr/bin/other", which is no command name',
    'the other adapter answers an `input` that is not the prompt\'s bytes',
    'the other adapter answers no list of variables as `unset`',
    'the other adapter answers no object of variables to set as `env`',
  ]);
});
