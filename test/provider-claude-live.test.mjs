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
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { init } from '../src/cli/init.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { parseEscalationNote } from '../src/workflow/escalation.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { forgeStore } from './in-process-fixtures.mjs';
import { handleOn } from './loop-world.mjs';
import { consumerConfig } from './verb-consumer.mjs';
import { detachedWorktreeAt, gitIn, repositoryAt, worktreeAt } from './git-repository.mjs';
import { eventsOf } from './claude-live.mjs';
import { dirname } from 'node:path';
import { dispatchedEscalation, escalationInstruction } from '../src/workflow/escalation.mjs';

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

const ESCALATION_REASON = 'The fixture needs its author to choose "blue" or \'green\'; preserve $HOME and \\.';
const ROLE_REASON = 'The escalation role needs the owner to decide.';
const ESCALATION_COMMAND = 'gh issue comment 42 --body-file .rigger-escalation.md';

/** A real L3 dispatch over the shared forge; all Claude configuration and writes belong to this test. */
async function liveEscalation(t, { routed = false, negative = false } = {}) {
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed past the refusing one');
  const base = realpathSync.native(temporaryDirectory('rigger-claude-escalation-', { context: t }));
  const repository = repositoryAt(join(base, 'repository'), { README: 'Live escalation fixture.\n' });
  gitIn(repository, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
  const initialized = await init({ target: repository });
  assert.equal(initialized.code, 0, initialized.text);
  t.diagnostic(initialized.text);
  assert.deepEqual(readFileSync(join(repository, '.claude', 'settings.json')), readFileSync(new URL('../templates/claude/settings.json', import.meta.url)));
  const agent = '.claude/agents/escalation-live.md';
  const roleAgent = '.claude/agents/escalation-role-live.md';
  const role = (name, extra = '') => `---\n# ABOUTME: Follows only the live escalation fixture task.\nname: ${name}\ndescription: Posts the fixture escalation.\n---\nFollow the task exactly. Do not change configuration, request broader permissions, use another command, or retry a refused command.\n${extra}\n`;
  put(repository, agent, role('escalation-live'));
  put(repository, roleAgent, role('escalation-role-live', `You cannot settle acceptance item 1. Follow your escalation instruction with category critical and item 1. Copy this exact field line into the note:\nreason: ${ROLE_REASON}\nUse Write for the note file, run only the command your escalation instruction names, and end even if it is refused.`));
  gitIn(repository, 'add', '-A');
  gitIn(repository, 'commit', '-qm', 'Consumer initialized for escalation');
  gitIn(repository, 'branch', '-M', 'main');
  const directory = worktreeAt(repository, join(base, 'rigger-42'), 'rigger-42');
  assert.equal(gitIn(directory, 'remote', 'get-url', 'origin').trim(), 'https://github.com/acme/widgets.git');
  const forgeDirectory = join(directory, '.c1385-forge');
  mkdirSync(forgeDirectory);
  const forge = installFakeGh(forgeDirectory, { repo: 'acme/widgets', project: 3 });
  const body = '## Acceptance\n\n- The fixture has an author-selected colour.\n';
  seedRepository(forge, { issues: [{ number: 42, body, comments: [] }, { number: 43, body, comments: [] }] });
  if (negative) put(directory, '.rigger-escalation.md', '```rigger-escalation\ncategory: ambiguous\nitem: 1\nreason: A permission probe.\ndispatch: d-11111111-2222-3333-4444-555555555555\n```\n');
  const store = forgeStore(join(forgeDirectory, 'board.json'));
  const send = async (command, args) => {
    assert.equal(command, 'gh');
    return store.answer(args, { cwd: directory, now: () => new Date().toISOString() });
  };
  const config = { ...consumerConfig(1), escalate: routed ? { ambiguous: 'pm' } : undefined,
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'] } },
    roles: { engineer: { agent, provider: 'claude', tier: 'standard', timeout: SESSION }, pm: { agent: roleAgent, provider: 'claude', tier: 'standard', timeout: SESSION } } };
  config.board = { ...config.board, priority: undefined };
  const board = createFakeBoard({ columns: Object.values(config.board.columns), items: [{ type: 'issue', repository: config.repo, number: 42, title: 'Choose a fixture colour', body, labels: ['type:change'], column: config.board.columns.ready }] });
  const state = join(base, 'state');
  const sink = openSink({ directory: state, run: 'r-escalation-live', now: Date.now });
  const reads = repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink, items: board.operations, reads, send, roleReads: () => reads });
  const forbidden = ['gh issue comment 43 --body-file .rigger-escalation.md', `${ESCALATION_COMMAND} --repo other/repo`];
  const task = negative
    ? `Run exactly these two Bash commands, each as its own call, even if the first is refused:\n${forbidden.join('\n')}\nThen end. Refusals are expected; do not retry, post an escalation, or use another tool.`
    : `Acceptance item 1 cannot be met. Follow your escalation instruction with category ambiguous and item 1. Copy this exact field line into the note:\nreason: ${ESCALATION_REASON}\nUse Write to create .rigger-escalation.md, then run exactly ${ESCALATION_COMMAND} once and end even if refused. Do not use a fallback.`;
  const decide = (card, outcomes, extra) => {
    const answer = nextAction(card, config.kinds, undefined, { roles: config.roles, provisioning: {}, sink, outcomes, ...extra });
    return answer.maker === undefined ? answer : { ...answer, maker: { ...answer.maker, instruction: negative ? task : `${answer.maker.instruction}\n${task}\n` } };
  };
  const home = join(base, 'claude-home');
  const ghHome = join(base, 'gh-home');
  mkdirSync(home);
  mkdirSync(ghHome);
  const { GH_TOKEN, GITHUB_TOKEN, ...environment } = process.env;
  Object.assign(environment, { PATH: `${forgeDirectory}${delimiter}${pastRefusing()}`, CLAUDE_CONFIG_DIR: home, GH_CONFIG_DIR: ghHome });
  const built = loop({ config, board: handleOn(board, { columns: config.board.columns }), decide,
    facts: factsCall({ config, reads, decide }), l2, sink, kill: async () => {},
    workspace: async () => ({ path: directory, branch: 'rigger-42', scratch: join(base, 'scratch-maker'), repository }),
    judgeDirectory: async () => assert.fail('an escalation fixture must dispatch no judge'),
    escalationDirectory: async () => {
      const path = join(base, 'escalation');
      mkdirSync(path);
      const main = detachedWorktreeAt(repository, join(path, 'main'), 'main');
      assert.equal(gitIn(main, 'remote', 'get-url', 'origin').trim(), 'https://github.com/acme/widgets.git');
      return { path, main, scratch: join(base, 'scratch-role'), repository };
    },
    removeDirectories: async () => {}, state, environment, run: 'r-escalation-live' });
  const [reached] = await built.pull(1);
  const outcomes = [reached.outcome, reached.escalationRole?.outcome].filter(Boolean);
  const artifacts = join(process.env.RIGGER_1385_EVIDENCE_ROOT ?? join(dirname(realpathSync.native(process.env.TMPDIR)), '1385-live-evidence'), `claude-${randomUUID()}`);
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const results = outcomes.map((outcome, index) => {
    assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
    const result = outcome.value;
    writeFileSync(join(artifacts, `${index}-stdout`), result.stdout);
    writeFileSync(join(artifacts, `${index}-stderr`), result.stderr);
    t.diagnostic(`1385 Claude session ${index} exit ${result.exit}; stdout:\n${result.stdout.toString('utf8')}\nstderr:\n${result.stderr.toString('utf8')}`);
    return result;
  });
  const held = JSON.parse(readFileSync(join(forgeDirectory, 'board.json'), 'utf8'));
  writeFileSync(join(artifacts, 'forge.json'), JSON.stringify(held, null, 2));
  writeFileSync(join(artifacts, 'events.json'), JSON.stringify(readEvents(state), null, 2));
  writeFileSync(join(artifacts, 'task.txt'), task);
  t.diagnostic(`1385 Claude retained originals: ${artifacts}; test-made configuration home: ${home}`);
  return { results, held, forbidden, events: readEvents(state), reached, directory };
}

/** The writer's note in the fake forge must retain the expected fields and L3's dispatch id. */
function assertedLiveNote(made, role, category, reason) {
  const dispatch = made.events.find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === role)?.dispatch;
  assert.ok(dispatch, `${role} was not dispatched by L3`);
  const notes = made.held.repository.issues.find(({ number }) => number === 42).comments.map(({ body }) => parseEscalationNote(body, 1)).filter(Boolean);
  assert.deepEqual(notes.find((note) => note.dispatch === dispatch), { category, item: 1, reason, dispatch });
}

// Host reason: wiring.
// Ordinary decision counterpart: test/escalation-route.test.mjs :: Claude dispatch settings append only the exact card escalation rule with and without reach.
// proves R-ESCALATE-27
test('a live Claude maker posts its instructed escalation under init settings', { skip, timeout: 2 * SESSION }, async (t) => {
  const made = await liveEscalation(t);
  assert.equal(made.results[0].exit, 0);
  assert.doesNotMatch(made.results[0].stdout.toString('utf8'), /requires approval/i, 'the instructed command must not need approval');
  assertedLiveNote(made, 'engineer', 'ambiguous', ESCALATION_REASON);
  assert.deepEqual(made.held.sent.filter((args) => args[0] === 'issue'), [['issue', 'comment', '42', '--body-file', '.rigger-escalation.md']]);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/escalation-route.test.mjs :: Claude dispatch settings append only the exact card escalation rule with and without reach.
// proves R-ESCALATE-27
test('a live Claude escalation grant refuses another card and an appended repository', { skip, timeout: 2 * SESSION }, async (t) => {
  const made = await liveEscalation(t, { negative: true });
  assert.equal(made.results[0].exit, 0);
  const calls = callsOf(eventsOf(made.results[0].stdout)).filter(({ name }) => name === 'Bash');
  assert.deepEqual(calls.map(({ input }) => input.command), made.forbidden);
  for (const call of calls) assert.match(textOf(call.result), /requires approval/i, call.input.command);
  assert.deepEqual(made.held.sent.filter((args) => args[0] === 'issue'), [], 'neither forbidden command may reach gh');
  assert.ok(made.held.repository.issues.every(({ comments }) => comments.length === 0));
});

// Host reason: wiring.
// Ordinary decision counterpart: test/escalation-route.test.mjs :: Claude dispatch settings append only the exact card escalation rule with and without reach.
// proves R-ESCALATE-27
test('a live Claude escalation role posts its instructed note from main', { skip, timeout: 3 * SESSION }, async (t) => {
  const made = await liveEscalation(t, { routed: true });
  assert.equal(made.results.length, 2, 'the maker and routed role must both run');
  for (const result of made.results) {
    assert.equal(result.exit, 0);
    assert.doesNotMatch(result.stdout.toString('utf8'), /requires approval/i);
  }
  assertedLiveNote(made, 'pm', 'critical', ROLE_REASON);
  const start = made.events.find((event) => event.event === 'dispatch.start' && event.facts?.reason === ESCALATION_REASON);
  assert.ok(start?.workspace.endsWith('/escalation'), 'the routed role must run in its main directory');
  const initialized = eventsOf(made.results[1].stdout).find((event) => event.type === 'system' && event.subtype === 'init');
  assert.ok(initialized, 'the role must emit its init record');
  assert.ok(initialized.cwd.endsWith('/escalation/main'), initialized.cwd);
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

const PATH_BEFORE = 'before-1425\n';
const PATH_AFTER = 'after-1425\n';
const PATH_DENIAL = /requires approval|you haven't granted it yet|permission[^\n]*denied/i;

/** The one credential this fixture accepts; its value is never included in the refusal. */
function pathCredential() {
  const credential = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  assert.ok(credential, 'no credential: set CLAUDE_CODE_OAUTH_TOKEN in the owner Terminal before running the M8-29 live cells');
  return credential;
}

/** Runs the built session and retains the evidence its path assertions consume. */
async function recordedPathSession(t, { built, configuration, directory, prompt, target, forgeDirectory, retained }, runCommand) {
  const credential = pathCredential();
  const redact = (text) => String(text).split(credential).join('[token removed]');
  const diagnostic = (text) => t.diagnostic(redact(text));
  const retain = (name, bytes) => writeFileSync(join(retained, name), redact(bytes), { mode: 0o600 });
  const visibleEnvironment = { ...built.env, ...configuration };
  const env = { ...visibleEnvironment, CLAUDE_CODE_OAUTH_TOKEN: credential };
  const raw = await runCommand({ command: built.command, args: built.args, input: built.input,
    cwd: directory, directory, env, timeout: SESSION, emitter: { emit: (event, fields) => diagnostic(JSON.stringify({ event, ...fields })) } })
    .catch((failure) => { throw new Error(redact(failure.message)); });
  const result = { ...raw, stdout: Buffer.from(redact(raw.stdout)), stderr: Buffer.from(redact(raw.stderr)) };
  mkdirSync(retained, { recursive: true, mode: 0o700 });
  for (const stream of ['stdout', 'stderr']) retain(stream, result[stream]);
  const held = JSON.parse(redact(readFileSync(join(forgeDirectory, 'board.json'), 'utf8')));
  retain('forge.json', JSON.stringify(held, null, 2));
  retain('invocation.json', JSON.stringify({ command: built.command, args: built.args, prompt, env: visibleEnvironment, exit: result.exit }, null, 2));
  const readTarget = () => redact(readFileSync(target, 'utf8'));
  if (existsSync(target)) retain('target', readTarget());
  diagnostic(`M8-29 retained evidence: ${retained}; exit ${result.exit}; stderr: ${result.stderr.toString('utf8')}`);
  diagnostic(`M8-29 session directory: ${directory}; target: ${target}; environment: ${JSON.stringify(visibleEnvironment)}`);
  return { result, held, readTarget };
}

/** One initialized consumer and one real session; only the stand-in gh can receive a comment. */
async function cdSession(t, { name, tool, outside = false, deny = false, escalation = false }) {
  pathCredential();
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed past the refusing one');
  const base = scratch();
  const directory = repositoryAt(join(base, 'repository'), { README: 'M8-29 path fixture.\n' });
  gitIn(directory, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
  const initialized = await init({ target: directory });
  assert.equal(initialized.code, 0, initialized.text);
  const settingsFile = join(directory, '.claude/settings.json');
  assert.deepEqual(readFileSync(settingsFile), readFileSync(new URL('../templates/claude/settings.json', import.meta.url)));
  if (deny) {
    const declared = JSON.parse(readFileSync(settingsFile, 'utf8'));
    declared.permissions.deny.push('Edit(./.env)');
    writeFileSync(settingsFile, JSON.stringify(declared));
  }
  const agent = '.claude/agents/path-live.md';
  put(directory, agent, '---\n# ABOUTME: Follows only the M8-29 live path probe.\nname: path-live\ndescription: Makes the requested path call.\n---\nFollow the task exactly. Do not change settings, retry a denial, use another tool as a fallback, or request broader permissions.\n');
  put(directory, 'root.txt', PATH_BEFORE);
  put(directory, 'sub/existing.txt', PATH_BEFORE);
  put(directory, '.env', PATH_BEFORE);
  const beside = join(base, 'beside');
  mkdirSync(beside);
  const target = join(outside ? beside : directory, name);
  if (tool === 'Write') assert.equal(existsSync(target), false, 'a Write probe must start with no target file');
  else assert.equal(readFileSync(target, 'utf8'), PATH_BEFORE, 'an Edit probe must start with the original bytes');
  const forgeDirectory = join(base, 'forge');
  mkdirSync(forgeDirectory);
  const forge = installFakeGh(forgeDirectory, { repo: 'acme/widgets', project: 3 });
  seedRepository(forge, { issues: [{ number: 42, comments: [] }, { number: 43, comments: [] }] });
  const home = join(base, 'claude-home');
  const ghHome = join(base, 'gh-home');
  mkdirSync(home);
  mkdirSync(ghHome);
  const configuration = { CLAUDE_CONFIG_DIR: home, GH_CONFIG_DIR: ghHome, PATH: `${forgeDirectory}${delimiter}${pastRefusing()}` };
  const instruction = dispatchedEscalation({ instruction: escalationInstruction({ number: 42 }) }, 'd-11111111-2222-3333-4444-555555555555').instruction;
  const task = escalation
    ? `Acceptance item 1 cannot be met. Follow the escalation instruction below, with category ambiguous and item 1. Copy this exact field line:\nreason: ${ESCALATION_REASON}\nUse Write for the note, then the instruction's exact command, and end.\n${instruction}`
    : `${tool === 'Edit' ? `Call Read on ${JSON.stringify(target)}, then call Edit on that exact absolute path, replacing ${JSON.stringify(PATH_BEFORE)} with ${JSON.stringify(PATH_AFTER)}.` : `Call Write on ${JSON.stringify(target)} with content ${JSON.stringify(PATH_AFTER)}.`}\nAttempt the target tool exactly once even if you expect a denial. End after its result; never retry or use a fallback.`;
  const prompt = `First call Bash with exactly \`cd sub\`. Next call Bash with exactly \`pwd\`, as a separate call in this same session. Then do this task:\n${task}`;
  const { invocation, runCommand } = await fromCheckout();
  const built = await invocation({ agent, tier: 'standard', prompt, directory, card: 42, environment: configuration });
  const retained = join(process.env.RIGGER_1425_EVIDENCE_ROOT ?? join(dirname(dirname(realpathSync.native(process.env.TMPDIR))), '1425-live-evidence'), randomUUID());
  const { result, held, readTarget } = await recordedPathSession(t, { built, configuration, directory, prompt, target, forgeDirectory, retained }, runCommand);
  const calls = callsOf(eventsOf(result.stdout));
  t.diagnostic(`M8-29 tool calls and results: ${JSON.stringify(calls)}`);
  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(calls[0]?.name, 'Bash');
  assert.equal(calls[0]?.input.command, 'cd sub', 'the first call must move the shell');
  assert.ok(calls[0]?.result, 'cd sub must return a tool result');
  assert.notEqual(calls[0].result.is_error, true, 'cd sub must succeed');
  assert.equal(calls[1]?.name, 'Bash');
  assert.equal(calls[1]?.input.command, 'pwd', 'pwd must observe that same shell');
  assert.equal(textOf(calls[1]?.result).trim(), realpathSync.native(join(directory, 'sub')), 'pwd must print the real sub path after cd');
  const targetCalls = calls.filter((call) => call.name === tool && call.input.file_path === target);
  assert.equal(targetCalls.length, 1, 'the session must attempt its target tool exactly once');
  assert.ok(targetCalls[0].result, 'the target must return a tool result');
  assert.ok(calls.indexOf(targetCalls[0]) > 1, 'the target must follow cd and pwd');
  return { directory, target, call: targetCalls[0], calls, held, readTarget };
}

/** A successful tool result and independent file bytes must agree. */
function allowedPath(made) {
  assert.notEqual(made.call.result?.is_error, true, textOf(made.call.result));
  assert.doesNotMatch(textOf(made.call.result), PATH_DENIAL);
  assert.ok(existsSync(made.target), 'the requested file must exist');
  assert.equal(made.readTarget(), PATH_AFTER, 'the requested file must hold the edited or written bytes');
}

// Host reason: wiring.
// Ordinary decision counterpart: test/provider-claude.test.mjs :: M8-29: without reach, Edit(./**) is anchored at the dispatch real path for the whole tree.
// proves R-SAFE-10
test('M8-29 live: Edit changes an existing root file after cd sub', { skip, timeout: 2 * SESSION }, async (t) => {
  allowedPath(await cdSession(t, { name: 'root.txt', tool: 'Edit' }));
});

// Host reason: wiring.
// Ordinary decision counterpart: test/provider-claude.test.mjs :: M8-29: without reach, Edit(./**) is anchored at the dispatch real path for the whole tree.
// proves R-SAFE-10
test('M8-29 live: Write creates a root file after cd sub', { skip, timeout: 2 * SESSION }, async (t) => {
  allowedPath(await cdSession(t, { name: 'created.txt', tool: 'Write' }));
});

// Host reason: wiring.
// Ordinary decision counterpart: test/provider-claude.test.mjs :: M8-29: without reach, Edit(./**) is anchored at the dispatch real path for the whole tree.
// proves R-SAFE-10
test('M8-29 live: Edit still changes a sub file after cd sub', { skip, timeout: 2 * SESSION }, async (t) => {
  allowedPath(await cdSession(t, { name: 'sub/existing.txt', tool: 'Edit' }));
});

// Host reason: wiring.
// Ordinary decision counterpart: test/provider-claude.test.mjs :: M8-29: relative Read and Edit rules use only the declared per-rule copies and reached tree grants.
// proves R-SAFE-10
test('M8-29 live: Write beside the workspace is denied after cd sub and leaves no file', { skip, timeout: 2 * SESSION }, async (t) => {
  const made = await cdSession(t, { name: 'outside.txt', tool: 'Write', outside: true });
  assert.equal(made.call.result?.is_error, true);
  assert.match(textOf(made.call.result), PATH_DENIAL);
  assert.equal(existsSync(made.target), false, 'a denied outside Write must leave no file');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/provider-claude.test.mjs :: M8-29: without reach, relative Edit and Read denies are anchored at the dispatch real path.
// proves R-SAFE-10
test('M8-29 live: the declared root .env deny survives cd sub and leaves its bytes unchanged', { skip, timeout: 2 * SESSION }, async (t) => {
  const made = await cdSession(t, { name: '.env', tool: 'Edit', deny: true });
  assert.equal(made.call.result?.is_error, true);
  assert.match(textOf(made.call.result), PATH_DENIAL);
  assert.equal(made.readTarget(), PATH_BEFORE, 'a denied Edit must leave the root .env unchanged');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/escalation-route.test.mjs :: M8-29: the escalation instruction writes and posts from the directory this session started in without naming provider tools.
// proves R-ESCALATE-27
test('M8-29 live: after cd sub the instructed root escalation note reaches only card 42 byte for byte', { skip, timeout: 2 * SESSION }, async (t) => {
  const made = await cdSession(t, { name: '.rigger-escalation.md', tool: 'Write', escalation: true });
  assert.notEqual(made.call.result?.is_error, true, textOf(made.call.result));
  assert.doesNotMatch(textOf(made.call.result), PATH_DENIAL);
  assert.ok(existsSync(made.target), 'the note must be at the workspace root');
  const note = made.readTarget();
  assert.deepEqual(parseEscalationNote(note, 1), { category: 'ambiguous', item: 1, reason: ESCALATION_REASON, dispatch: 'd-11111111-2222-3333-4444-555555555555' });
  assert.deepEqual(made.held.repository.issues.map(({ number, comments }) => [number, comments.map(({ body }) => body)]), [[42, [note]], [43, []]], 'the forge must read --body-file relative to its own working directory and keep every note byte');
  assert.deepEqual(made.held.sent, [['issue', 'comment', '42', '--body-file', '.rigger-escalation.md']]);
});

/** A transport/evidence fixture; no CLI or forge process is started. */
function pathEvidenceFixture() {
  const base = scratch();
  const directory = join(base, 'repository');
  const forgeDirectory = join(base, 'forge');
  mkdirSync(directory);
  mkdirSync(forgeDirectory);
  const target = join(directory, 'target');
  return { directory, forgeDirectory, target, retained: join(base, 'retained'), prompt: 'fixture prompt',
    configuration: { CLAUDE_CONFIG_DIR: join(base, 'claude-home'), GH_CONFIG_DIR: join(base, 'gh-home'), PATH: '/fixture/bin' },
    built: { command: 'claude', args: ['-p'], input: Buffer.from('fixture prompt'), env: { CLAUDE_CODE_TMPDIR: join(directory, '.claude-tmp') } } };
}

// Owner-directed harness diagnostic: credential transport and evidence redaction, not a product path-rule claim.
// The runner double uses ARCHITECTURE.md's command result contract: exit plus captured stdout/stderr bytes.
test('M8-29 harness: only the explicit OAuth token reaches the session and no evidence or diagnostic retains it', async (t) => {
  const token = 'sk-ant-dummy-1425-not-a-credential';
  const variables = { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: 'other-dummy', GH_TOKEN: 'forge-dummy', GITHUB_TOKEN: 'github-dummy' };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const fixture = pathEvidenceFixture();
  writeFileSync(fixture.target, `target ${token}`);
  writeFileSync(join(fixture.forgeDirectory, 'board.json'), JSON.stringify({ note: token }));
  const diagnostics = [];
  let received;
  const made = await recordedPathSession({ diagnostic: (message) => diagnostics.push(message) }, fixture, async (request) => {
    received = request;
    request.emitter.emit('fixture.event', { message: token });
    return { exit: 0, stdout: Buffer.from(`stdout ${token}`), stderr: Buffer.from(`stderr ${token}`) };
  });
  assert.equal(received.env.CLAUDE_CODE_OAUTH_TOKEN, token, 'the session must receive the explicit OAuth token');
  assert.deepEqual(Object.keys(received.env).sort(), [...Object.keys(fixture.built.env), ...Object.keys(fixture.configuration), 'CLAUDE_CODE_OAUTH_TOKEN'].sort(), 'no other inherited credential or environment may reach the session');
  const files = readdirSync(fixture.retained, { recursive: true }).map((name) => join(fixture.retained, name)).filter((file) => statSync(file).isFile());
  assert.equal(files.length, 5, 'both streams, invocation, forge and target must be inspected');
  for (const file of files) assert.equal(readFileSync(file).includes(Buffer.from(token)), false, `credential retained in ${file}`);
  assert.equal(diagnostics.join('\n').includes(token), false, 'a diagnostic exposed the credential');
  assert.equal(made.result.stdout.includes(Buffer.from(token)), false, 'returned streams must be safe for later assertion diagnostics');
  assert.equal(JSON.stringify(made.held).includes(token), false, 'returned forge state must be safe for later assertion diagnostics');
  await assert.rejects(recordedPathSession({ diagnostic: (message) => diagnostics.push(message) }, fixture, async () => {
    throw new Error(`runner failure ${token}`);
  }), (failure) => {
    assert.equal(failure.message.includes(token), false, 'runner failure diagnostics must not expose the token');
    assert.match(failure.message, /runner failure \[token removed\]/);
    return true;
  });
});

// Owner-directed harness diagnostic: a missing fixture credential is a precondition failure, not path-rule evidence.
test('M8-29 harness: no credential fails before a session starts or evidence is written', async (t) => {
  const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous; });
  const fixture = pathEvidenceFixture();
  writeFileSync(join(fixture.forgeDirectory, 'board.json'), '{}');
  let started = false;
  await assert.rejects(recordedPathSession(t, fixture, async () => {
    started = true;
    return { exit: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }), /no credential.*CLAUDE_CODE_OAUTH_TOKEN/i);
  assert.equal(started, false, 'no session may start without the explicit credential');
  assert.equal(existsSync(fixture.retained), false, 'no evidence directory may be made without a credential');
});
