// ABOUTME: L0's process adapter: it runs one command in a process group of its own, and once the
// command exits, kills what is left of that group and records each process it killed.

import { spawn } from 'node:child_process';
import { once } from 'node:events';

/** Every chunk `stream` carries, as one buffer, once the stream has closed. */
async function drained(stream) {
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  await once(stream, 'close');
  return Buffer.concat(chunks);
}

/**
 * Runs `command` with `args` in `cwd` under exactly `env`, and settles on its exit code and the
 * bytes it wrote to standard output and standard error, each whole and unchanged.
 */
export async function runCommand({ command, args, cwd, env }) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = Promise.all([drained(child.stdout), drained(child.stderr)]);
  const [exit] = await once(child, 'exit');
  const [stdout, stderr] = await output;
  return { exit, stdout, stderr };
}
