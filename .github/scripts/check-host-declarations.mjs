// ABOUTME: Checks the tests a change adds against the rules for added tests; its added-timer mode
// refuses an added conversion-list test whose run armed a real timer (D30 rule 6).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { eventBase, gitFacts as listFacts } from './check-test-list-growth.mjs';

/**
 * The lister: a `node --test` reporter naming, one JSON line each, every test the run reports at
 * nesting 0, which is every top-level test the file registers, and the run's duration from its
 * last summary. It never filters on `data.file`: a test registered through a helper reports the
 * helper's file, and one registered through the runner's mock reports the mock's.
 */
export default async function* lister(source) {
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && data.nesting === 0) yield JSON.stringify({ title: data.name }) + '\n';
    else if (type === 'test:summary' && data.file === undefined) yield JSON.stringify({ duration_ms: data.duration_ms }) + '\n';
  }
}

/** How many times each value occurs in a list. */
function counts(values) {
  const tally = new Map();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return tally;
}

/**
 * A lister run's output for one file: how many top-level tests it registered under each title,
 * and the run's duration, or the reason the run gives no titles. node:test reports a file that
 * throws while loading, or registers no test, as a test named by the path it was given.
 */
export function listing(output, file) {
  const entries = output.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  const titles = entries.filter((entry) => Object.hasOwn(entry, 'title')).map(({ title }) => title);
  const summary = entries.find((entry) => Object.hasOwn(entry, 'duration_ms'));
  if (titles.includes(file)) return { error: 'fails to load the file or registers no test' };
  if (!summary) return { error: 'ended before the runner reported its summary' };
  return { counts: counts(titles), duration_ms: summary.duration_ms };
}

/** The timer record's lines, from the text of its worker files: the files that ran, and each arm. */
export function parseRecord(text, name = 'record') {
  const ran = new Set();
  const arms = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    let entry;
    try { entry = JSON.parse(line); }
    catch (error) { throw new Error(`timer record ${name} line ${index + 1} is not JSON: ${error.message}`); }
    if (!entry || typeof entry.file !== 'string' || !['file', 'test', 'api', 'delay'].every((key) => Object.hasOwn(entry, key))) {
      throw new Error(`timer record ${name} line ${index + 1} lacks the file, test, api and delay keys`);
    }
    if (entry.api === null) ran.add(entry.file);
    else arms.push({ file: entry.file, test: entry.test, api: entry.api, delay: entry.delay });
  });
  return { ran, arms };
}

/** Every worker file's lines in a record directory; a directory that is not there holds none. */
export function readRecord(directory) {
  let names;
  try { names = readdirSync(directory).filter((name) => name.endsWith('.jsonl')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return { ran: new Set(), arms: [] }; throw error; }
  const record = { ran: new Set(), arms: [] };
  for (const name of names) {
    const part = parseRecord(readFileSync(join(directory, name), 'utf8'), name);
    for (const file of part.ran) record.ran.add(file);
    record.arms.push(...part.arms);
  }
  return record;
}

/**
 * The conversion-list files at the head whose text the change modifies, a file new at the head
 * included, or the reason a listed file cannot be read.
 */
export function modifiedConversionFiles({ base, head, facts }) {
  return facts.readLists(head).converting.flatMap((file) => {
    const after = facts.show(head, file);
    if (after === null) return [{ file, error: `on the conversion list at ${head} and not in that tree` }];
    const before = facts.show(base, file);
    return before === after ? [] : [{ file, atBase: before !== null }];
  });
}

/**
 * The added-timer mode between a base and a head, given the record the head's `npm test` wrote
 * (D30 rule 6). Each modified conversion-list file F is run under the lister at the head and, in
 * one worktree at the base, at the base. An arm recorded from F under title X is refused where
 * head(X) > base(X): base(X) is the base run's count of X, and head(X) the larger of the head
 * run's count and 1, since the arm proves the job's run registered X. A file whose run gives no
 * titles, and a file gaining a test the record never ran, are refused naming the file.
 */
export function addedTimers({ base, head, facts, record }) {
  const files = modifiedConversionFiles({ base, head, facts });
  if (files.length === 0) return { ok: true, errors: [] };
  const runnable = files.filter(({ error }) => !error);
  const heads = new Map(runnable.map(({ file }) => [file, facts.list(facts.root, file)]));
  const bases = facts.atBase(base, (directory) => new Map(runnable
    .map(({ file, atBase }) => [file, atBase ? facts.list(directory, file) : { counts: new Map() }])));
  const errors = [];
  for (const { file, error } of files) {
    if (error) { errors.push(`${file}: ${error}`); continue; }
    const after = heads.get(file);
    const before = bases.get(file);
    if (after.error) errors.push(`${file}: the head run ${after.error}`);
    if (before.error) errors.push(`${file}: the base run ${before.error}`);
    if (after.error || before.error) continue;
    const baseCount = (title) => before.counts.get(title) ?? 0;
    const added = [...after.counts].some(([title, count]) => count > baseCount(title));
    if (added && !record.ran.has(file)) {
      errors.push(`${file}: tests were added and the timer record shows no run of the file`);
      continue;
    }
    const armed = new Map();
    for (const entry of record.arms) {
      if (entry.file !== file || entry.test === null) continue;
      if (Math.max(after.counts.get(entry.test) ?? 0, 1) <= baseCount(entry.test)) continue;
      armed.set(entry.test, [...(armed.get(entry.test) ?? []), `${entry.api} with delay ${entry.delay}`]);
    }
    for (const [title, arms] of armed) errors.push(`${file}: added test ${JSON.stringify(title)} armed ${[...new Set(arms)].join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The added-timer mode for a CI event: the head against its merge base with the commit the
 * list-growth check resolves for the event (D29 rule 11's base).
 */
export function checkAddedTimers(context, facts, record) {
  try {
    const resolved = eventBase(context, facts);
    if (resolved.error) return { ok: false, errors: [resolved.error] };
    const base = facts.mergeBase(context.sha, resolved.base);
    if (!base) return { ok: false, errors: [`head ${context.sha} has no merge base with ${resolved.base}`] };
    return addedTimers({ base, head: context.sha, facts, record });
  } catch (error) { return { ok: false, errors: [error.message] }; }
}

// How long one lister run of one file may take: four times the slowest base run measured. CI run
// 42895935883 (job 130109118574, ubuntu-latest, Node v26.13.0) ran every conversion-list file at
// merge base cd181d6f under the lister; the slowest was test/loop.test.mjs, at 149012 ms. The
// multiple of four is a judgment, leaving room for a slower runner and for the file's growth.
export const BASE_RUN_BOUND_MS = 4 * 149_012;

/**
 * A lister run of one file in `directory`: a full `node --test` run of it, with no skip, name or
 * only pattern, since the runner reports nothing for a test such a pattern filters out. It runs
 * under the environment of this process less Git's, the runner's own context and the timer
 * record, so it neither writes the record nor reports into a runner that started this check.
 */
export function listTitles(directory, file, bound) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('GIT_') && key !== 'NODE_TEST_CONTEXT' && key !== 'RIGGER_SUITE_TIMER_RECORD'));
  const ran = spawnSync(process.execPath, ['--test', `--test-reporter=${import.meta.url}`, '--test-reporter-destination=stdout', file], {
    cwd: directory, env, encoding: 'utf8', timeout: bound, maxBuffer: 64 * 1024 * 1024,
  });
  if (ran.error?.code === 'ETIMEDOUT') return { error: `ran past its bound of ${bound} ms` };
  if (ran.error) return { error: `could not run: ${ran.error.message}` };
  return listing(ran.stdout, file);
}

/**
 * The list-growth check's history reads, a file's text at a commit, or null where it is absent,
 * and the lister runs: at the head in `root`, and at a base in a worktree `atBase` makes.
 */
export function gitFacts(root = process.cwd(), { bound = BASE_RUN_BOUND_MS } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return {
    ...listFacts(root),
    root,
    show(sha, path) {
      if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('invalid commit ' + sha);
      const listed = execFileSync('git', ['ls-tree', '-z', sha, '--', path], {
        cwd: root, env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
      });
      if (listed === '') return null;
      return execFileSync('git', ['show', `${sha}:${path}`], {
        cwd: root, env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
      });
    },
    /**
     * Runs `use` in a detached worktree at `sha`, made under a temporary directory and linked to
     * the head checkout's `node_modules`, then removes it, `git worktree remove --force` then
     * `git worktree prune`, however `use` ends.
     */
    atBase(sha, use) {
      const git = (...args) => execFileSync('git', args, { cwd: root, env, timeout: 120_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const holder = mkdtempSync(join(tmpdir(), 'rigger-base-run-'));
      const directory = join(holder, 'base');
      try {
        git('worktree', 'add', '--detach', '--quiet', directory, sha);
        symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
        return use(directory);
      } finally {
        try { git('worktree', 'remove', '--force', directory); }
        finally {
          rmSync(holder, { recursive: true, force: true });
          git('worktree', 'prune');
        }
      }
    },
    list: (directory, file) => listTitles(directory, file, bound),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== '--added-timer') throw new Error('usage: check-host-declarations.mjs --added-timer');
    if (!process.env.RIGGER_SUITE_TIMER_RECORD) throw new Error('RIGGER_SUITE_TIMER_RECORD names no record directory');
    const result = checkAddedTimers({
      eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    }, gitFacts(), readRecord(process.env.RIGGER_SUITE_TIMER_RECORD));
    for (const error of result.errors) console.error(error);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error('added-timer check failed: ' + error.message); process.exitCode = 1; }
}
