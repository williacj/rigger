// ABOUTME: Reads a loaded launchd job's fields through the process adapter, without interpreting engine config.

import { isAbsolute } from 'node:path';

import { runCommand } from './process.mjs';
import { gitEnvironment } from './git-environment.mjs';
import { FORGE_TIMEOUT } from './forge/runners.mjs';

/** The program and exit timeout of the loaded label in this user's GUI domain. */
export async function loadedJob(label, { uid = process.getuid(), emitter, timeout = FORGE_TIMEOUT, run = runCommand } = {}) {
  const result = await run({ command: 'launchctl', args: ['print', `gui/${uid}/${label}`],
    cwd: process.cwd(), env: gitEnvironment(), emitter, timeout });
  if (result.timedOut) throw new Error(`launchctl print reached its timeout of ${timeout} ms`);
  if (result.exit === 113) return null;
  if (result.exit !== 0) throw new Error(`launchctl print exited ${result.exit}`);
  const output = result.stdout.toString('utf8');
  const programs = [...output.matchAll(/^\tprogram = (.+)$/gm)];
  const timeouts = [...output.matchAll(/^\texit timeout = (\d+)$/gm)];
  if (programs.length !== 1 || timeouts.length !== 1 || !isAbsolute(programs[0][1]) || !Number.isSafeInteger(Number(timeouts[0][1]))) {
    throw new Error('launchctl print cannot read one absolute program and one whole exit timeout');
  }
  return { program: programs[0][1], exitTimeout: Number(timeouts[0][1]) };
}
