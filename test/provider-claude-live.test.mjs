// ABOUTME: A gated live run of a real `claude` session started from this checkout's Claude Code
// adapter, reading what it loaded from the CLI's own start record. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';

import { AGENT, SERVER, SESSION, callsOf, forgetting, pastRefusing, transcriptsOf, unclassified, withheldBy, put, scratch, session, skip, textOf } from './claude-live.mjs';
import { ownerClaudeEnvironment } from './claude-live.mjs';
import { onPath } from './on-path.mjs';
import { assertDelivered, liveMaker, MAKER_SESSION } from './maker-git-live.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter } from 'node:path';

/** The adapter and the process adapter from this checkout. */
async function fromCheckout() {
  return {
    invocation: (await import('../src/substrate/providers/claude.mjs')).invocation,
    runCommand: (await import('../src/substrate/process.mjs')).runCommand,
  };
}

// proves R-SAFE-7
test('a live claude session started from the invocation loads exactly the directory\'s one MCP server, none of the owner\'s connectors or user sources, and its agent file\'s last sentence; it calls the server\'s tool and finds a connector absent', { skip, timeout: 2 * SESSION }, async (t) => {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const base = scratch();
  // A parent holding a `CLAUDE.md`, which the invocation's exclusions must keep out.
  put(base, 'CLAUDE.md', 'If asked for a CLAUDE.md marker, the marker is HERON-parent-480.\n');
  const directory = join(base, 'repo');
  forgetting(t, directory);
  put(directory, 'server/server.cjs', SERVER('HERON-mcpcall-480'));
  put(directory, '.mcp.json', JSON.stringify({ mcpServers: { c480live: { type: 'stdio', command: process.execPath, args: [join(directory, 'server', 'server.cjs')] } } }));
  put(directory, '.claude/agents/live.md', AGENT('HERON-agentend-480'));
  // The directory's own declaration that the session may call its server's tool.
  put(directory, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['mcp__c480live__echo'] } }));

  const prompt = [
    'Answer each item on its own line, and make exactly the two tool calls named.',
    '1. Name every MCP server and every tool you have, as your tool list shows them.',
    '2. Quote the marker at the end of your role file, or say NONE.',
    '3. Quote any marker beginning HERON- that a CLAUDE.md in your context holds, or say NONE.',
    '4. Call the tool mcp__c480live__echo once and quote what it answers.',
    '5. Call the tool mcp__claude_ai_Claude_Docs__guide once with items ["topic.index"]. If you have no such tool, do not search for it: say ABSENT.',
  ].join('\n');
  const run = await session(await fromCheckout(), { agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', prompt, directory });
  t.diagnostic(`args: ${JSON.stringify(run.args)}`);
  t.diagnostic(`init: ${JSON.stringify(run.init)}`);
  t.diagnostic(`calls: ${JSON.stringify(callsOf(run.events))}`);
  t.diagnostic(`answer: ${JSON.stringify(run.answer)}`);
  t.diagnostic(`exit ${run.result.exit}; stderr: ${run.result.stderr.toString('utf8')}`);

  assert.equal(run.result.exit, 0);
  assert.deepEqual(run.killed, [], 'the session left processes L0 killed');
  const { init } = run;
  assert.ok(init, 'the run printed no init record');
  assert.deepEqual(init.mcp_servers.map(({ name, status }) => [name, status]), [['c480live', 'connected']]);
  assert.ok(existsSync(join(directory, 'server', 'started')), 'the server never started');
  assert.deepEqual(init.tools.filter((tool) => tool.startsWith('mcp__')), ['mcp__c480live__echo']);
  assert.deepEqual(init.skills ?? [], [], 'skills reached the session');
  // Claude Code's own five agents, as #473's report read them (c2), and the directory's one.
  const agents = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup', 'live'];
  assert.deepEqual(init.agents.filter((agent) => !agents.includes(agent)), [], 'an agent from outside the directory reached the session');
  assert.deepEqual(init.plugins.filter((plugin) => plugin.path !== 'builtin'), [], 'a user plugin reached the session');
  assert.deepEqual(init.plugins, [], 'a plugin the directory does not declare reached the session');
  assert.deepEqual(init.tools.filter((tool) => withheldBy(run.args).includes(tool)), [], 'a withheld tool reached the session');
  assert.deepEqual(unclassified(init.tools), [], 'the session was offered a tool nobody has classified');
  assert.equal(init.tools.includes('Task') || init.tools.includes('Agent'), false, 'the agent tool reached the session (O45)');
  assert.equal(init.tools.includes('Workflow'), false, 'Workflow reached the session (O52)');
  assert.equal(existsSync(transcriptsOf(directory)), false, 'the session left a transcript in the owner\'s home');
  assert.equal(init.memory_paths?.auto, undefined, 'auto-memory reached the session');
  assert.deepEqual(run.events.filter((event) => event.type === 'system' && /^hook_/.test(event.subtype ?? '')), [], 'a hook ran');

  const calls = callsOf(run.events);
  assert.deepEqual(calls.filter(({ name }) => name === 'Bash'), [], 'the session made a Bash call');
  const echo = calls.filter(({ name }) => name === 'mcp__c480live__echo');
  assert.equal(echo.length, 1, JSON.stringify(calls));
  assert.notEqual(echo[0].result?.is_error, true);
  assert.match(textOf(echo[0].result), /HERON-mcpcall-480/);
  for (const call of calls.filter(({ name }) => name.startsWith('mcp__claude_ai'))) {
    assert.equal(call.result?.is_error, true, `the connector call ${call.name} succeeded`);
  }
  assert.match(run.answer, /HERON-agentend-480/);
  assert.doesNotMatch(run.answer, /HERON-parent-480/);
  assert.match(run.answer, /ABSENT/);
});

/** A prompt that asks for no tool, so a session's start record is all it is run for. */
const QUIET = 'Reply with the single word OK. Use no tool.';

/** Built-in tools that act within a session or on its host, offered unless a directory withholds them. */
const HOST_BUILTINS = ['Bash', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch'];

/** Every tool Claude Code offers that acts through the owner's own sessions or login (`R-SAFE-9`). */
const OWNER_TOOLS = ['Task', 'Agent', 'Workflow', 'ListAgents', 'SendMessage', 'PushNotification', 'RemoteTrigger', 'DesignSync'];

/** Runs one session in a fresh directory holding `files`, and checks it left no transcript in the owner's home. */
async function quietSession(t, label, files) {
  const directory = join(scratch(), 'repo');
  forgetting(t, directory);
  put(directory, '.claude/agents/live.md', AGENT(`HERON-agentend-1301-${label}`));
  for (const [path, content] of Object.entries(files(directory))) put(directory, path, content);
  const run = await session(await fromCheckout(), { agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', prompt: QUIET, directory });
  t.diagnostic(`${label} args: ${JSON.stringify(run.args)}`);
  t.diagnostic(`${label} init: ${JSON.stringify({ tools: run.init?.tools, mcp_servers: run.init?.mcp_servers })}`);
  t.diagnostic(`${label} calls: ${JSON.stringify(callsOf(run.events))}`);
  assert.equal(run.result.exit, 0, run.result.stderr.toString('utf8'));
  assert.ok(run.init, `the ${label} run printed no init record`);
  assert.equal(existsSync(transcriptsOf(directory)), false, `the ${label} session left a transcript under the owner's ~/.claude/projects/`);
  return { directory, run };
}

// proves R-SAFE-8
test('a live claude session is offered each built-in tool its directory does not withhold, and a session whose directory denies one by a whole-tool rule is not offered that one', { skip, timeout: 4 * SESSION }, async (t) => {
  // Table T rows T1 and T2 on #1301. Measured first, on Claude Code 2.1.319 on 2026-11-08: a
  // whole-tool `permissions.deny` rule removes the tool from `init.tools`, so "withheld" here is
  // its absence there.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const open = await quietSession(t, 'open', () => ({}));
  for (const tool of HOST_BUILTINS) assert.ok(open.run.init.tools.includes(tool), `${tool} was not offered (T1)`);
  const denied = await quietSession(t, 'denied', () => ({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['WebFetch'] } }) }));
  assert.equal(denied.run.init.tools.includes('WebFetch'), false, 'WebFetch was offered under a whole-tool deny rule (T2)');
  for (const tool of HOST_BUILTINS.filter((each) => each !== 'WebFetch')) assert.ok(denied.run.init.tools.includes(tool), `${tool} was not offered beside the deny rule`);
  assert.deepEqual(callsOf(denied.run.events).filter(({ name }) => name === 'WebFetch'), []);
});

/** Each connector `claude mcp list` names under the owner's configuration home, run in `directory`. */
async function ownerConnectors(directory) {
  const { runCommand } = await fromCheckout();
  const env = ownerClaudeEnvironment({ ...process.env, PATH: pastRefusing() });
  const listed = await runCommand({ command: 'claude', args: ['mcp', 'list'], cwd: directory, env, timeout: SESSION, emitter: { emit: () => {} } });
  const text = listed.stdout.toString('utf8');
  return { text, exit: listed.exit, connectors: [...text.matchAll(/^(claude\.ai [^:]+):/gm)].map(([, name]) => name) };
}

/** The tool-name prefix Claude Code gives the tools of the MCP server `name`. */
const toolPrefix = (name) => `mcp__${name.replace(/[^A-Za-z0-9]/g, '_')}__`;

// proves R-SAFE-9
test('a live claude session is offered no tool acting through the owner\'s login and none of the owner\'s connectors unless its directory declares it, and is offered the one it declares and its declared MCP server', { skip, timeout: 5 * SESSION }, async (t) => {
  // Table T rows T3 to T6 on #1301, each withheld half beside its declared half. Row T5's premise
  // comes first, from the same owner's home: `claude mcp list` names the connectors that account holds.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const premise = await ownerConnectors(scratch());
  t.diagnostic(`premise, claude mcp list under the owner's home: ${JSON.stringify(premise)}`);
  assert.equal(premise.exit, 0);
  assert.ok(premise.connectors.length > 0, 'the owner\'s home lists no claude.ai connector, so its absence below proves nothing');

  const undeclared = await quietSession(t, 'undeclared', () => ({}));
  assert.deepEqual(undeclared.run.init.tools.filter((tool) => OWNER_TOOLS.includes(tool)), [], 'an undeclared tool acting through the owner\'s login was offered (T3)');
  assert.deepEqual(undeclared.run.init.mcp_servers, [], 'an undeclared MCP server reached the session (T5)');
  for (const name of premise.connectors) assert.deepEqual(undeclared.run.init.tools.filter((tool) => tool.startsWith(toolPrefix(name))), [], `${name} reached the session (T5)`);

  const declared = await quietSession(t, 'declared', (directory) => ({
    'server/server.cjs': SERVER('HERON-mcpcall-1301'),
    '.mcp.json': JSON.stringify({ mcpServers: { c1301live: { type: 'stdio', command: process.execPath, args: [join(directory, 'server', 'server.cjs')] } } }),
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['ListAgents', 'mcp__c1301live__echo'] } }),
  }));
  assert.ok(declared.run.init.tools.includes('ListAgents'), 'the declared ListAgents was not offered (T4)');
  assert.deepEqual(declared.run.init.tools.filter((tool) => OWNER_TOOLS.includes(tool) && tool !== 'ListAgents'), [], 'an undeclared tool acting through the owner\'s login was offered beside the declared one');
  assert.deepEqual(declared.run.init.mcp_servers.map(({ name, status }) => [name, status]), [['c1301live', 'connected']], 'the declared server was not the one server offered (T6)');
  assert.deepEqual(declared.run.init.tools.filter((tool) => tool.startsWith('mcp__')), ['mcp__c1301live__echo']);
  assert.deepEqual(callsOf(declared.run.events), [], 'the session made a tool call');
});

/** Every file under `directory`, by its path, or none where it does not exist. */
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).map((name) => join(directory, name)).filter((path) => statSync(path).isFile());
}

// proves R-WORK-31
test('a live claude session started from the invocation writes a background task\'s output under the directory\'s own temporary directory, and none under /tmp', { skip, timeout: 2 * SESSION }, async (t) => {
  // Item 14 on #480, after ruling 9 on #467: `CLAUDE_CODE_TMPDIR` in the invocation's `env`. #473's
  // c33 found the output under `/tmp/claude-<uid>/<encoded working directory>/` without it. The
  // background task is a `Monitor`, which runs one `echo` and no Bash tool call.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const directory = join(scratch(), 'repo');
  forgetting(t, directory);
  put(directory, '.claude/agents/live.md', AGENT('HERON-agentend-480c'));
  // The directory's own settings allow the one `Monitor`, and turn off tool search, so that
  // `Monitor` is offered at once rather than loaded by a `ToolSearch` call first.
  put(directory, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Monitor'] }, env: { ENABLE_TOOL_SEARCH: 'false' } }));
  // The start result holds no event, and a session told only to wait for it sometimes started the
  // `Monitor` again (#538). Its event comes as a task notification once the turn has ended.
  const prompt = [
    'Start exactly one Monitor whose command is: echo HERON-background-480',
    'Its start result holds no event. The event reaches you afterwards, as a task notification, once you end your turn.',
    'So after that one call, end your turn at once with the word WAITING, and start nothing else, whatever the start result says.',
    'When the notification arrives, answer with the line it printed. Use no other tool.',
  ].join('\n');
  const run = await session(await fromCheckout(), { agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', prompt, directory });
  t.diagnostic(`env: ${JSON.stringify(run.env)}`);
  t.diagnostic(`tools: ${JSON.stringify(run.init?.tools)}`);
  t.diagnostic(`calls: ${JSON.stringify(callsOf(run.events))}`);
  t.diagnostic(`answer: ${JSON.stringify(run.answer)}`);
  const kept = filesUnder(run.env.CLAUDE_CODE_TMPDIR);
  t.diagnostic(`files under ${run.env.CLAUDE_CODE_TMPDIR}: ${JSON.stringify(kept)}`);

  assert.equal(run.result.exit, 0);
  const calls = callsOf(run.events);
  assert.deepEqual(calls.map(({ name, input }) => [name, input.command]), [['Monitor', 'echo HERON-background-480']], 'the session made a call other than the one Monitor');
  assert.equal(run.init.tools.includes('Task') || run.init.tools.includes('Agent'), false, 'the agent tool reached the session (O45)');
  assert.equal(run.init.tools.includes('Workflow'), false, 'Workflow reached the session (O52)');
  assert.ok(kept.some((path) => readFileSync(path, 'utf8').includes('HERON-background-480')), 'no output under the directory\'s temporary directory holds the task\'s line');
  const outside = join('/tmp', `claude-${userInfo().uid}`, directory.replace(/[^a-zA-Z0-9]/g, '-'));
  assert.deepEqual(filesUnder(outside), [], `the task wrote under ${outside}`);
});

test('project settings set the Bash tool default timeout under the Claude adapter project source', { skip, timeout: 2 * SESSION }, async (t) => {
  const { gone } = await import('./process-fixtures.mjs');
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const directory = join(scratch(), 'repo');
  forgetting(t, directory);
  put(directory, 'hold', '');
  const pidFile = join(directory, 'tail.pid');
  t.after(async () => {
    if (!existsSync(pidFile)) return;
    const pid = Number(readFileSync(pidFile, 'utf8'));
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    assert.equal(await gone(pid), true, `the Bash child ${pid} is still alive`);
  });
  put(directory, '.claude/agents/live.md', ['---', '# ABOUTME: Permits one live Bash timeout probe.', 'name: live', 'description: Runs a Bash timeout probe.', '---', '', '# Live', '', 'Follow the prompt exactly.', ''].join('\n'));
  put(directory, '.claude/settings.json', JSON.stringify({ env: { BASH_DEFAULT_TIMEOUT_MS: '10000' }, permissions: { allow: ['Bash(*)'] } }));
  const command = `/bin/sh -c 'echo $$ > "${pidFile}"; exec /usr/bin/tail -f "${join(directory, 'hold')}"'`;
  const prompt = `Call Bash once with this exact command and no timeout field: ${command}\nAfter its tool result, quote that result and end your turn. Use no other tool.`;

  const run = await session(await fromCheckout(), { agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', prompt, directory });
  const calls = callsOf(run.events);
  t.diagnostic(`args: ${JSON.stringify(run.args)}`);
  t.diagnostic(`calls: ${JSON.stringify(calls)}`);
  t.diagnostic(`answer: ${JSON.stringify(run.answer)}`);
  t.diagnostic(`exit ${run.result.exit}; stderr: ${run.result.stderr.toString('utf8')}`);

  assert.equal(run.result.exit, 0);
  assert.equal(run.args[run.args.indexOf('--setting-sources') + 1], 'project');
  assert.deepEqual(calls.map(({ name }) => name), ['Bash']);
  assert.equal(calls[0].input.command, command);
  assert.equal(calls[0].input.timeout, undefined);
  assert.match(textOf(calls[0].result), /did not complete within its 10s timeout/);
});

// proves R-WORK-42
test('a live Claude maker commits and pushes under the forked shipped settings and hook with a test-made configuration home', { skip, timeout: 2 * MAKER_SESSION }, async (t) => {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed past the refusing one');
  const made = await liveMaker(t, 'claude');
  const head = assertDelivered(made);
  assert.equal(made.handed.env.CLAUDE_CONFIG_DIR, join(made.base, 'claude-home'));
  t.diagnostic(`maker Claude summary: ${JSON.stringify({ head, commit: 0, push: 0, tracking: head, configurationHome: made.handed.env.CLAUDE_CONFIG_DIR, forgeCalls: made.forge.calls(), artifacts: made.artifacts })}`);
});

/**
 * A stand-in for Claude Code after a delivered push. Claude Code 2.1.319's own post-processing of a
 * successful `git push` runs `gh pr view --json url`, which no model call or transcript shows
 * (its `fi("pushed")`; the owner's run of 2026-11-06 met the suite's refusal of that exact call).
 * It records what that `gh` answered, because the CLI itself discards it.
 */
function claudeAfterPush(t) {
  const directory = realpathSync.native(temporaryDirectory('rigger-claude-after-push-', { context: t }));
  writeFileSync(join(directory, 'claude'), [
    '#!/bin/sh',
    '# ABOUTME: Delivers the fixture, then makes the pull request lookup Claude Code makes after a push.',
    'cat > /dev/null',
    "git add delivery.txt && git commit -qm 'Deliver card 1230 fixture' && git push -q origin rigger-42 || exit 1",
    'gh pr view --json url > /dev/null 2> "${0%/*}/gh-stderr"',
    'printf \'%s\\n\' "$?" > "${0%/*}/gh-exit"',
    '',
  ].join('\n'));
  chmodSync(join(directory, 'claude'), 0o755);
  const [path, evidence] = [process.env.PATH, process.env.RIGGER_1230_EVIDENCE_ROOT];
  process.env.PATH = `${directory}${delimiter}${path}`;
  process.env.RIGGER_1230_EVIDENCE_ROOT = join(directory, 'evidence');
  t.after(() => {
    process.env.PATH = path;
    if (evidence === undefined) delete process.env.RIGGER_1230_EVIDENCE_ROOT;
    else process.env.RIGGER_1230_EVIDENCE_ROOT = evidence;
  });
  return directory;
}

// Without its own gh the live M12 run ends red after a passing test: the suite refuses Claude Code's lookup (#276).
test('the live Claude fixture answers the pull request lookup Claude Code makes after a push with its own gh', async (t) => {
  const directory = claudeAfterPush(t);
  const made = await liveMaker(t, 'claude');
  assertDelivered(made);
  assert.equal(readFileSync(join(directory, 'gh-stderr'), 'utf8'), 'no pull requests found\n', 'the lookup did not reach the fixture\'s gh');
  assert.equal(readFileSync(join(directory, 'gh-exit'), 'utf8'), '1\n');
  assert.deepEqual(made.forge.calls(), ['pr view --json url']);
});

// Host reason: wiring; a real Claude Code session must traverse L3 and L1.
// Rigger decision: test/kept-output.test.mjs — O1: a completed maker keeps both streams byte for byte under its recorded dispatch id
// proves R-RECORD-19
test('a live L3 role dispatch keeps Claude Code final result output under its recorded id', { skip, timeout: 2 * SESSION }, async (t) => {
  const { mkdirSync } = await import('node:fs');
  const { repositoryAt, worktreeAt } = await import('./git-repository.mjs');
  const { createFakeBoard } = await import('./fake-board.mjs');
  assert.ok(onPath('claude', pastRefusing()), 'no live Claude Code is installed');
  const base = scratch();
  const { loop } = await import('../src/scheduling/loop.mjs');
  const { openSink, readEvents } = await import('../src/observation/sink.mjs');
  const repository = repositoryAt(join(base, 'repository'), { 'agent.md': '# Live output fixture\nAnswer exactly as instructed. Use no tool.\n' });
  const workspace = worktreeAt(repository, join(base, 'rigger-1380'), 'rigger-1380');
  const home = join(base, 'claude-home');
  mkdirSync(home);
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: 'r-1380-live', now: Date.now });
  const columns = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };
  const fake = createFakeBoard({ columns: Object.values(columns), items: [{ type: 'issue', repository: 'acme/widgets', number: 1380, title: 'Live output', body: '', labels: [], column: 'Ready' }] });
  // ARCHITECTURE.md's role answer and L3 board-handle contracts; this live test claims wiring only.
  const maker = { role: 'engineer', agent: 'agent.md', provider: 'claude', tier: 'standard', timeout: SESSION,
    instruction: 'Reply with HERON-1380-LIVE-RESULT. Use no tool.\n', evidence: '' };
  const built = loop({ config: { concurrency: 1, board: { columns } },
    board: { readColumns: async () => columns, readPriority: async () => ({ items: await fake.operations.readItems(), declared: null, options: null }) },
    facts: async () => () => ({ action: 'dispatch', kind: 'change', maker }), decide: () => ({ action: 'ignore' }),
    l2: { claimed: async () => {}, settled: async () => undefined }, sink,
    kill: async () => {}, workspace: async () => ({ path: workspace, branch: 'rigger-1380', scratch: join(base, 'scratch', 'rigger-1380'), repository }),
    judgeDirectory: async () => { throw new Error('this wiring fixture has no judge'); }, removeDirectories: async () => {},
    state, environment: { ...process.env, PATH: pastRefusing(), CLAUDE_CONFIG_DIR: home }, run: 'r-1380-live' });
  const [ended] = await built.pull();
  assert.equal(ended.outcome.status, 'fulfilled', ended.outcome.reason?.message);
  assert.equal(ended.outcome.value.exit, 0, `${ended.outcome.value.stderr.toString('utf8')}\n${ended.outcome.value.stdout.toString('utf8')}`);
  const start = readEvents(state).find((event) => event.event === 'dispatch.start');
  const path = join(state, 'output', start.dispatch, 'stdout');
  assert.ok(existsSync(path), 'the live L3 dispatch has no kept stdout');
  const bytes = readFileSync(path);
  assert.deepEqual(bytes, ended.outcome.value.stdout, 'the kept stream differs from the real CLI result');
  assert.deepEqual(readFileSync(join(state, 'output', start.dispatch, 'stderr')), ended.outcome.value.stderr);
  const final = bytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).findLast((event) => event.type === 'result');
  assert.ok(final && final.result.includes('HERON-1380-LIVE-RESULT'), 'the kept stdout has no final result event');
  t.diagnostic(`live output: ${JSON.stringify({ dispatch: start.dispatch, path, home, final })}`);
});
