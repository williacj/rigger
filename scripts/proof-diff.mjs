// ABOUTME: Compares each test's outcome at the merge base and committed head in disposable worktrees.

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { git, isAssertionFailure, noVerdict, refs, runTests, timeoutSeconds, withTree } from './mutation-receipt.mjs';

export const proofUsage = 'usage: proof:diff <test-file> [--timeout <seconds> (default: 60)]';

export async function proofDiff(options) {
  const context = refs();
  const report = { tool: 'proof:diff', head: context.head, base: context.base, dependencyChanges: context.dependencyChanges, runs: {} };
  for (const side of ['base', 'head']) {
    try {
      report.runs[side] = await withTree(context, context[side], async (tree, temporary) => {
        if (side === 'base') git(tree, 'restore', '--source', context.head, '--staged', '--worktree', '--', 'test/');
        return runTests(tree, temporary, options.test, options);
      });
    } catch (error) { report.runs[side] = { error: error.message, tests: [], fileVerdicts: [], count: 0, exit: 1 }; }
    const run = report.runs[side];
    run.reason = run.error ?? noVerdict(run);
    run.status = run.reason ? 'no verdict' : run.exit === 0 ? 'pass' : 'fail';
  }
  report.tests = report.runs.head.tests.map((test) => {
    const sameIdentity = (candidate) => JSON.stringify(candidate.identity) === JSON.stringify(test.identity);
    const matches = report.runs.base.tests.filter(sameIdentity);
    const ambiguous = matches.length > 1 || report.runs.head.tests.filter(sameIdentity).length > 1;
    const baseTest = matches[0];
    const baseReason = report.runs.base.reason ?? test.identityReason ?? baseTest?.identityReason ?? (ambiguous ? 'ambiguous test identity at the base or head' : baseNoVerdict(baseTest));
    const base = baseReason ? 'no verdict' : baseTest?.outcome ?? 'no verdict';
    const head = report.runs.head.reason ? 'no verdict' : test.outcome;
    return { name: test.name, identity: test.identity, base, head, baseReason,
      status: head === 'no verdict' ? 'no verdict at the head' : head === 'fail' ? 'fails at the head' : base === 'no verdict' ? 'no verdict at the base' : base === 'pass' ? 'passes at the base: proves nothing new' : 'proves' };
  });
  return { report, exit: report.runs.head.reason || report.runs.head.exit !== 0 ? 1 : 0 };
}

/** Only a named assertion failure supplies a red base; all other failures retain their cause. */
function baseNoVerdict(test) {
  if (!test) return 'named test did not report a result at the base';
  if (test.skip !== undefined || test.todo !== undefined) return 'skipped or todo named test';
  if (test.outcome === 'pass') return;
  const failure = test.details.error;
  const cause = failure?.cause ?? failure;
  if (isAssertionFailure(test)) return;
  return `${failure?.failureType ?? 'unknown runner failure'}: ${cause?.name ?? 'Error'} ${cause?.code ?? ''}: ${cause?.message ?? String(cause)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true,
      options: { help: { type: 'boolean' }, timeout: { type: 'string' } } });
    if (values.help) console.log(proofUsage);
    else {
      if (positionals.length !== 1) throw new Error('name exactly one test file');
      const result = await proofDiff({ test: positionals[0], timeout: timeoutSeconds(values.timeout) });
      console.log(JSON.stringify(result.report, null, 2));
      process.exitCode = result.exit;
    }
  } catch (error) { console.error(`${error.message}\n${proofUsage}`); process.exitCode = 2; }
}
