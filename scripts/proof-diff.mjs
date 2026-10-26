// ABOUTME: Compares each test's outcome at the merge base and committed head in disposable worktrees.

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { git, noVerdict, refs, runTests, timeoutSeconds, withTree } from './mutation-receipt.mjs';

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
  const seen = new Map();
  report.tests = report.runs.head.tests.map((test) => {
    const occurrence = seen.get(test.name) ?? 0;
    seen.set(test.name, occurrence + 1);
    const base = report.runs.base.reason ? 'no verdict' : report.runs.base.tests.filter((candidate) => candidate.name === test.name)[occurrence]?.outcome ?? 'no verdict';
    const head = report.runs.head.reason ? 'no verdict' : test.outcome;
    return { name: test.name, occurrence: occurrence + 1, base, head,
      status: head === 'no verdict' ? 'no verdict at the head' : head === 'fail' ? 'fails at the head' : base === 'no verdict' ? 'no verdict at the base' : base === 'pass' ? 'passes at the base: proves nothing new' : 'proves' };
  });
  return { report, exit: report.runs.head.reason || report.runs.head.exit !== 0 ? 1 : 0 };
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
