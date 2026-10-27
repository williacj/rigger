// ABOUTME: Supplies an accepted target and injected doctor authorities for launchd tests.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as config from '../src/config/validate.mjs';
import { CHECKS } from '../src/cli/doctor.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Accepted config with four cards and three agent judges: 180 seconds by Table B. */
export function configured(target = temporaryDirectory('997-doctor-launchd-')) {
  mkdirSync(target, { recursive: true });
  const given = {
    repo: 'acme/widgets', concurrency: 4,
    board: { project: 12, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } },
    roles: Object.fromEntries(['engineer', 'reviewer', 'architect', 'pm'].map((name) =>
      [name, { agent: `.claude/agents/${name}.md`, provider: 'claude', tier: 'standard' }])),
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'architect', 'pm', 'owner'] } },
  };
  assert.deepEqual(config.validate(given), [], 'fixture config is accepted before testing the launchd check');
  writeFileSync(join(target, 'rigger.config.mjs'), `export default ${JSON.stringify(given)};\n`);
  return {
    target, given,
    options: {
      target, packageRoot: temporaryDirectory('997-running-package-'), platform: 'darwin',
      // git rev-parse --show-toplevel's documented answer; no process is needed to name this fixture.
      ask: (command, args) => {
        assert.equal(command, 'git');
        assert.deepEqual(args, ['-C', target, 'rev-parse', '--show-toplevel']);
        return { status: 0, stdout: `${target}\n`, stderr: '' };
      },
      checks: CHECKS.filter((check) => ['admissionCheck', 'launchdCheck'].includes(check.name)),
      readLaunchdJob: async () => null,
    },
  };
}

export const launchdLine = (ran) => ran.text.split('\n').find((line) => /  launchd job:/.test(line)) ?? '';

/** A regular program in a package declaring Rigger, under the caller's chosen root. */
export function packageProgram(root) {
  const program = join(root, 'src', 'cli', 'rigger.mjs');
  mkdirSync(dirname(program), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@williacj/rigger' }));
  writeFileSync(program, '// fixture program\n');
  return program;
}
