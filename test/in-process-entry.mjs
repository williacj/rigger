// ABOUTME: Shares the admitted plan fixtures and callable entry setup between boundary and decision tests.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import template from '../templates/rigger.config.mjs';
import { plan as planVerb } from '../src/cli/plan.mjs';
import { PACKAGE, real } from '../src/cli/doctor.mjs';
import { answerFakeGh, seedRepositoryAt } from './fake-gh.mjs';
import { fixedCommand } from './in-process-fixtures.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { admissionOf, closerText, seed } from './admission-world.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
export const REPO = 'acme/widgets';
export const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
export const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
export const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
export const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board: an issue in its repository, selected by the `change` kind. */
export const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** The lines of a plan naming a card it would pull, in the order printed. */
export const pullLines = (text) => text.split('\n').filter((line) => /^\s*pull\s+#\d+/.test(line));

/** The numbers of the cards a plan would pull, in the order printed. */
export const pulled = (text) => pullLines(text).map((line) => Number(line.match(/#(\d+)/)[1]));

/** The line of a plan refusing card `number`, or undefined. */
export const refusalOf = (text, number) => text.split('\n').find((line) => new RegExp(`^\\s*refuse\\s+#${number}\\b`).test(line));

/** The consumer's config, as `plan` above writes it. */
export const CONSUMER = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };


/** The head SHA and merge base of the pull request the judge tests below seed, each written by hand. */
export const JUDGED_HEAD = '6'.repeat(40);
export const JUDGED_BASE = '7'.repeat(40);

/** Card `number`'s one open pull request from its line of work, numbered `100 + number`. */
export const openFor = (number) => ({ number: 100 + number, head: `rigger-${number}`, sha: JUDGED_HEAD, diff: 'diff --git a/x b/x\n', mergeBase: JUDGED_BASE });

/** A board where the next run would pull a Ready card and move a Review card whose pull request merged. */
export const PULLING = { items: [card(31, 'Ready'), card(32, 'Review')] };
export const PULLING_HELD = { pullRequests: [{ ...openFor(32), merged: true }] };

/** Each entry admission's module cannot read, with the cause it names, seeded by hand. */
export const UNREADABLE = [
  { name: 'stray.json', cause: 'no closer form', make: (state) => seed(state, 'stray.json', closerText()) },
  { name: 'owner-c3.json', cause: 'no reason, time or run', make: (state) => seed(state, 'owner-c3.json', JSON.stringify({ reason: 'r', run: 'x' })) },
  { name: 'owner-d4.json', cause: 'not a regular file', make: (state) => mkdirSync(join(admissionOf(state), 'owner-d4.json'), { recursive: true }) },
];

/** A prepared callable consumer and forge, ready for explicit admission filesystem inputs. */
export function planWorld(board, { held, source = `export default ${JSON.stringify(CONSUMER)};\n` } = {}) {
  const consumer = repositoryIn('rigger-plan-entry-', { 'rigger.config.mjs': source });
  const directory = temporaryDirectory('rigger-plan-entry-forge-');
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: REPO, project: PROJECT, model: { columns: COLUMNS, fields: FIELDS, ...board }, writes: [], sent: [],
  }));
  if (held) seedRepositoryAt(statePath, held);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).sent, [], 'the explicit forge seed precedes any request');
  const actualRoot = gitIn(consumer, 'rev-parse', '--show-toplevel');
  const rootAnswer = fixedCommand({ stdout: actualRoot });
  const ask = (file, args) => {
    assert.equal(file, 'git');
    assert.deepEqual(args, ['-C', consumer, 'rev-parse', '--show-toplevel']);
    return rootAnswer.run(args);
  };
  const send = (file, args) => {
    assert.equal(file, 'gh');
    return answerFakeGh(statePath, args);
  };
  const state = join(consumer, '.rigger');
  return {
    consumer, state, unread: admissionOf(join(real(consumer), '.rigger')),
    run: () => planVerb({ target: consumer, packageRoot: PACKAGE, ask, send }),
  };
}

/** The same callable plan fixture with no admission setup between preparation and invocation. */
export const planInProcess = (board) => planWorld(board).run();

export const lines = (...rows) => rows.join('\n');
// What every fixture source below opens with, because a call to `test` reaches the runner only
// where the file imported it: `node --test` installs no global, so a source without this line
// registers nothing whatever it calls. The scan reads that off the source rather than finding
// out at run time, which is why the fixtures carry it rather than the harness adding it.
export const IMPORT = "import { test } from 'node:test';";

/** A fixture repository holding the files a run reads, and nothing else. */
export function matrixFixture(files) {
  const dir = temporaryDirectory('rigger-matrix-');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** A register of requirements, written the way `docs/spec/requirements.md` writes one. */
export const registerOf = (...rows) => lines(
  'ABOUTME: a fixture register.',
  '',
  '## R-ONE — a group',
  '',
  '| id | requirement | made true by | checked by | from |',
  '|---|---|---|---|---|',
  ...rows.map(([id, checkedBy]) => `| ${id} | a thing | the engine | ${checkedBy} | |`),
  '',
);

/** A register of withdrawn requirements, written the way `requirements-retired.md` writes one. */
export const retiredOf = (...ids) => lines(
  'ABOUTME: a fixture register of withdrawn requirements.',
  '',
  '| id | requirement | from | withdrawn | replaced by |',
  '|---|---|---|---|---|',
  ...ids.map((id) => `| ${id} | a thing | | 2026-01-01 | |`),
  '',
);

/** A test file carrying one declaration and the test it speaks for. */
export const proving = (declaration, title) =>
  `${IMPORT}\n${declaration}\ntest('${title}', () => {});\n`;

/** A fixture repository with two requirements, one of them proved by a test. */
export const matrixRepository = () => matrixFixture({
  'docs/spec/requirements.md': registerOf(['R-ONE-1', 'the test suite'], ['R-ONE-2', 'the gate']),
  'docs/spec/requirements-retired.md': retiredOf(),
  'test/first.test.mjs': proving('// proves R-ONE-1', 'the first thing holds'),
});

