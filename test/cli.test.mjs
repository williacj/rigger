// ABOUTME: Tests the CLI surface against the README's "Install and usage" block, which is the
// CLI spec: which verbs `--help` lists, in what order, and what an unlanded verb does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANDED, VERBS, help } from '../src/cli/verbs.mjs';

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
  const verbs = usageLines(readme, packageName).map(({ verb }) => verb);
  assert.ok(verbs.length > 0, `no line in the block invokes \`npx ${packageName} <verb>\``);
  return verbs;
}

/**
 * Each invocation in the README's "Install and usage" block, as its verb and the `#` comment
 * beside it, in the order the block lists them. A line with no comment carries `undefined`.
 */
function usageLines(readme, packageName) {
  const block = section(readme, 'Install and usage').match(/```[a-z]*\n([\s\S]*?)```/);
  assert.ok(block, "the README's Install and usage section holds no command block");
  const name = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whatever follows the verb up to a `#` is its arguments, and is skipped, so an invocation
  // carrying one still names its verb.
  const invocation = new RegExp(`^npx\\s+${name}\\s+([\\w-]+)[^#]*(?:#\\s*(.*?))?\\s*$`);
  return block[1]
    .split('\n')
    .map((line) => line.match(invocation))
    .filter(Boolean)
    .map(([, verb, comment]) => ({ verb, comment }));
}

/** The `#` comment beside one verb's invocation in the README's "Install and usage" block. */
export function usageComment(readme, packageName, verb) {
  const found = usageLines(readme, packageName).filter((line) => line.verb === verb);
  assert.equal(found.length, 1, `the README's block invokes \`${verb}\` ${found.length} times, not once`);
  assert.ok(found[0].comment, `the README's block carries no comment beside \`${verb}\``);
  return found[0].comment;
}

/**
 * The verbs `--help` lists, in the order it lists them.
 *
 * Each verb is the first word of its line, so what the line says after it is help text and none
 * of this check's business: the acceptance puts help text outside the verb match.
 */
export function helpVerbs(help) {
  return helpLines(help).map(({ verb }) => verb);
}

/** Each line of the verb list `--help` prints, as its verb and the description after it. */
function helpLines(help) {
  const lines = linesOf(help);
  const start = lines.findIndex((line) => line.trim() === 'Verbs:');
  assert.notEqual(start, -1, 'the help output holds no verb list');
  const listed = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    const [, verb, summary] = line.trim().match(/^(\S+)\s*(.*)$/);
    listed.push({ verb, summary });
  }
  return listed;
}

/** The description `--help` prints beside one verb. */
export function helpSummary(help, verb) {
  const found = helpLines(help).filter((line) => line.verb === verb);
  assert.equal(found.length, 1, `\`--help\` lists \`${verb}\` ${found.length} times, not once`);
  return found[0].summary;
}

test('--help lists exactly the verbs the README lists, in that order and no others', () => {
  // The defect this catches is the CLI's verb list drifting from the README's: a verb the README
  // gained and the CLI never did, one the CLI kept after the README dropped it, a misspelling, or
  // the order rearranged. The expected list is derived from the README on every run, so editing
  // the README moves this test rather than needing the test edited with it.
  const shown = rigger('--help');

  assert.equal(shown.code, 0, `\`rigger --help\` failed: ${shown.err}`);
  assert.deepEqual(helpVerbs(shown.out), usageVerbs(read('README.md'), manifest.name));
});

test("--help describes doctor in the words of the README's comment beside doctor", () => {
  // The defect this catches is `doctor` gaining a check that the README's line names and `--help`
  // does not, or the reverse. Only `doctor` is held to its comment: `once` and `run` say in
  // `--help` that they dispatch no maker before M4, which their README comments do not. The
  // expected text is read from the README on every run, so rewording the README's comment moves
  // this test rather than needing the test edited with it.
  const shown = rigger('--help');

  assert.equal(shown.code, 0, `\`rigger --help\` failed: ${shown.err}`);
  assert.equal(helpSummary(shown.out, 'doctor'), usageComment(read('README.md'), manifest.name, 'doctor'));
});

test("the readers take a verb's description from its own line, whatever that line says", () => {
  // The defect this catches is either reader answering with text of its own, or with another
  // verb's line, which would hold `doctor` to something other than the README's comment on it.
  const readme = readmeListing(['beta', 'alpha']);
  assert.equal(usageComment(readme, '@williacj/rigger', 'alpha'), 'what alpha does');

  const summaries = [['beta', 'what beta does'], ['alpha', 'alpha does something else']];
  assert.equal(helpSummary(help(summaries), 'alpha'), 'alpha does something else');
});

test('a verb whose milestone has not landed says so and exits non-zero', () => {
  // Every verb but the landed ones takes this path. The defect it catches is a verb that exits
  // zero, or prints nothing, and so reads to whoever called it as work that was done.
  //
  // A landed verb is excluded by name, and the names are read out of the CLI rather than kept
  // here, so a verb landing moves this test with it. It is excluded at all because running one
  // would run it against this checkout: `rigger()` above inherits this process's directory, and
  // `init` is a verb that writes (`R-SAFE-5`). `test/init.test.mjs` runs it, from a copy of the
  // package against a scratch repository.
  const listed = usageVerbs(read('README.md'), manifest.name);
  for (const verb of Object.keys(LANDED)) {
    assert.ok(listed.includes(verb), `\`${verb}\` has landed, and the README's block lists no such verb`);
  }
  const unlanded = listed.filter((verb) => !Object.hasOwn(LANDED, verb));
  assert.ok(unlanded.length > 0, 'every verb has landed, so this test holds nothing');
  for (const verb of unlanded) {
    const ran = rigger(verb);

    assert.notEqual(ran.code, 0, `\`rigger ${verb}\` exited 0 without doing anything`);
    assert.match(ran.err, /not yet implemented/);
    assert.match(ran.err, new RegExp(verb));
  }
});

test('an argument that is no verb is refused rather than answered as a future verb', () => {
  // The verbs are the whole surface, so anything else has no milestone to wait for. The defect
  // this catches is the branch above answering for everything: a typo told that it is coming in
  // a later milestone is told something untrue.
  const ran = rigger('banana');

  assert.notEqual(ran.code, 0);
  assert.doesNotMatch(ran.err, /not yet implemented/);
  assert.match(ran.err, /banana/);
});

test('the command with no verb at all asks for one, and lists them', () => {
  // The defect this catches is a missing argument read as a word: the branch above names what it
  // was given, and with nothing given it names the absence rather than `undefined`.
  const ran = rigger();

  assert.notEqual(ran.code, 0);
  assert.doesNotMatch(ran.err, /undefined/);
  assert.deepEqual(helpVerbs(ran.err), usageVerbs(read('README.md'), manifest.name));
});

/**
 * A README shaped like Rigger's, listing verbs that are not Rigger's.
 *
 * The verbs here are invented precisely so that this is not a second copy of the real list: what
 * it proves is that the reader reports whatever the document says.
 *
 * Two invocations are named where the contract is not. `loose` sits in another section, as the
 * real README names `setup-board` in Prerequisites and `report` in Status, and `stray` sits in
 * this section but outside the command block. A reader scoped to the document takes the first,
 * and one scoped to the section takes the second, so the fixture holds the scope to the block.
 */
function readmeListing(verbs, comment = (verb) => `what ${verb} does`) {
  return [
    '## Prerequisites',
    '',
    'npx @williacj/rigger loose runs in another section, which is not the contract.',
    '',
    '## Install and usage',
    '',
    '> The commands below are the target interface.',
    '',
    'npx @williacj/rigger stray is named in a note beside the block, not in it.',
    '',
    '```bash',
    ...verbs.map((verb) => `npx @williacj/rigger ${verb}   # ${comment(verb)}`),
    '```',
    '',
    '## Configuration',
    '',
    'One config file names the repository.',
  ].join('\n');
}

test('the verbs are read out of the README, so a README listing others reports those', () => {
  // This is the item that decides the design: the check reads the block rather than holding a
  // copy of what it says. The defects it catches are a reader that answers with a list of its own
  // whatever it is given, and one whose scope is wider than the block, which would make a verb
  // named anywhere in the README part of the contract.
  assert.deepEqual(usageVerbs(readmeListing(['beta', 'alpha']), '@williacj/rigger'), ['beta', 'alpha']);
});

test('an invocation that carries an argument still names its verb', () => {
  // The defect this catches is a reader that takes a verb only when a comment or the line's end
  // follows it: a verb the README shows with a flag would then drop out of the contract, and a CLI
  // missing that verb would pass the verb-list check.
  const readme = readmeListing(['init', 'run --once'], () => 'y');
  assert.deepEqual(usageVerbs(readme, '@williacj/rigger'), ['init', 'run']);
});

test('changing a verb help text moves neither side of the check', () => {
  // The acceptance puts help text outside the match, and both sides carry some: the `#` comment
  // beside each invocation in the README, and the summary beside each verb in `--help`. The
  // defect this catches is either reader matching on the line rather than extracting the verb,
  // which would make a reworded description a build failure.
  const verbs = ['beta', 'alpha'];
  const rewritten = (verb) => `${verb} does something else entirely now`;
  assert.deepEqual(
    usageVerbs(readmeListing(verbs, rewritten), '@williacj/rigger'),
    usageVerbs(readmeListing(verbs), '@williacj/rigger'),
  );

  const summaries = VERBS.map(([verb]) => [verb, rewritten(verb)]);
  assert.deepEqual(helpVerbs(help(summaries)), usageVerbs(read('README.md'), manifest.name));
});
