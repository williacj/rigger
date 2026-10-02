// ABOUTME: A gated live run of a real `claude` session started from this checkout's Claude Code
// adapter, reading what it loaded from the CLI's own start record. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';

import { AGENT, SERVER, SESSION, callsOf, forgetting, pastRefusing, transcriptsOf, unclassified, withheldBy, put, scratch, session, skip, textOf } from './claude-live.mjs';
import { onPath } from './on-path.mjs';

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
  const base = scratch(t);
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

/** Every file under `directory`, by its path, or none where it does not exist. */
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).map((name) => join(directory, name)).filter((path) => statSync(path).isFile());
}

test('a live claude session started from the invocation writes a background task\'s output under the directory\'s own temporary directory, and none under /tmp', { skip, timeout: 2 * SESSION }, async (t) => {
  // Item 14 on #480, after ruling 9 on #467: `CLAUDE_CODE_TMPDIR` in the invocation's `env`. #473's
  // c33 found the output under `/tmp/claude-<uid>/<encoded working directory>/` without it. The
  // background task is a `Monitor`, which runs one `echo` and no Bash tool call.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const directory = join(scratch(t), 'repo');
  forgetting(t, directory);
  put(directory, '.claude/agents/live.md', AGENT('HERON-agentend-480c'));
  // The directory's own settings allow the one `Monitor`, and turn off tool search, so that
  // `Monitor` is offered at once rather than loaded by a `ToolSearch` call first.
  put(directory, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Monitor'] }, env: { ENABLE_TOOL_SEARCH: 'false' } }));
  const prompt = [
    'Start exactly one Monitor whose command is: echo HERON-background-480',
    'Wait for its event, then answer with the line it printed. Use no other tool.',
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
  assert.ok(kept.some((path) => readFileSync(path, 'utf8').includes('HERON-background-480')), 'no output under the directory\'s temporary directory holds the task\'s line');
  const outside = join('/tmp', `claude-${userInfo().uid}`, directory.replace(/[^a-zA-Z0-9]/g, '-'));
  assert.deepEqual(filesUnder(outside), [], `the task wrote under ${outside}`);
});
