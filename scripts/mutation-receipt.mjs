// ABOUTME: Runs one guarded mutation in a disposable worktree and reports the tests' evidence.

import { AssertionError } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
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
  let failure;
  try {
    git(context.root, 'worktree', 'add', '--quiet', '--detach', tree, sha);
    symlinkSync(realpathSync.native(join(context.root, 'node_modules')), join(tree, 'node_modules'), 'dir');
    return await run(tree, temporary);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      const registered = git(context.root, 'worktree', 'list', '--porcelain', '-z');
      if (registered.includes(`worktree ${tree}\0`)) git(context.root, 'worktree', 'remove', '--force', tree);
      rmSync(temporary, { recursive: true, force: true });
    } catch (cleanup) {
      if (failure) throw new AggregateError([failure, cleanup], `${failure.message}; cleanup: ${cleanup.message}`, { cause: failure });
      throw cleanup;
    }
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
  return { ...ran, stdout, stderr, command: ['sh', ...args], ...parseEvents(stream, tree, testFile), events };
}

/**
 * Node's reporter events from one file's run, parsed into its named tests and the file's own verdicts.
 *
 * Node v26.12.1 marks a named test's events with an entryFile and leaves the file's own unmarked;
 * Node v26.5.0 marks none, and its file event shares testId, parentId, nesting and file with the
 * first test. So the file's own verdict is the unmarked event Node names for the file operand and
 * places at its line 1, column 1, and a test titled after its file is still a named test.
 */
export function parseEvents(stream, tree, testFile) {
  const fileVerdict = (data) => data.entryFile === undefined && data.name === testFile && data.line === 1 && data.column === 1
    && typeof data.file === 'string' && relative(tree, data.file) === testFile;
  // One file runs, so an unmarked named test ran from the operand.
  const entry = (data) => data.entryFile ?? join(tree, testFile);
  const registrations = new Map(stream.filter((event) => event.type === 'test:enqueue' && !fileVerdict(event.data))
    .map(({ data }) => [JSON.stringify([entry(data), data.testId]), data]));
  const identity = (test) => {
    if (typeof entry(test) !== 'string' || !Number.isInteger(test.nesting) || test.nesting < 0) return;
    const path = [];
    let node = test;
    for (let depth = test.nesting; depth >= 0; depth -= 1) {
      if (!node || node.nesting !== depth || typeof node.file !== 'string' || !isAbsolute(node.file)
        || !Number.isInteger(node.line) || node.line <= 0 || !Number.isInteger(node.column) || node.column <= 0) return;
      const file = relative(tree, node.file);
      if (file === '..' || file.startsWith('../')) return;
      path.unshift([node.name, file, node.line, node.column]);
      node = registrations.get(JSON.stringify([entry(node), node.parentId]));
    }
    return [relative(tree, entry(test)), path];
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
  // An unmatched pattern leaves only the file's verdict, which can otherwise look green.
  return { count: tests.length, tests: tests.filter((test) => !fileVerdict(test)), fileVerdicts: tests.filter(fileVerdict) };
}

/** Writes the captured original content back to its source path. */
export function restoreSource(source, original) {
  writeFileSync(source, original);
  if (!readFileSync(source).equals(Buffer.from(original))) throw new Error('restored source bytes differ from original');
}

/** Classifies a completed mutant from its named failure evidence. */
export function mutationVerdict(report) {
  if (report.mutated && report.reason !== undefined) return { status: 'no verdict', reason: report.reason };
  if (!report.restored) return { status: 'no verdict', reason: 'restored run unavailable' };
  const restoredReason = noVerdict(report.restored);
  if (restoredReason) return { status: 'no verdict', reason: `restored: ${restoredReason}` };
  if (report.restored && failures(report.restored).length > 0) return { status: 'no verdict', reason: 'restored named tests failed' };
  const originalReason = noVerdict(report.unmutated);
  if (originalReason || report.unmutated.exit !== 0 || failures(report.unmutated).length > 0) {
    return { status: 'no verdict', reason: `original selected run unavailable: ${originalReason ?? 'not green'}` };
  }
  const identities = [];
  for (const [phase, run] of [['original', report.unmutated], ['restored', report.restored]]) {
    const unavailable = run.tests.find((test) => !test.identity || test.identityReason);
    if (unavailable) return { status: 'no verdict', reason: `${phase} selected identity unavailable: ${unavailable.identityReason ?? 'missing identity'}` };
    const keys = run.tests.map((test) => JSON.stringify(test.identity));
    if (new Set(keys).size !== keys.length) return { status: 'no verdict', reason: `${phase} selected identity is duplicated` };
    identities.push(keys.sort());
  }
  if (JSON.stringify(identities[0]) !== JSON.stringify(identities[1])) return { status: 'no verdict', reason: 'restored selected identities differ from original' };
  return { status: failures(report.mutant).length === 0 ? 'survived' : 'killed' };
}

export async function mutationReceipt(options) {
  const context = refs();
  return mutationReceiptAt(context, options);
}

/** Runs the actual mutation lifecycle with a selected-suite producer. */
export async function mutationReceiptAt(context, options, selected = runTests) {
  const report = { tool: 'mutation:receipt', head: context.head, base: context.base,
    dependencyChanges: context.dependencyChanges,
    check4: 'Check 4, what the mutation did, is the maker\'s to state.', mutated: false, status: 'no verdict' };
  try {
    await withTree(context, context.head, async (tree, temporary) => {
      report.unmutated = await selected(tree, temporary, options.test, options);
      const controlReason = noVerdict(report.unmutated);
      if (controlReason) { report.reason = `unmutated: ${controlReason}; nothing mutated`; return; }
      if (report.unmutated.exit !== 0 || failures(report.unmutated).length > 0) { report.reason = 'unmutated run failed; nothing mutated'; return; }
      const source = inside(tree, options.source);
      const preimage = readFileSync(source);
      const original = preimage.toString('utf8');
      report.anchor = { text: options.anchor, expected: Number(options.count), found: original.split(options.anchor).length - 1 };
      if (!options.anchor || !Number.isSafeInteger(report.anchor.expected) || report.anchor.expected <= 0 || report.anchor.found !== report.anchor.expected) {
        report.status = 'did not apply'; report.reason = 'anchor count differs or is invalid; nothing mutated'; return;
      }
      const changed = original.split(options.anchor).join(options.replacement);
      report.restoration = { preimageHash: createHash('sha256').update(preimage).digest('hex') };
      let mutationFailure;
      try {
        writeFileSync(source, changed);
        report.readBack = readFileSync(source, 'utf8');
        if (report.readBack !== changed) throw new Error('mutation readback differs');
        report.diff = git(tree, 'diff', '--', relative(tree, source));
        report.mutated = true;
        report.mutant = await selected(tree, temporary, options.test, options);
        if (report.mutant.timedOut) { report.reason = 'mutant run exceeded its timeout'; return; }
        if (report.mutant.count < report.unmutated.count) { report.reason = 'mutant reported fewer tests'; return; }
        const mutantReason = noVerdict(report.mutant);
        if (mutantReason) { report.reason = `mutant: ${mutantReason}`; return; }
        report.failures = failures(report.mutant);
      } catch (error) {
        mutationFailure = error;
        throw error;
      } finally {
        try {
          restoreSource(source, preimage);
          report.restoration.beforeRunHash = createHash('sha256').update(readFileSync(source)).digest('hex');
          if (report.restoration.beforeRunHash !== report.restoration.preimageHash) throw new Error('restored source hash differs before selected run');
          report.restored = await selected(tree, temporary, options.test, options);
          report.restoration.afterRunHash = createHash('sha256').update(readFileSync(source)).digest('hex');
          report.restoration.status = git(tree, 'status', '--porcelain', '--', relative(tree, source));
          if (report.restoration.afterRunHash !== report.restoration.preimageHash) throw new Error('restored source changed after selected run');
          if (report.restoration.status !== '') throw new Error('restored source status is dirty');
        } catch (restoration) {
          if (mutationFailure) throw new AggregateError([mutationFailure, restoration], `${mutationFailure.message}; restoration: ${restoration.message}`, { cause: mutationFailure });
          throw restoration;
        }
      }
    });
  } catch (error) { report.reason = [report.reason, error.message].filter((reason) => reason !== undefined).join('; '); }
  if (report.mutated) Object.assign(report, mutationVerdict(report));
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
