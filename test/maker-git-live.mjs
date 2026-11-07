// ABOUTME: Builds a consumer with shipped provider settings and a local bare origin, then runs
// a real maker through L1 to measure committing, pushing and Codex git-metadata denials.

import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { bareCloneInto, gitIn, repositoryAt, worktreeAt } from './git-repository.mjs';
import { pastRefusing, put } from './claude-live.mjs';
import { stubGh } from './stub-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

export const MAKER_SESSION = 600_000;
export const COMMIT_MESSAGE = 'Deliver card 1230 fixture';
export const DELIVERED = 'ABOUTME: The live maker delivery fixture.\ncommitted by the maker\n';

/** The git calls are literal argv, with child exits and streams retained separately. */
function codexProgram(common) {
  return [
    '// ABOUTME: Runs the live maker git operations and records each child result and denied write.',
    "const { spawnSync } = require('node:child_process');",
    "const { appendFileSync, writeFileSync } = require('node:fs');",
    `const common = ${JSON.stringify(common)};`,
    'const report = { commands: [], denied: [] };',
    'function git(args) {',
    "  const result = spawnSync('git', args, { encoding: 'utf8' });",
    '  const held = { args, exit: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };',
    '  report.commands.push(held);',
    '  return held;',
    '}',
    "const added = git(['add', 'delivery.txt']);",
    `const committed = git(['commit', '-m', ${JSON.stringify(COMMIT_MESSAGE)}]);`,
    'if (committed?.exit === 0) {',
    "  git(['push', 'origin', 'HEAD:refs/heads/main']);",
    "  git(['push', 'origin', 'rigger-42']);",
    '}',
    "for (const file of ['hooks/c1230-denied', 'config']) {",
    '  try {',
    "    appendFileSync(`${common}/${file}`, '\\n# c1230 forbidden write\\n');",
    '    report.denied.push({ file, denied: false });',
    '  } catch (failure) { report.denied.push({ file, denied: true, code: failure.code }); }',
    '}',
    "writeFileSync('.c1230-result.json', JSON.stringify(report, null, 2));",
    'console.log(JSON.stringify(report, null, 2));',
    '',
  ].join('\n');
}

/** One isolated consumer; its hook, provider declaration and credential home are set before dispatch. */
export async function liveMaker(t, provider) {
  const base = realpathSync.native(temporaryDirectory(`rigger-${provider}-maker-live-`, { context: t }));
  const repository = join(base, 'repository');
  mkdirSync(repository);
  cpSync(new URL('../templates/claude/', import.meta.url), join(repository, '.claude'), { recursive: true });
  put(repository, '.codex/config.toml', readFileSync(new URL('../templates/codex/config.toml', import.meta.url)));
  put(repository, '.claude/agents/maker.md', '---\n# ABOUTME: Runs only the live fixture delivery commands.\nname: maker\ndescription: Delivers the fixture.\n---\n\nFollow the prompt exactly. Do not change configuration, request broader permissions, bypass hooks or improvise a fallback.\n');
  put(repository, '.githooks/pre-push', readFileSync(new URL('../templates/githooks/pre-push', import.meta.url)));
  chmodSync(join(repository, '.githooks', 'pre-push'), 0o755);
  put(repository, '.gitignore', '.c1230-*\n');
  put(repository, 'delivery.txt', 'ABOUTME: The live maker delivery fixture.\ninitial\n');
  repositoryAt(repository);
  gitIn(repository, 'add', '-A');
  gitIn(repository, 'commit', '-qm', 'consumer fixture');
  gitIn(repository, 'branch', '-M', 'main');
  const directory = worktreeAt(repository, join(base, 'rigger-42'), 'rigger-42');
  const common = join(repository, '.git');
  gitIn(repository, 'config', 'core.hooksPath', '.githooks');
  writeFileSync(join(directory, 'delivery.txt'), DELIVERED);
  put(directory, '.c1230-probe.cjs', codexProgram(common));
  // These writes establish that the existing metadata is writable outside the provider sandbox.
  put(common, 'hooks/c1230-denied', '# fixture readiness\n');
  rmSync(join(common, 'hooks', 'c1230-denied'));
  rmSync(join(common, 'logs'), { recursive: true });
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-maker-live', now: Date.now });
  const id = 'd-maker-live';
  const home = join(base, 'claude-home');
  mkdirSync(home);
  // Claude Code 2.1.319 runs `gh pr view --json url` itself after a successful push, and reads a
  // non-zero exit as no pull request. The owner's run met that call with the suite's refusal, which
  // exits 1 and left the session at exit 0, so this stand-in answers as that run observed (#276).
  const forge = provider === 'claude' ? stubGh({ status: 1, stderr: 'no pull requests found\n' }) : undefined;
  const inherited = process.env.PATH;
  process.env.PATH = pastRefusing();
  t.after(() => { process.env.PATH = inherited; });
  const prompt = provider === 'codex'
    ? 'Run exactly this shell command once: node .c1230-probe.cjs\nReport its output. Do not retry a failed git operation or use any other command.\n'
    : `Run these three Bash commands, one per tool call, stopping on any failure: git add delivery.txt; git commit -m '${COMMIT_MESSAGE}'; git push origin rigger-42. Do not combine commands, change settings or run any other tool.\n`;
  const handed = await roleDispatch({ answer: { role: 'maker', provider, agent: '.claude/agents/maker.md', tier: 'standard', instruction: prompt, evidence: '', timeout: MAKER_SESSION },
    cwd: directory, directory, repository, scratch: join(base, 'scratch', 'rigger-42'), maker: true, reach: [],
    env: { ...process.env, PATH: forge?.first(pastRefusing()) ?? pastRefusing(), CLAUDE_CONFIG_DIR: home }, sink, id, card: 42 });
  const origin = join(handed.env.TMPDIR ?? handed.scratch, 'origin.git');
  bareCloneInto(repository, origin);
  gitIn(repository, 'remote', 'add', 'origin', origin);
  gitIn(repository, 'fetch', 'origin');
  gitIn(repository, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  rmSync(join(common, 'logs'), { recursive: true, force: true });
  const configuration = readFileSync(join(common, 'config'));
  const main = gitIn(origin, 'rev-parse', 'refs/heads/main').trim();
  assert.equal(existsSync(join(common, 'logs')), false, 'common logs must be absent before the live dispatch');
  assert.equal(gitIn(directory, 'config', '--get', 'core.hooksPath').trim(), '.githooks');
  assert.deepEqual(readFileSync(join(directory, '.githooks', 'pre-push')), readFileSync(new URL('../templates/githooks/pre-push', import.meta.url)));

  const result = await dispatch({ id, card: 42, directory: state, sink, ...handed });
  const evidenceRoot = process.env.RIGGER_1230_EVIDENCE_ROOT ?? join(dirname(realpathSync.native(process.env.TMPDIR)), '1230-live-evidence');
  const artifacts = join(evidenceRoot, `${provider}-${randomUUID()}`);
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  writeFileSync(join(artifacts, 'stdout'), result.stdout, { mode: 0o600 });
  writeFileSync(join(artifacts, 'stderr'), result.stderr, { mode: 0o600 });
  writeFileSync(join(artifacts, 'invocation.json'), JSON.stringify({ command: handed.command, args: handed.args, input: handed.input.toString('utf8'), exit: result.exit, timedOut: result.timedOut }, null, 2), { mode: 0o600 });
  cpSync(join(directory, '.c1230-probe.cjs'), join(artifacts, 'probe.cjs'));
  if (handed.env.CODEX_HOME && existsSync(join(handed.env.CODEX_HOME, 'sessions'))) cpSync(join(handed.env.CODEX_HOME, 'sessions'), join(artifacts, 'sessions'), { recursive: true });
  if (existsSync(join(directory, '.c1230-result.json'))) cpSync(join(directory, '.c1230-result.json'), join(artifacts, 'result.json'));

  t.diagnostic(`maker ${provider} exit ${result.exit}; stdout:\n${result.stdout.toString('utf8')}\nstderr:\n${result.stderr.toString('utf8')}`);
  t.diagnostic(`maker ${provider} retained originals: ${artifacts}`);
  return { base, directory, repository, common, origin, configuration, main, handed, result, artifacts, forge };
}

/** Independent observations of the commit, bare origin and local tracking ref. */
export function assertDelivered(made) {
  const { directory, origin, result, main } = made;
  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(gitIn(directory, 'log', '-1', '--format=%s').trim(), COMMIT_MESSAGE, 'the maker commit did not land');
  const head = gitIn(directory, 'rev-parse', 'HEAD').trim();
  assert.equal(gitIn(origin, 'rev-parse', 'refs/heads/rigger-42').trim(), head, 'the maker push did not land');
  assert.equal(gitIn(directory, 'rev-parse', 'refs/remotes/origin/rigger-42').trim(), head, 'the tracking ref did not update');
  assert.equal(gitIn(origin, 'rev-parse', 'refs/heads/main').trim(), main, 'the hook allowed the main branch to move');
  assert.equal(readFileSync(join(directory, 'delivery.txt'), 'utf8'), DELIVERED);
  return head;
}
