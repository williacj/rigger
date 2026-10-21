// ABOUTME: Gated live Claude Code sessions through L1, tying the adapter's folder name to the
// installed CLI's saved tool result and checking the end-of-dispatch sweep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { makeJudgeDirectory, makeWorkspace } from '../src/execution/workspace.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { gitIn, repositoryAt, withOrigin, cloneInto } from './git-repository.mjs';
import { SERVER, ownerClaudeEnvironment, pastRefusing, put, scratch, skip, eventsOf, callsOf, textOf } from './claude-live.mjs';

/** A local repository whose main line declares one live role and one Bash permission. */
function sourceIn(base, files = {}) {
  const source = repositoryAt(join(base, 'source'), {
    '.claude/agents/live.md': '---\n# ABOUTME: Follows one live folder measurement prompt.\nname: live\ndescription: Runs one tool.\n---\n\n# Live\nFollow the prompt exactly.\n',
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(*)'] } }),
    ...files,
  });
  gitIn(source, 'branch', '-M', 'main');
  const origin = join(base, 'origin.git');
  withOrigin(source, origin);
  return cloneInto(origin, join(base, 'repository'));
}

/** Runs `answer` through the same L1 handoff and dispatch as a maker. */
async function runRole(t, { answer, cwd, directory, scratchBase, repository, sink, state, id = 'd-629-live', reach = [] }) {
  const env = ownerClaudeEnvironment({ ...process.env, PATH: pastRefusing() });
  const home = Object.hasOwn(env, 'CLAUDE_CONFIG_DIR') ? env.CLAUDE_CONFIG_DIR : join(env.HOME, '.claude');
  const projects = join(home, 'projects');
  const beforeProjects = existsSync(projects) ? readdirSync(projects).sort() : [];
  const handed = await roleDispatch({ answer, cwd, directory, scratch: scratchBase, repository, env, sink, id, card: 629, reach });
  const result = await dispatch({ id, card: 629, directory: state, sink, ...handed });
  assert.ok(readEvents(state).some((event) => event.event === 'dispatch.end' && event.dispatch === id), `${id} has no recorded end`);
  const afterProjects = existsSync(projects) ? readdirSync(projects).sort() : [];
  t.diagnostic(`${id} projects before: ${JSON.stringify(beforeProjects)}; after: ${JSON.stringify(afterProjects)}`);
  assert.deepEqual(afterProjects, beforeProjects, `${id} left a new projects entry after its recorded end`);
  return { handed, result };
}

/** Paths under a temporary-output root without following symbolic links. */
function pathsUnder(root, prefix = '') {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const relative = prefix === '' ? name : join(prefix, name);
    const at = join(root, name);
    return [relative, ...(lstatSync(at).isDirectory() ? pathsUnder(at, relative) : [])];
  }).sort();
}

/** What the old /tmp route for a session in `cwd` could hold. */
const oldTemporary = (cwd) => join('/tmp', `claude-${userInfo().uid}`, realpathSync.native(cwd).replace(/[^A-Za-z0-9]/g, '-'));

/** Names and contents under the configuration home, without following a link. */
function homeEntries(root, prefix = '', found = new Map()) {
  if (!existsSync(root)) return found;
  for (const name of readdirSync(root).sort()) {
    const relative = prefix === '' ? name : join(prefix, name);
    const at = join(root, name);
    const held = lstatSync(at);
    if (held.isDirectory()) {
      found.set(relative, 'directory');
      homeEntries(at, relative, found);
    } else if (held.isSymbolicLink()) found.set(relative, `link:${readlinkSync(at)}`);
    else if (held.isFile()) found.set(relative, `file:${createHash('sha256').update(readFileSync(at)).digest('hex')}`);
    else found.set(relative, `other:${held.mode}`);
  }
  return found;
}

/** The one named tool call and the folder the CLI made for it. */
function measuredCall(t, { handed, result }, cwd, tool) {
  const events = eventsOf(result.stdout);
  const version = events.find((event) => event.type === 'system' && event.subtype === 'init')?.claude_code_version;
  const calls = callsOf(events).filter(({ name }) => name === tool);
  const summarized = calls.map(({ name, input, result: found }) => ({ name, input, resultBytes: textOf(found).length, resultPrefix: textOf(found).slice(0, 240) }));
  t.diagnostic(`Claude Code ${version}; real path ${realpathSync.native(cwd)}; calls ${JSON.stringify(summarized)}`);
  if (result.exit !== 0) t.diagnostic(`CLI result: ${events.find((event) => event.type === 'result')?.subtype ?? 'none'}`);
  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(calls.length, 1, JSON.stringify(callsOf(events)));
  const saved = /(?:Full output saved to:|Output has been saved to)\s+([^\s]+)/.exec(textOf(calls[0].result))?.[1];
  if (saved !== undefined) {
    const madeName = saved.split('/projects/')[1]?.split('/')[0];
    t.diagnostic(`CLI folder ${madeName}; saved result ${saved}`);
    assert.equal(handed.folder.name, madeName);
  } else t.diagnostic(`CLI folder: none made for this result; adapter folder: ${handed.folder?.name ?? 'none'}`);
  assert.equal(existsSync(join(handed.folder.home, 'projects', handed.folder.name)), false);
  return { call: calls[0], saved };
}

// proves R-WORK-31
test('an over-limit Bash maker under a long linked path leaves no Claude folder and matches the CLI folder name', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base);
  const root = join(base, `worktree_root _ space ${'x'.repeat(85)}`, 'deep');
  mkdirSync(root, { recursive: true });
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-live', now: Date.now });
  const made = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const link = join(base, 'linked-root');
  symlinkSync(root, link);
  const cwd = join(link, 'rigger-629');
  assert.equal(realpathSync.native(cwd), realpathSync.native(made.path));
  assert.ok(realpathSync.native(cwd).length > 200, `the real maker path is only ${realpathSync.native(cwd).length} characters`);
  const temporary = oldTemporary(cwd);
  const beforeTemporary = pathsUnder(temporary);
  const command = `node -e "process.stdout.write('X'.repeat(360000) + 'HERON-output-629')"`;
  const answer = { role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: `Call Bash exactly once with this command: ${command}\nAfter it returns, say DONE. Use no other tool.\n`, evidence: '', facts: undefined, digest: undefined };
  const { handed, result } = await runRole(t, { answer, cwd, directory: cwd, scratchBase: made.scratch, repository, sink, state });
  const events = eventsOf(result.stdout);
  t.diagnostic(`Claude Code version: ${events.find((event) => event.type === 'system' && event.subtype === 'init')?.claude_code_version}; real path: ${realpathSync.native(cwd)}; adapter folder: ${handed.folder?.name ?? 'none'}`);
  t.diagnostic(`exit ${result.exit}; stderr: ${result.stderr.toString('utf8')}`);
  const calls = callsOf(events);
  const bash = calls.filter(({ name }) => name === 'Bash');
  t.diagnostic(`Bash result prefix: ${textOf(bash[0]?.result).slice(0, 500)}`);
  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(bash.length, 1, JSON.stringify(calls));
  const saved = /Full output saved to: ([^\s]+)/.exec(textOf(bash[0].result))?.[1];
  assert.ok(saved, `the Bash result named no saved file: ${textOf(bash[0].result).slice(0, 1000)}`);
  const madeName = saved.split('/projects/')[1]?.split('/')[0];
  t.diagnostic(`Claude Code folder: ${madeName}; saved result: ${saved}`);
  const home = handed.folder.home;
  const madeFolder = join(home, 'projects', madeName);
  assert.equal(existsSync(madeFolder), false, 'the dispatch left its Claude folder after the end');
  assert.equal(handed.folder?.name, madeName, 'the adapter named a folder other than Claude Code made');
  assert.deepEqual(pathsUnder(temporary), beforeTemporary);
  assert.ok(readEvents(state).some((event) => event.event === 'dispatch.end'));
});

// proves R-WORK-31
test('an inline Bash maker and an over-limit Bash judge leave no CLI or old temporary output', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base);
  const root = join(base, 'plain-root');
  mkdirSync(root);
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-pair', now: Date.now });
  const maker = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const judge = await makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 629, role: 'reviewer', head, repository, sink });
  const small = `node -e "process.stdout.write('HERON-inline-629')"`;
  const large = `node -e "process.stdout.write('X'.repeat(360000) + 'HERON-judge-629')"`;
  const answer = (command) => ({ role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: `Call Bash exactly once with this command: ${command}\nAfter it returns, say DONE. Use no other tool.\n`, evidence: '' });
  const makerTmp = oldTemporary(maker.path);
  const judgeTmp = oldTemporary(judge.main);
  const beforeMaker = pathsUnder(makerTmp);
  const beforeJudge = pathsUnder(judgeTmp);

  const inline = await runRole(t, { answer: answer(small), cwd: maker.path, directory: maker.path, scratchBase: maker.scratch, repository, sink, state, id: 'd-629-inline' });
  const inlineResult = measuredCall(t, inline, maker.path, 'Bash');
  assert.equal(inlineResult.saved, undefined);
  assert.match(textOf(inlineResult.call.result), /HERON-inline-629/);
  const over = await runRole(t, { answer: answer(large), cwd: judge.main, directory: judge.path, scratchBase: judge.scratch, repository, sink, state, id: 'd-629-judge', reach: [judge.head] });
  assert.ok(measuredCall(t, over, judge.main, 'Bash').saved, 'the judge Bash result named no saved file');
  assert.deepEqual(pathsUnder(makerTmp), beforeMaker);
  assert.deepEqual(pathsUnder(judgeTmp), beforeJudge);
});

// proves R-WORK-31
test('large Read results in maker and judge sessions leave no CLI or old temporary output', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base, { 'large.txt': `${'X'.repeat(200)}\n`.repeat(1800) });
  const root = join(base, 'plain-root');
  mkdirSync(root);
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-read', now: Date.now });
  const maker = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const judge = await makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 629, role: 'reviewer', head, repository, sink });
  const answer = (file) => ({ role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: `Call Read exactly once with file_path ${file} and allow_large: true. After it returns, say DONE. Use no other tool.\n`, evidence: '' });
  for (const [id, cwd, directory, scratchBase, reach] of [
    ['d-629-maker-read', maker.path, maker.path, maker.scratch, []],
    ['d-629-judge-read', judge.main, judge.path, judge.scratch, [judge.head]],
  ]) {
    const temporary = oldTemporary(cwd);
    const before = pathsUnder(temporary);
    const run = await runRole(t, { answer: answer(join(cwd, 'large.txt')), cwd, directory, scratchBase, repository, sink, state, id, reach });
    const observed = measuredCall(t, run, cwd, 'Read');
    t.diagnostic(`${id} saved file: ${observed.saved ?? 'none'}`);
    assert.deepEqual(pathsUnder(temporary), before);
  }
});

// proves R-WORK-31
test('over-limit directory MCP results in maker and judge sessions leave no CLI or old temporary output', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base);
  const root = join(base, 'plain-root');
  mkdirSync(root);
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-mcp', now: Date.now });
  const maker = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const judge = await makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 629, role: 'reviewer', head, repository, sink });
  const answer = { role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: 'Call mcp__c629live__echo exactly once with no arguments. After it returns, say DONE. Use no other tool.\n', evidence: '' };
  for (const [id, cwd, directory, scratchBase, reach] of [
    ['d-629-maker-mcp', maker.path, maker.path, maker.scratch, []],
    ['d-629-judge-mcp', judge.main, judge.path, judge.scratch, [judge.head]],
  ]) {
    put(cwd, 'server/server.cjs', SERVER(`HERON-mcp-629${'X'.repeat(360000)}`));
    put(cwd, '.mcp.json', JSON.stringify({ mcpServers: { c629live: { type: 'stdio', command: process.execPath, args: [join(cwd, 'server', 'server.cjs')] } } }));
    put(cwd, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['mcp__c629live__echo'] } }));
    const temporary = oldTemporary(cwd);
    const before = pathsUnder(temporary);
    const run = await runRole(t, { answer, cwd, directory, scratchBase, repository, sink, state, id, reach });
    assert.ok(measuredCall(t, run, cwd, 'mcp__c629live__echo').saved, `${id} named no saved file`);
    assert.deepEqual(pathsUnder(temporary), before);
  }
});

// proves R-WORK-31
test('Monitor output stays in each maker and judge dispatch temporary directory', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base);
  const root = join(base, 'plain-root');
  mkdirSync(root);
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-monitor', now: Date.now });
  const maker = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const judge = await makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 629, role: 'reviewer', head, repository, sink });
  const answer = { role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: 'Start one Monitor with command echo HERON-monitor-629. Its start result has no output, so finish this turn with WAITING. When its notification arrives, answer with its line. Do not call another tool.\n', evidence: '' };
  for (const [id, cwd, directory, scratchBase, reach] of [
    ['d-629-maker-monitor', maker.path, maker.path, maker.scratch, []],
    ['d-629-judge-monitor', judge.main, judge.path, judge.scratch, [judge.head]],
  ]) {
    put(cwd, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Monitor'] }, env: { ENABLE_TOOL_SEARCH: 'false' } }));
    const temporary = oldTemporary(cwd);
    const before = pathsUnder(temporary);
    const run = await runRole(t, { answer, cwd, directory, scratchBase, repository, sink, state, id, reach });
    const call = measuredCall(t, run, cwd, 'Monitor').call;
    assert.equal(call.input.command, 'echo HERON-monitor-629');
    const inDispatch = run.handed.env.CLAUDE_CODE_TMPDIR;
    assert.ok(pathsUnder(inDispatch).some((path) => {
      const at = join(inDispatch, path);
      return lstatSync(at).isFile() && readFileSync(at, 'utf8').includes('HERON-monitor-629');
    }), `${id} wrote no Monitor output in its dispatch temporary directory`);
    assert.deepEqual(pathsUnder(temporary), before);
  }
});

// proves R-WORK-31
test('a maker and judge leave every earlier configuration-home path and classify each later change', { skip, timeout: 600_000 }, async (t) => {
  const base = scratch();
  const repository = sourceIn(base);
  const root = join(base, 'plain-root');
  mkdirSync(root);
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-629-home', now: Date.now });
  const maker = await makeWorkspace({ root, topic: 'rigger-{number}', card: 629, repository, sink });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const judge = await makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 629, role: 'reviewer', head, repository, sink });
  const home = ownerClaudeEnvironment({ ...process.env }).CLAUDE_CONFIG_DIR ?? join(process.env.HOME, '.claude');
  const before = homeEntries(home);
  const answer = { role: 'live', agent: '.claude/agents/live.md', provider: 'claude', tier: 'standard', timeout: 300_000, instruction: 'Call Bash exactly once with this command: echo HERON-home-629. After it returns, say DONE. Use no other tool.\n', evidence: '' };
  for (const [id, cwd, directory, scratchBase, reach] of [
    ['d-629-maker-home', maker.path, maker.path, maker.scratch, []],
    ['d-629-judge-home', judge.main, judge.path, judge.scratch, [judge.head]],
  ]) {
    const run = await runRole(t, { answer, cwd, directory, scratchBase, repository, sink, state, id, reach });
    assert.match(textOf(measuredCall(t, run, cwd, 'Bash').call.result), /HERON-home-629/);
  }
  const after = homeEntries(home);
  const removed = [...before.keys()].filter((path) => !after.has(path));
  const changed = [...after].filter(([path, value]) => before.get(path) !== value).map(([path]) => path);
  t.diagnostic(`home removed: ${JSON.stringify(removed)}; added or changed: ${JSON.stringify(changed)}`);
  const rotatedBackup = /^backups\/\.claude\.json\.backup\.[0-9]+$/;
  assert.deepEqual(removed.filter((path) => !rotatedBackup.test(path)), []);
  assert.deepEqual(changed.filter((path) => !path.startsWith('session-env/') && !rotatedBackup.test(path)), []);
});
