// ABOUTME: Tests the CLI surface against the README's "Install and usage" block, which is the
// ABOUTME: CLI spec: which verbs `--help` lists, in what order, and what an unlanded verb does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const manifest = JSON.parse(read('package.json'));

/** The command's own entry point, read out of the manifest rather than typed here. */
function entryPoint() {
  const bin = manifest.bin?.rigger;
  assert.ok(bin, 'the package declares no `rigger` command for `--help` to be a command of');
  return join(root, bin);
}

/** What the command prints and exits with, given these arguments. */
function rigger(...args) {
  const ran = spawnSync(process.execPath, [entryPoint(), ...args], { encoding: 'utf8' });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status };
}

/**
 * A text's lines, whichever endings it arrived with. A checkout on Windows carries the README
 * with CRLF, so a reader that splits on the newline alone leaves a carriage return on every line
 * and matches nothing on that host.
 */
const linesOf = (text) => text.replace(/\r\n/g, '\n').split('\n');

/** One `## ` section of a markdown document, its own heading line dropped. */
function section(markdown, heading) {
  const lines = linesOf(markdown);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  assert.notEqual(start, -1, `the document has no \`## ${heading}\` section`);
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? after : after.slice(0, end)).join('\n');
}

/**
 * The verbs the README's "Install and usage" block lists, in the order it lists them.
 *
 * `AGENTS.md`'s authority table makes the README the CLI contract and its verb list the spec, so
 * this reads that block rather than holding a list of its own. The scope is the fenced block
 * inside the section, because the README names verbs in its prose too — Prerequisites mentions
 * `setup-board`, and Status mentions `report` — and prose is not the contract.
 *
 * Only the invoked verb is taken, never the rest of the line: the `#` comment beside each
 * invocation is help text, which the block's own note puts outside the match.
 */
export function usageVerbs(readme, packageName) {
  const block = section(readme, 'Install and usage').match(/```[a-z]*\n([\s\S]*?)```/);
  assert.ok(block, "the README's Install and usage section holds no command block");
  const invocation = new RegExp(`^npx\\s+${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([\\w-]+)`);
  const verbs = block[1]
    .split('\n')
    .map((line) => line.match(invocation))
    .filter(Boolean)
    .map(([, verb]) => verb);
  assert.ok(verbs.length > 0, `no line in the block invokes \`npx ${packageName} <verb>\``);
  return verbs;
}

/**
 * The verbs `--help` lists, in the order it lists them.
 *
 * Each verb is the first word of its line, so what the line says after it is help text and none
 * of this check's business: the acceptance puts help text outside the verb match.
 */
export function helpVerbs(help) {
  const lines = linesOf(help);
  const start = lines.findIndex((line) => line.trim() === 'Verbs:');
  assert.notEqual(start, -1, 'the help output holds no verb list');
  const listed = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    listed.push(line.trim().split(/\s+/)[0]);
  }
  return listed;
}

test('--help lists exactly the verbs the README lists, in that order and no others', () => {
  // The defect this catches is the CLI's verb list drifting from the README's: a verb the README
  // gained and the CLI never did, one the CLI kept after the README dropped it, a misspelling, or
  // the order rearranged. The expected list is derived from the README on every run, so editing
  // the README moves this test rather than needing the test edited with it.
  const help = rigger('--help');

  assert.equal(help.code, 0, `\`rigger --help\` failed: ${help.err}`);
  assert.deepEqual(helpVerbs(help.out), usageVerbs(read('README.md'), manifest.name));
});
