// ABOUTME: Records each stand-in command and its child PID so context tests identify real L0 kills.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, leave, TAIL } from './process-fixtures.mjs';

/** Answer through the supplied command, then leave a recorded survivor in its process group. */
export function leavingRecordedChild(directory, name, command, { leadersOnly = false } = {}) {
  return fixture(directory, name, [
    `printf '%s\\0' "$@" > "$here/${name}-request-$$"`,
    ...(leadersOnly ? [`if [ "$(/bin/ps -o pgid= -p $$ | /usr/bin/tr -d ' ')" != "$$" ]; then ${command}; exit $?; fi`] : []),
    command,
    'status=$?',
    leave(TAIL, `${name}-child-$$`),
    'exit $status',
  ].join('\n'));
}

/** Join a real survivor kill to the arguments of the command that left that exact PID. */
export function commandKills(directory, events, name) {
  const requests = new Map();
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(`${name}-child-`) || !entry.endsWith('.pid')) continue;
    const parent = entry.slice(`${name}-child-`.length, -4);
    const request = join(directory, `${name}-request-${parent}`);
    assert.ok(existsSync(request), `recorded child has no command arguments: ${entry}`);
    const pid = Number(readFileSync(join(directory, entry), 'utf8'));
    const args = readFileSync(request, 'utf8').split('\0').slice(0, -1);
    requests.set(pid, args);
  }
  return events.filter((event) => event.event === 'survivor.killed' && requests.has(event.pid))
    .map((event) => ({ event, args: requests.get(event.pid) }));
}

/** Require the command to have produced a kill before asserting the context of every such event. */
export function assertCommandContext(rows, matches, card, dispatch, what) {
  const selected = rows.filter(({ args }) => matches(args.join(' ')));
  assert.ok(selected.length > 0, `${what}: no real survivor.killed event`);
  for (const { event } of selected) {
    assert.equal(event.layer, 'L0');
    assert.equal(event.card, card, `${what}: card`);
    if (dispatch === undefined) assert.equal(Object.hasOwn(event, 'dispatch'), false, `${what}: no dispatch key`);
    else assert.equal(event.dispatch, dispatch, `${what}: dispatch`);
  }
}
