// ABOUTME: Checks the tests a change adds against the rules for added tests; its added-timer mode
// refuses an added conversion-list test whose run armed a real timer (D30 rule 6).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runnerRoutes, testsIn } from '../../scripts/build-test-matrix.mjs';
import { eventBase, gitFacts as listFacts } from './check-test-list-growth.mjs';

/** How many times each value occurs in a list. */
function counts(values) {
  const tally = new Map();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return tally;
}

/**
 * What a change adds to one file: each test whose title the head holds more times than the base
 * does (D30 rule 2), and each line holding an unidentified runner reference or a route to
 * `node:test` other than a static import, where the base holds no byte-identical line in that file.
 */
function additions(file, before, after) {
  const head = testsIn(after, file);
  const base = before === null ? { tests: [] } : testsIn(before, file);
  const baseTitles = counts(base.tests.map(({ title }) => title));
  const titles = [...counts(head.tests.map(({ title }) => title))]
    .filter(([title, count]) => count > (baseTitles.get(title) ?? 0)).map(([title]) => title);
  const baseLines = new Set(before === null ? [] : before.split(/\r\n|[\n\r\u2028\u2029]/));
  const calls = head.unidentified.filter(({ key }) => !baseLines.has(key));
  const routes = runnerRoutes(after, file).filter(({ key }) => !baseLines.has(key));
  return { titles, calls, routes };
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
 * What a change adds to each conversion-list file at its head that adds anything: the titles of
 * its added tests, its added unidentified runner references and routes to `node:test`, or the
 * reason its tests cannot be read.
 */
export function conversionAdditions({ base, head, facts }) {
  return facts.readLists(head).converting.flatMap((file) => {
    const after = facts.show(head, file);
    if (after === null) return [{ file, error: `on the conversion list at ${head} and not in that tree` }];
    let added;
    try { added = additions(file, facts.show(base, file), after); }
    catch (error) { return [{ file, error: `its tests cannot be read: ${error.message}` }]; }
    return added.titles.length || added.calls.length || added.routes.length ? [{ file, ...added }] : [];
  });
}

/**
 * The added-timer mode between a base and a head, given the record the head's `npm test` wrote.
 * It refuses, naming the file, an added test whose title the record arms under, an added
 * unidentified runner reference (T6) or route to `node:test` other than a static import (T14),
 * each by its line, and a file gaining a test the record never ran.
 */
export function addedTimers({ base, head, facts, record }) {
  const errors = [];
  for (const { file, error, titles = [], calls = [], routes = [] } of conversionAdditions({ base, head, facts })) {
    if (error) errors.push(`${file}: ${error}`);
    for (const { line, key } of calls) errors.push(`${file} line ${line}: added unidentified runner reference: ${key.trim()}`);
    for (const { line, key } of routes) errors.push(`${file} line ${line}: added route to node:test other than a static import: ${key.trim()}`);
    if (titles.length === 0) continue;
    if (!record.ran.has(file)) {
      errors.push(`${file}: tests were added and the timer record shows no run of the file`);
      continue;
    }
    for (const title of titles) {
      const armed = record.arms.filter((entry) => entry.file === file && entry.test === title);
      if (armed.length === 0) continue;
      const what = [...new Set(armed.map(({ api, delay }) => `${api} with delay ${delay}`))].join(', ');
      errors.push(`${file}: added test ${JSON.stringify(title)} armed ${what}`);
    }
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

/** The list-growth check's history reads, and a file's text at a commit, or null where it is absent. */
export function gitFacts(root = process.cwd()) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return {
    ...listFacts(root),
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
