// ABOUTME: Tests the PreToolUse command gate as Claude Code runs it — as a process fed a hook
// ABOUTME: payload, for the exit code and the reason it returns on reserved and on unreadable text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude',
  'hooks',
  'refuse-reserved-git-commands.mjs',
);

/**
 * Run the gate the way the hook runs it: a real process, the real payload shape, stdin to stdout.
 *
 * What the gate promises is an exit code and a decision, and nothing short of running it as a
 * process observes either. `exit 2` is the blocking code Claude Code reads; `exit 0` steps aside.
 */
function rule(command) {
  const result = spawnSync(process.execPath, [gate], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  return { code: result.status, reason: result.stderr.trim(), decision: result.stdout };
}

const permits = (command, why) => {
  const { code, reason } = rule(command);
  assert.equal(code, 0, `the gate refused (${reason}) where it should have stepped aside: ${why}`);
};

const refuses = (command, why) => {
  const { code, decision } = rule(command);
  assert.equal(code, 2, `the gate permitted a command it should have refused: ${why}`);
  assert.match(decision, /"permissionDecision":"deny"/, 'the decision was not a deny');
};

test('an apostrophe in a here-document body does not make the command unreadable', () => {
  // The defect this card fixes. A here-document body is data on standard input, so an apostrophe
  // in it is a character in a message, not a quote opening shell text.
  permits(
    "cat > notes.md <<'EOF'\ndon't\nEOF",
    'an apostrophe inside a here-document body is prose, not a quote',
  );
});

test('an arithmetic expansion is not a here-document, however it is spaced', () => {
  // `<<` inside `$(( ))` is bash's left shift. Reading it as a redirection would take the rest of
  // the command for a body, which is how skipping a body could come to hide a command.
  permits('echo $((1<<2)) && echo done', 'a left shift written closed up');
  permits('echo $(( 1 << 2 )) && echo done', 'a left shift written with blanks around it');
  refuses(
    'echo $(( 1 << 2 )) && git push --force',
    'a force push after an arithmetic expansion is still a force push',
  );
});
