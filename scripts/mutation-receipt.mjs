// ABOUTME: Runs one guarded mutation in a disposable worktree and reports the tests' evidence.

import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect, parseArgs } from 'node:util';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { runCommand } from '../src/substrate/process.mjs';

// Node copies Error getters before worker transport erases custom prototypes. A per-run key
// carries the original instanceof result; application codes, names and fields are not evidence.
const assertionKey = process.env.RIGGER_PROOF_ASSERTION_KEY;
if (assertionKey) Object.defineProperty(Error.prototype, assertionKey, {
  get() { return this instanceof AssertionError; }, configurable: true,
});

export const mutationUsage = 'usage: mutation:receipt --source <file> --anchor <text> --count <number> --replacement <text> --test <file> [--test-name-pattern <pattern>] [--timeout <seconds> (default: 60)]';

/** Git reads only the repository named by cwd, even when a hook launched the caller. */
export function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, env: gitEnvironment(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

export function refs() {
  const root = realpathSync.native(git(process.cwd(), 'rev-parse', '--show-toplevel').trim());
  const head = git(root, 'rev-parse', 'HEAD').trim();
  const base = git(root, 'merge-base', head, 'origin/main').trim();
  const manifests = [base, head].map((sha) => JSON.parse(git(root, 'show', `${sha}:package.json`)));
  const dependencyChanges = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((group) => {
    const [before, after] = manifests.map((manifest) => manifest[group] ?? {});
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((name) => before[name] !== after[name])
      .map((name) => ({ group, name, base: before[name] ?? null, head: after[name] ?? null }));
  });
  return { root, head, base, dependencyChanges };
}

/** Refuse an unresolved or escaping path rather than treating it as absent. */
export function inside(root, path) {
  const real = realpathSync.native(resolve(root, path));
  const name = relative(realpathSync.native(root), real);
  if (name === '..' || name.startsWith('../') || isAbsolute(name)) throw new Error(`path escapes worktree: ${path}`);
  return real;
}

/** Only the worktree and enclosing directory made by this call are removed. */
export async function withTree(context, sha, run) {
  const parent = realpathSync.native(tmpdir());
  if (parent === context.root || parent.startsWith(`${context.root}/`)) throw new Error('TMPDIR must be outside the checkout');
  const temporary = mkdtempSync(join(parent, 'rigger-proof-'));
  const tree = join(temporary, 'tree');
  try {
    git(context.root, 'worktree', 'add', '--quiet', '--detach', tree, sha);
    symlinkSync(realpathSync.native(join(context.root, 'node_modules')), join(tree, 'node_modules'), 'dir');
    return await run(tree, temporary);
  } finally {
    const registered = git(context.root, 'worktree', 'list', '--porcelain', '-z');
    if (registered.includes(`worktree ${tree}\0`)) git(context.root, 'worktree', 'remove', '--force', tree);
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Node's event stream preserves names and Error causes without parsing human TAP diagnostics. */
export default async function* reporter(events) {
  for await (const event of events) {
    if (event.data.details) {
      const failure = event.data.details.error;
      event.data.details.assertion = failure?.failureType === 'testCodeFailure'
        && failure.cause instanceof Error && failure.cause[assertionKey] === true;
    }
    yield `@@proof ${JSON.stringify(event, (key, value) => {
      if (key === 'cause' && !(value instanceof Error)) return { name: typeof value, message: inspect(value) };
      if (value instanceof Error) return {
        name: value.name, message: value.message, code: value.code, stack: value.stack,
        failureType: value.failureType, exitCode: value.exitCode, signal: value.signal,
        ...(Object.hasOwn(value, 'cause') ? { cause: value.cause } : {}), actual: inspect(value.actual), expected: inspect(value.expected),
      };
      return typeof value === 'bigint' ? String(value) : value;
    })}\n`;
  }
}

export async function runTests(tree, temporary, file, { timeout = 60, pattern } = {}) {
  const testFile = relative(tree, inside(tree, file));
  const listed = execFileSync('sh', ['test/suite.sh', '--list', 'host'], { cwd: tree, env: gitEnvironment(), encoding: 'utf8' });
  const host = listed.trim().split('\n').includes(testFile);
  const args = ['test/suite.sh', ...(host ? ['--host'] : []), `--import=${import.meta.url}`, `--test-reporter=${fileURLToPath(import.meta.url)}`,
    ...(pattern === undefined ? [] : [`--test-name-pattern=${pattern}`]), testFile];
  const runTmp = mkdtempSync(join(temporary, 'run-'));
  const { NODE_TEST_CONTEXT, ...env } = gitEnvironment();
  const events = [];
  const ran = await runCommand({ command: 'sh', args, cwd: tree,
    env: { ...env, TMPDIR: runTmp, RIGGER_PROOF_ASSERTION_KEY: randomUUID() }, timeout: timeout * 1000,
    directory: tree, scratch: runTmp, emitter: { emit: (...event) => events.push(event) },
  });
  const stdout = ran.stdout.toString('utf8');
  const stderr = ran.stderr.toString('utf8');
  const stream = stdout.split('\n').filter((line) => line.startsWith('@@proof ')).map((line) => JSON.parse(line.slice(8)));
  const registrations = new Map(stream.filter((event) => event.type === 'test:enqueue' && event.data.entryFile !== undefined)
    .map(({ data }) => [JSON.stringify([data.entryFile, data.testId]), data]));
  const identity = (test) => {
    if (typeof test.entryFile !== 'string' || !Number.isInteger(test.nesting) || test.nesting < 0) return;
    const path = [];
    let node = test;
    for (let depth = test.nesting; depth >= 0; depth -= 1) {
      if (!node || node.nesting !== depth || typeof node.file !== 'string' || !isAbsolute(node.file)
        || !Number.isInteger(node.line) || node.line <= 0 || !Number.isInteger(node.column) || node.column <= 0) return;
      const file = relative(tree, node.file);
      if (file === '..' || file.startsWith('../')) return;
      path.unshift([node.name, file, node.line, node.column]);
      node = registrations.get(JSON.stringify([node.entryFile, node.parentId]));
    }
    return [relative(tree, test.entryFile), path];
  };
  const registrationKeys = [...registrations.values()].map((test) => JSON.stringify(identity(test)));
  const identityReason = (test) => {
    const identified = identity(test);
    if (!identified) return 'unavailable source identity: missing file, position or ancestry';
    const [file, path] = identified;
    for (let length = 1; length <= path.length; length += 1) {
      const key = JSON.stringify([file, path.slice(0, length)]);
      if (registrationKeys.filter((candidate) => candidate === key).length > 1) return 'ambiguous registration identity';
    }
  };
  const tests = stream.filter((event) => ['test:pass', 'test:fail'].includes(event.type) && event.data.details?.type !== 'suite')
    .map((event) => ({ ...event.data, outcome: event.type === 'test:pass' ? 'pass' : 'fail',
      identity: identity(event.data), identityReason: identityReason(event.data),
    }));
  // Node's file-only verdict has no entryFile; an unmatched pattern can otherwise look green.
  return { ...ran, stdout, stderr, command: ['sh', ...args], count: tests.length,
    tests: tests.filter((test) => test.entryFile !== undefined), fileVerdicts: tests.filter((test) => test.entryFile === undefined), events };
}

export async function mutationReceipt(options) {
  const context = refs();
  const report = { tool: 'mutation:receipt', head: context.head, base: context.base,
    dependencyChanges: context.dependencyChanges,
    check4: 'Check 4, what the mutation did, is the maker\'s to state.', mutated: false, status: 'no verdict' };
  try {
    await withTree(context, context.head, async (tree, temporary) => {
      report.unmutated = await runTests(tree, temporary, options.test, options);
      const controlReason = noVerdict(report.unmutated);
      if (controlReason) { report.reason = `unmutated: ${controlReason}; nothing mutated`; return; }
      if (report.unmutated.exit !== 0 || failures(report.unmutated).length > 0) { report.reason = 'unmutated run failed; nothing mutated'; return; }
      const source = inside(tree, options.source);
      const original = readFileSync(source, 'utf8');
      report.anchor = { text: options.anchor, expected: Number(options.count), found: original.split(options.anchor).length - 1 };
      if (!options.anchor || !Number.isSafeInteger(report.anchor.expected) || report.anchor.expected <= 0 || report.anchor.found !== report.anchor.expected) {
        report.status = 'did not apply'; report.reason = 'anchor count differs or is invalid; nothing mutated'; return;
      }
      const changed = original.split(options.anchor).join(options.replacement);
      writeFileSync(source, changed);
      report.readBack = readFileSync(source, 'utf8');
      if (report.readBack !== changed) throw new Error('mutation readback differs');
      report.diff = git(tree, 'diff', '--', relative(tree, source));
      report.mutated = true;
      report.mutant = await runTests(tree, temporary, options.test, options);
      if (report.mutant.timedOut) { report.reason = 'mutant run exceeded its timeout'; return; }
      if (report.mutant.count < report.unmutated.count) { report.reason = 'mutant reported fewer tests'; return; }
      const mutantReason = noVerdict(report.mutant);
      if (mutantReason) { report.reason = `mutant: ${mutantReason}`; return; }
      report.failures = failures(report.mutant);
      report.status = report.failures.length === 0 ? 'survived' : 'killed';
    });
  } catch (error) { report.reason = error.message; }
  return { report, exit: ['killed', 'survived'].includes(report.status) ? 0 : 1 };
}

export function isAssertionFailure(test) {
  return test.details.assertion === true;
}

export function failures(run) {
  return run.tests.filter((test) => test.outcome === 'fail').map((test) => {
    const error = test.details.error.cause ?? test.details.error;
    return { name: test.name, error, kind: isAssertionFailure(test) ? 'assertion' : 'not an assertion' };
  });
}

/** A completed named assertion or application error differs from an interrupted or refused run. */
export function noVerdict(run) {
  if (run.timedOut) return 'run exceeded its timeout';
  if (run.fileVerdicts.length > 0) return 'file verdict; no named tests reached a verdict';
  if (run.tests.length === 0) return 'no named tests reached a verdict';
  if (run.tests.some((test) => test.skip !== undefined || test.todo !== undefined)) return 'skipped or todo named test';
  if (run.tests.some((test) => ['testAborted', 'cancelledByParent', 'testTimeoutFailure'].includes(test.details.error?.failureType))) return 'cancelled named test';
  const unavailable = run.tests.find((test) => test.outcome === 'fail' && !['testCodeFailure', 'subtestsFailed'].includes(test.details.error?.failureType));
  if (unavailable) {
    const failure = unavailable.details.error;
    return `non-test failure ${failure?.failureType ?? 'unknown'}: ${failure?.cause?.message ?? failure?.message}`;
  }
  if (run.exit !== 0 && failures(run).length === 0) return 'suite exited non-zero without a failing named test';
}

export function timeoutSeconds(value = '60') {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--timeout must be positive finite seconds');
  return seconds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['source', 'anchor', 'count', 'replacement', 'test', 'test-name-pattern', 'timeout'].map((name) => [name, { type: 'string' }]).concat([['help', { type: 'boolean' }]])) });
    if (values.help) console.log(mutationUsage);
    else {
      for (const name of ['source', 'anchor', 'count', 'replacement', 'test']) if (values[name] === undefined) throw new Error(`missing --${name}`);
      const result = await mutationReceipt({ ...values, pattern: values['test-name-pattern'], timeout: timeoutSeconds(values.timeout) });
      console.log(JSON.stringify(result.report, null, 2));
      process.exitCode = result.exit;
    }
  } catch (error) { console.error(`${error.message}\n${mutationUsage}`); process.exitCode = 2; }
}
