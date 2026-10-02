// ABOUTME: A gated live run of real `claude` sessions started with `reach` naming a planted `head`,
// showing route B loads nothing from it and lets the judge work there. Skipped unless RIGGER_LIVE_CLAUDE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SERVER, SESSION, callsOf, forgetting, pastRefusing, put, scratch, session, skip, textOf } from './claude-live.mjs';
import { onPath } from './on-path.mjs';

/*
 * What these runs reach. Each starts one real `claude -p` session, signed in as the host's owner,
 * which reaches Anthropic's service and nothing else: no forge, no board and no connector, since
 * the invocation withholds every one and no prompt asks for one. `npm` runs two scripts in `head`
 * that start `node` and exit; `head`'s `.npmrc` turns off npm's update and funding checks, so npm
 * makes no request. The MCP servers `main` declares and `head` plants are the stand-in from
 * `claude-live.mjs`, which opens no socket; `head`'s is meant never to start.
 *
 * The pair is built as #519's report built it ("The pair of directories"): `main` holds the role
 * and its skill, and `head`, a sibling, plants a `CLAUDE.md`, a skill, an agent, settings hooks and
 * an `.mcp.json`, each with a marker of its own (ruling 8 on #467, items 1 to 4).
 */

/** The marker each of `head`'s instruction sources carries. */
const PLANTED = {
  claudemd: 'OSPREY-head-claudemd-520',
  skill: 'OSPREY-head-skill-520',
  agent: 'OSPREY-head-agent-520',
  agentReply: 'OSPREY-head-agentreply-520',
  hook: 'OSPREY-head-hook-520',
  mcp: 'OSPREY-head-mcp-520',
};

/** The hook events `head`'s settings plant a hook on, each writing `HOOKRAN-<event>` in `head`. */
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse'];

/** The role file in `main`, which asks for no more than the prompt. */
const ROLE = [
  '---',
  'name: live',
  'description: A role for one live run.',
  '---',
  '',
  '# Live',
  '',
  'Do exactly what the prompt asks, with the fewest tool calls it needs, and nothing else.',
  '',
].join('\n');

/** A `main` and a `head` side by side under a scratch directory, by their real paths. */
function pair(t) {
  const base = scratch(t);
  const main = join(base, 'main');
  const head = join(base, 'head');
  forgetting(t, main);
  put(main, 'CLAUDE.md', 'If asked for markers, this directory\'s CLAUDE.md marker is OSPREY-main-claudemd-520.\n');
  put(main, '.claude/agents/live.md', ROLE);
  put(main, '.claude/skills/c520-main-skill/SKILL.md', '---\nname: c520-main-skill\ndescription: A skill for one live run.\n---\n\nThis skill\'s marker is OSPREY-main-skill-520.\n');
  // The consumer's own rules, one per command, as `templates/claude/settings.json` writes them, and
  // the working directory's own hook and MCP server, which load as they do with no `reach` (ruling 8
  // on #467, item 5; #519's report, c6).
  put(main, '.claude/settings.json', JSON.stringify({
    permissions: { allow: ['Bash(npm test:*)', 'Bash(npm run:*)'] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `/usr/bin/touch "${join(main, 'HOOKRAN-main-SessionStart')}"; echo OSPREY-main-hook-520` }] }] },
  }));
  put(main, 'server/server.cjs', SERVER('OSPREY-main-mcp-520'));
  put(main, '.mcp.json', JSON.stringify({ mcpServers: { c520main: { type: 'stdio', command: process.execPath, args: [join(main, 'server', 'server.cjs')] } } }));

  put(head, 'CLAUDE.md', `If asked for markers, this directory's CLAUDE.md marker is ${PLANTED.claudemd}.\n`);
  put(head, '.claude/skills/c520-head-skill/SKILL.md', `---\nname: c520-head-skill\ndescription: A planted skill, marker ${PLANTED.skill}.\n---\n\nThe marker is ${PLANTED.skill}.\n`);
  put(head, '.claude/agents/c520-head-agent.md', `---\nname: c520-head-agent\ndescription: A planted agent, marker ${PLANTED.agent}.\n---\n\nReply with exactly ${PLANTED.agentReply}.\n`);
  const hook = (event) => [{ hooks: [{ type: 'command', command: `/usr/bin/touch "${join(head, `HOOKRAN-${event}`)}"; echo ${PLANTED.hook}` }] }];
  put(head, '.claude/settings.json', JSON.stringify({ hooks: Object.fromEntries(EVENTS.map((event) => [event, hook(event)])) }));
  put(head, 'server/server.cjs', SERVER(PLANTED.mcp));
  put(head, '.mcp.json', JSON.stringify({ mcpServers: { c520head: { type: 'stdio', command: process.execPath, args: [join(head, 'server', 'server.cjs')] } } }));
  put(head, 'only-in-head.txt', 'OSPREY-headfile-520\n');
  put(head, '.npmrc', 'update-notifier=false\nfund=false\naudit=false\n');
  put(head, 'cwd.cjs', 'require(\'node:fs\').writeFileSync(\'npm-test-cwd.txt\', process.cwd());\nconsole.log(\'OSPREY-npmtest-520\');\n');
  put(head, 'package.json', JSON.stringify({ name: 'c520-head', version: '1.0.0', private: true, scripts: { test: 'node cwd.cjs', fail: 'node -e "process.exit(3)"' } }));
  return { main, head };
}

/** Starts the role in `main`, on `prompt`, with `reach` naming `head`, through this checkout's adapters. */
async function judged({ main, head }, prompt) {
  const adapters = {
    invocation: (await import('../src/substrate/providers/claude.mjs')).invocation,
    runCommand: (await import('../src/substrate/process.mjs')).runCommand,
  };
  return session(adapters, { agent: join(main, '.claude', 'agents', 'live.md'), tier: 'standard', prompt, directory: main, reach: [head] });
}

/** Logs what the run printed, so that a failure names it. */
function told(t, run) {
  t.diagnostic(`args: ${JSON.stringify(run.args)}`);
  t.diagnostic(`init: ${JSON.stringify(run.init)}`);
  t.diagnostic(`calls: ${JSON.stringify(callsOf(run.events))}`);
  t.diagnostic(`answer: ${JSON.stringify(run.answer)}`);
  t.diagnostic(`exit ${run.result.exit}; stderr: ${run.result.stderr.toString('utf8')}`);
}

/**
 * Ruling 8's item 1 and the hook item, held in every run: nothing of `head`'s is listed in the
 * `init` record, none of its markers is anywhere in the stream, none of its hooks ran and its
 * server never started.
 */
function nothingLoadedFrom(head, run) {
  assert.equal(run.result.exit, 0);
  assert.deepEqual(run.killed, [], 'the session left processes L0 killed');
  const { init } = run;
  assert.ok(init, 'the run printed no init record');
  assert.equal((init.skills ?? []).includes('c520-head-skill'), false, 'head\'s skill was listed');
  assert.equal(init.agents.includes('c520-head-agent'), false, 'head\'s agent was listed');
  assert.deepEqual(init.mcp_servers.filter(({ name }) => name === 'c520head'), [], 'head\'s MCP server was listed');
  const stream = run.result.stdout.toString('utf8');
  for (const [source, marker] of Object.entries(PLANTED)) assert.equal(stream.includes(marker), false, `head's ${source} marker reached the session`);
  assert.deepEqual(readdirSync(head).filter((name) => name.startsWith('HOOKRAN-')), [], 'a hook in head ran');
  assert.equal(existsSync(join(head, 'server', 'started')), false, 'head\'s MCP server started');
}

/**
 * Ruling 8's item 5, held in every run: the working directory's own sources load as they do with no
 * `reach`. Its `SessionStart` hook wrote its file, and its `.mcp.json` server is connected and
 * started. Its `CLAUDE.md` marker is asserted where the session is asked what it holds.
 */
function mainLoaded(main, run) {
  assert.ok(existsSync(join(main, 'HOOKRAN-main-SessionStart')), 'main\'s own SessionStart hook did not run');
  assert.deepEqual(run.init.mcp_servers.filter(({ name }) => name === 'c520main').map(({ status }) => status), ['connected'], 'main\'s own MCP server is not connected');
  assert.ok(existsSync(join(main, 'server', 'started')), 'main\'s own MCP server never started');
}

// proves R-LOOP-14
test('a live judge reaching head by route B is listed nothing of head\'s and names none of its markers, and head\'s hooks do not run', { skip, timeout: 2 * SESSION }, async (t) => {
  // Ruling 8 on #467, item 1; #519's report, c6.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const dirs = pair(t);
  const prompt = 'Do not call any tool. List every token beginning OSPREY- that your context holds, and say where each appeared, or say NONE.';
  const run = await judged(dirs, prompt);
  told(t, run);
  nothingLoadedFrom(dirs.head, run);
  mainLoaded(dirs.main, run);
  assert.match(run.answer, /OSPREY-main-claudemd-520/, 'main\'s own CLAUDE.md did not reach the session, so the answer shows nothing');
});

// proves R-LOOP-14
test('a live judge reaching head by route B cannot dispatch head\'s agent by name, and starts no subagent', { skip, timeout: 2 * SESSION }, async (t) => {
  // Ruling 8 on #467, item 2; #519's report, c7 and c13.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const dirs = pair(t);
  const prompt = 'Dispatch the subagent named c520-head-agent and report exactly what it replied. Do not do its work yourself. If you cannot dispatch it, say CANNOT and why.';
  const run = await judged(dirs, prompt);
  told(t, run);
  nothingLoadedFrom(dirs.head, run);
  mainLoaded(dirs.main, run);
  assert.deepEqual(run.events.filter((event) => event.parent_tool_use_id), [], 'a subagent started');
  assert.match(run.answer, /CANNOT/);
});

// proves R-EVIDENCE-6
test('a live judge reaching head by route B reads main\'s skill by path, and headless reads, writes, runs npm test and a failing command in head, with no permission denied', { skip, timeout: 2 * SESSION }, async (t) => {
  // Ruling 8 on #467, items 3 and 4; #519's report, c8, c15 and c19. Each Bash command is one
  // line whose parts each have a rule, since the shell's directory resets after every call.
  assert.ok(onPath('claude', pastRefusing()), 'no claude is installed on this PATH past the refusing one');
  const dirs = pair(t);
  const { main, head } = dirs;
  const prompt = [
    'Do these five steps in order, each with one tool call.',
    `1. Read the file ${join(main, '.claude', 'skills', 'c520-main-skill', 'SKILL.md')} and quote the marker it holds.`,
    `2. Read the file ${join(head, 'only-in-head.txt')} and quote the marker it holds.`,
    `3. Write the file ${join(head, 'written-by-session.txt')} holding exactly WRITTEN-520.`,
    `4. Run exactly this as one Bash command: cd ${head} && npm test`,
    `5. Run exactly this as one Bash command: cd ${head} && npm run fail`,
    'Then report each marker, and for each Bash command the exit code its tool result shows, or NONE SHOWN.',
  ].join('\n');
  const run = await judged(dirs, prompt);
  told(t, run);
  nothingLoadedFrom(head, run);
  mainLoaded(main, run);
  assert.match(run.answer, /OSPREY-main-skill-520/, 'main\'s skill was not read by path');
  assert.match(run.answer, /OSPREY-headfile-520/, 'the file only head holds was not read');
  assert.match(readFileSync(join(head, 'written-by-session.txt'), 'utf8'), /WRITTEN-520/);
  assert.equal(readFileSync(join(head, 'npm-test-cwd.txt'), 'utf8'), head, 'npm test did not run with head as its working directory');
  const failing = callsOf(run.events).filter(({ name, input }) => name === 'Bash' && input.command.includes('npm run fail'));
  assert.equal(failing.length, 1, JSON.stringify(callsOf(run.events)));
  assert.equal(failing[0].result?.is_error, true, 'the failing command\'s result is no error');
  assert.match(textOf(failing[0].result), /Exit code [1-9]\d*/, 'the failing command\'s result shows no exit code');
  const record = run.events.find((event) => event.type === 'result');
  assert.deepEqual(record.permission_denials, [], 'a permission prompt was left unanswered');
});
