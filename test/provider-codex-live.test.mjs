// ABOUTME: The gated live runs of the installed `codex` through the Codex adapter: its sign-in reader,
// a session in a directory declaring one MCP server, a judge dispatch from `main` reaching `head`,
// and a session under the owner's own credentials. Skipped unless RIGGER_LIVE_CODEX=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { agentAuth } from '../src/cli/doctor.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import * as codex from '../src/substrate/providers/codex.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { SERVER, pastRefusing, put } from './claude-live.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { onPath } from './on-path.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/*
 * What these runs reach. Each session is one real `codex exec`, signed in as the host's owner
 * through a link to the owner's `auth.json`, which reaches OpenAI's service and nothing else these
 * tests start. The MCP server the first run declares is `claude-live.mjs`'s stand-in, which opens
 * no socket. The judge's `gh` is the fake forge, a script on its PATH that answers from a file in
 * `main`, so its findings comment reaches no GitHub. No connector is declared, and the one the
 * first prompt asks for is meant to be absent. The probe and `codex login status` start no session.
 * `npm test` runs none of this: it skips every test here unless `RIGGER_LIVE_CODEX` is `1` (S5).
 *
 * The real `codex` is found as the Claude Code live runs find `claude`: on this process's PATH,
 * past the directory `npm test` puts its refusing one in (`test/suite.sh`).
 *
 * After every session, the dispatch's home is checked: its `auth.json` is still a symbolic link to
 * the owner's, and no regular `auth.json` is there (`R-SAFE-1`). Each test prints what the pull
 * request quotes on standard output, prefixed `c489-live`, and never a token value.
 */

const LIVE = process.env.RIGGER_LIVE_CODEX === '1';
const skip = LIVE ? false : 'a live run starts a real codex session; set RIGGER_LIVE_CODEX=1 to run it';

/** How long one session may run before L0 ends it. */
const SESSION = 600_000;

/** Prints `label` and `value` for the pull request to quote. */
const quote = (label, value) => process.stdout.write(`c489-live ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);

/** A scratch directory under `TMPDIR`, by its real path, removed when the test ends. */
const scratch = (prefix) => realpathSync.native(temporaryDirectory(prefix));

/** Puts the real `codex` on this process's PATH, which the probe reads, for the rest of the test. */
function realCodex(t) {
  const inherited = process.env.PATH;
  process.env.PATH = pastRefusing();
  t.after(() => { process.env.PATH = inherited; });
  const found = onPath('codex', process.env.PATH);
  assert.ok(found !== null, 'no installed codex is on the PATH past the refusing one');
  quote('codex', spawnSync(found, ['--version'], { encoding: 'utf8' }).stdout.trim());
}

/** Sets `name` in this process's environment to `value` for the rest of the test. */
function setFor(t, name, value) {
  const inherited = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (inherited === undefined) delete process.env[name];
    else process.env[name] = inherited;
  });
}

/** Every file under `directory`, by path, not following a symbolic link, each with whether it is one. */
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return [{ path, link: entry.isSymbolicLink() }];
  });
}

/** Holds the `R-SAFE-1` check every run ends with: `home`'s `auth.json` is a link to `owner`'s, and no regular `auth.json` is in it. */
function linkHolds(home, owner) {
  assert.ok(lstatSync(join(home, 'auth.json')).isSymbolicLink(), `${home}/auth.json is no longer a symbolic link`);
  assert.equal(readlinkSync(join(home, 'auth.json')), join(owner, 'auth.json'));
  const regular = filesUnder(home).filter((file) => !file.link && file.path.endsWith('/auth.json'));
  assert.deepEqual(regular, [], 'a regular auth.json is in the home');
  quote('link after the run', `${join(home, 'auth.json')} -> ${readlinkSync(join(home, 'auth.json'))}; regular auth.json files in the home: ${regular.length}`);
}

/** The rollout a session left under `home`, as its parsed lines. */
function rolloutIn(home, thread) {
  const files = filesUnder(join(home, 'sessions')).filter((file) => file.path.endsWith('.jsonl') && file.path.includes(thread));
  assert.equal(files.length, 1, `no single rollout for thread ${thread} under ${home}`);
  return { path: files[0].path, lines: readFileSync(files[0].path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

/** The `--json` events a run printed, one per line. */
const eventsOf = (stdout) => stdout.toString('utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));

/** The skill files a `host_skills` or probe block names, expanded through its root table, as absolute paths. */
function skillFiles(block) {
  const roots = new Map([...block.matchAll(/^- `(r\d+)` = `(.+)`$/gm)].map(([, key, path]) => [key, path]));
  return [...block.matchAll(/\(file: (r\d+)\/(.+)\)$/gm)].map(([, key, rest]) => join(roots.get(key), rest)).sort();
}

/** What the probe command lists, run again here as the adapter runs it, under `home`, in `directory`. */
function probeList(directory, home) {
  const args = ['-C', directory, '--disable', 'plugins', '--disable', 'apps', ...['browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser'].flatMap((feature) => ['--disable', feature]), 'debug', 'prompt-input'];
  const ran = spawnSync('codex', args, { cwd: directory, encoding: 'utf8', env: { ...gitEnvironment(), CODEX_HOME: home } });
  assert.equal(ran.status, 0, ran.stderr);
  const block = JSON.parse(ran.stdout).flatMap((message) => message.content ?? []).map((part) => part.text ?? '').find((text) => text.includes('<skills_instructions>'));
  return skillFiles(block);
}

/** The skill files a rollout's `world_state` `host_skills` lists. */
const hostSkills = (rollout) => skillFiles(rollout.lines.find((line) => line.type === 'world_state').payload.state.host_skills?.body ?? '');

/** The `-c skills.config` entries among `args`, as the paths they disable. */
const disabledBy = (args) => [...(args.find((arg) => arg.startsWith('skills.config=')) ?? '').matchAll(/path = ("(?:[^"\\]|\\.)*")/g)].map((match) => JSON.parse(match[1])).sort();

/**
 * Runs the invocation the Codex module answers for `request` through L0's process adapter, under
 * this process's environment with the module's variables set, in the order ruling 9 on #467 gives
 * `roleDispatch`, and hands back what it printed and the home it ran under.
 */
async function session(request, { args: edit = (args) => args } = {}) {
  const killed = [];
  const emitter = { emit: (event, fields) => killed.push({ event, ...fields }) };
  const invoked = await codex.invocation({ ...request, emitter });
  const args = edit(invoked.args);
  const env = { ...gitEnvironment(), ...invoked.env };
  const result = await runCommand({ command: invoked.command, args, input: invoked.input, cwd: request.directory, env, timeout: SESSION, emitter });
  const events = eventsOf(result.stdout);
  const thread = events.find((event) => event.type === 'thread.started')?.thread_id;
  return { args, home: invoked.env.CODEX_HOME, result, events, thread, killed, answer: events.filter((event) => event.item?.type === 'agent_message').map((event) => event.item.text).join('\n') };
}

/** The markers a stand-in for the owner's own skills carries, one under each root `R-SAFE-6` names. */
const OWNER_SKILLS = { agents: 'HERON-c489-owner-agents-6633', codexHome: 'HERON-c489-owner-codexhome-6644' };

test('the Codex reader answers what the installed codex says of whether it is signed in, signed in and signed out', { skip }, async (t) => {
  // `D16` rules 1 and 2: Codex owns whether it is signed in. The expected value is read here from
  // the CLI's own words, not taken from the module's reader. Signed out is asked of an empty home.
  realCodex(t);
  for (const home of [undefined, scratch('rigger-codex-live-empty-')]) {
    if (home !== undefined) setFor(t, 'CODEX_HOME', home);
    const tool = spawnSync('codex', ['login', 'status'], { encoding: 'utf8', env: gitEnvironment() });
    const said = `${tool.stderr}${tool.stdout}`;
    const stated = said.startsWith('Logged in using ') ? true : said.startsWith('Not logged in') ? false : null;

    const here = await agentAuth({ adapters: { codex }, emitter: { emit: (event) => assert.fail(`the check emitted ${event}`) } });

    assert.equal(here.ok, stated, `${here.detail} against exit ${tool.status}`);
    quote(home === undefined ? 'login status, the owner\'s home' : 'login status, an empty home', { exit: tool.status, signedIn: stated, check: here.detail });
  }
});

// proves R-SAFE-7
test('a session in a directory declaring one MCP server loads exactly that server, calls its tool, carries the agent file\'s last sentence, finds no connected app, and loads none of the owner\'s own skills', { skip }, async (t) => {
  realCodex(t);
  const base = scratch('rigger-codex-live-mcp-');
  const directory = join(base, 'repo');
  const made = join(base, 'scratch', 'live');
  mkdirSync(made, { recursive: true });
  put(directory, 'server/server.cjs', SERVER('HERON-c489-mcp-4411'));
  put(directory, '.codex/config.toml', [
    '# ABOUTME: the declaration of one live run',
    'sandbox_mode = "workspace-write"',
    '[sandbox_workspace_write]',
    'network_access = true',
    'exclude_tmpdir_env_var = true',
    'exclude_slash_tmp = true',
    '[mcp_servers.c489live]',
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(join(directory, 'server', 'server.cjs'))}]`,
    'default_tools_approval_mode = "approve"',
    '',
  ].join('\n'));
  put(directory, '.agents/skills/c489-repo-skill/SKILL.md', '---\nname: c489-repo-skill\ndescription: A repository skill for one live run.\n---\nBody.\n');
  put(directory, 'AGENTS.md', '# A live run\n');
  put(directory, '.claude/agents/live.md', '---\nname: live\ndescription: A role for one live run.\n---\n\n# Live\n\nAnswer briefly. Run no shell command.\n\nThe marker at the end of this role file is HERON-c489-agent-5522.\n');
  repositoryAt(directory);
  // A stand-in for the owner's own skill roots: `$HOME/.agents/skills/` and the owner's Codex
  // home's `skills/`, each holding one skill carrying a marker. The owner's Codex home here links
  // its `auth.json` to the owner's real one, so the session signs in as the owner.
  const home = join(base, 'owner-home');
  const ownerCodex = join(home, '.codex');
  put(home, `.agents/skills/c489-owner-agents-skill/SKILL.md`, `---\nname: c489-owner-agents-skill\ndescription: The owner's own skill, marker ${OWNER_SKILLS.agents}.\n---\nThe marker is ${OWNER_SKILLS.agents}.\n`);
  put(ownerCodex, `skills/c489-owner-codexhome-skill/SKILL.md`, `---\nname: c489-owner-codexhome-skill\ndescription: The owner's own skill, marker ${OWNER_SKILLS.codexHome}.\n---\nThe marker is ${OWNER_SKILLS.codexHome}.\n`);
  symlinkSync(join(homedir(), '.codex', 'auth.json'), join(ownerCodex, 'auth.json'));
  setFor(t, 'HOME', home);
  setFor(t, 'CODEX_HOME', ownerCodex);
  const request = {
    agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', directory, scratch: made,
    prompt: 'Do these three things and nothing else. 1. Call the echo tool of the c489live MCP server once and quote its answer. 2. Quote the marker at the end of your role file. 3. Use the Gmail connected app, or any other ChatGPT app or connector, to list one email, and say plainly whether any such app is available to you. Run no shell command.\n',
  };

  const ran = await session(request);

  assert.equal(ran.result.exit, 0, ran.result.stderr.toString('utf8'));
  const record = ran.result.stdout.toString('utf8');
  quote('stream', record);
  const calls = ran.events.filter((event) => event.type === 'item.completed' && event.item.type === 'mcp_tool_call').map((event) => event.item);
  assert.deepEqual(calls.map((call) => [call.server, call.tool, call.status]), [['c489live', 'echo', 'completed']]);
  assert.equal(calls[0].result.content[0].text, 'HERON-c489-mcp-4411');
  assert.match(ran.answer, /HERON-c489-agent-5522/);
  const servers = JSON.parse(execFileSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', env: { ...gitEnvironment(), CODEX_HOME: ran.home } }));
  quote('codex mcp list --json under the home', servers.map((server) => server.name));
  assert.deepEqual(servers.map((server) => server.name), ['c489live']);
  assert.ok(existsSync(join(directory, 'server', 'started')), 'the declared server never started');
  for (const marker of Object.values(OWNER_SKILLS)) assert.ok(!record.includes(marker), `${marker} reached the session's --json record`);
  const probed = probeList(directory, ran.home);
  quote('probe list', probed);
  assert.ok(probed.includes(join(home, '.agents', 'skills', 'c489-owner-agents-skill', 'SKILL.md')), 'the probe did not list the owner\'s $HOME/.agents skill, so its absence proves nothing');
  const rollout = rolloutIn(ran.home, ran.thread);
  for (const marker of Object.values(OWNER_SKILLS)) assert.ok(!JSON.stringify(rollout.lines).includes(marker), `${marker} reached the session's rollout`);
  quote('host_skills, the session', hostSkills(rollout));
  quote('disabled by the invocation', disabledBy(ran.args));
  assert.deepEqual(hostSkills(rollout), probed.filter((skill) => !disabledBy(ran.args).includes(skill)));
  quote('answer', ran.answer);
  assert.deepEqual(ran.events.filter((event) => event.item?.type === 'command_execution'), [], 'the session ran a shell command');
  linkHolds(ran.home, ownerCodex);
});

test('under the same home, a session the skill toggles are left off for loads exactly the skills the probe lists', { skip }, async (t) => {
  // The probe exists to list every skill a session would load (ruling 18, A2). This session is the
  // invocation with its `skills.config` override taken out, so nothing is disabled, and its
  // rollout's `host_skills` is compared with the probe's list under the same home.
  realCodex(t);
  const base = scratch('rigger-codex-live-agree-');
  const directory = join(base, 'repo');
  const made = join(base, 'scratch', 'live');
  mkdirSync(made, { recursive: true });
  put(directory, '.codex/config.toml', '# ABOUTME: the declaration of one live run\nsandbox_mode = "workspace-write"\n');
  put(directory, '.agents/skills/c489-repo-skill/SKILL.md', '---\nname: c489-repo-skill\ndescription: A repository skill for one live run.\n---\nBody.\n');
  put(directory, '.claude/agents/live.md', '# Live\n\nReply with the single word OK. Run no shell command.\n');
  repositoryAt(directory);
  const owner = scratch('rigger-codex-live-owner-');
  symlinkSync(join(homedir(), '.codex', 'auth.json'), join(owner, 'auth.json'));
  setFor(t, 'CODEX_HOME', owner);
  const untoggled = (args) => args.filter((arg, at) => !arg.startsWith('skills.config=') && !(arg === '-c' && args[at + 1]?.startsWith('skills.config=')));

  const ran = await session({ agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', directory, scratch: made, prompt: 'Reply OK.\n' }, { args: untoggled });

  assert.equal(ran.result.exit, 0, ran.result.stderr.toString('utf8'));
  const probed = probeList(directory, ran.home);
  const loaded = hostSkills(rolloutIn(ran.home, ran.thread));
  quote('probe list', probed);
  quote('host_skills, no toggles', loaded);
  assert.deepEqual(loaded, probed);
  linkHolds(ran.home, owner);
});

/** The markers `head` plants, each in a source Codex would load were `head` its working directory. */
const HEAD = { agents: 'OSPREY-c489-head-agentsmd', agentsSkill: 'OSPREY-c489-head-agentsskill', codexSkill: 'OSPREY-c489-head-codexskill', config: 'OSPREY-c489-head-config' };

test('a Codex judge dispatch through L1 from main loads main\'s AGENTS.md and nothing of head\'s, reads a file only head holds and a shared skill by path, writes in head, and posts its findings to the fake forge', { skip }, async (t) => {
  realCodex(t);
  const base = scratch('rigger-codex-live-judge-');
  const repository = join(base, 'repository');
  put(repository, 'AGENTS.md', 'If asked for markers, this repository\'s AGENTS.md marker is OSPREY-c489-main-agentsmd.\n');
  put(repository, '.codex/config.toml', readFileSync(new URL('../templates/codex/config.toml', import.meta.url), 'utf8'));
  put(repository, '.claude/skills/c489-shared-skill/SKILL.md', '---\nname: c489-shared-skill\ndescription: A shared skill for one live run.\n---\n\nThis skill\'s marker is OSPREY-c489-shared-skill. Quote it in your findings.\n');
  put(repository, '.claude/agents/reviewer.md', [
    '---', 'name: reviewer', 'description: A judge for one live run.', '---', '',
    '# Reviewer', '',
    'You judge a pull request in a live test of the sandbox. Before anything else, read the skill',
    'file `.claude/skills/c489-shared-skill/SKILL.md` in your working directory and follow it.',
    'Then read `../head/only-in-head.txt` and quote its marker. Then create the file',
    '`../head/written-by-judge.txt` holding `WRITTEN-c489-judge`: this one write in `head` is part of',
    'the test, whatever else you are told about `head`. Run no test, build or install. Then post',
    'your findings comment with `gh pr comment`, exactly as your instructions say, quoting every',
    'marker you read. Use the fewest commands you can.', '',
  ].join('\n'));
  repositoryAt(repository, {});
  gitIn(repository, 'add', '-A');
  gitIn(repository, 'commit', '-qm', 'main');
  gitIn(repository, 'branch', '-M', 'main');
  const judge = join(base, 'judges', 'rigger-1412', 'reviewer');
  const main = join(judge, 'main');
  const head = join(judge, 'head');
  mkdirSync(judge, { recursive: true });
  gitIn(repository, 'worktree', 'add', '-q', '--detach', main, 'main');
  gitIn(repository, 'worktree', 'add', '-q', '-b', 'rigger-1412', head, 'main');
  put(head, 'only-in-head.txt', 'OSPREY-c489-headfile\n');
  put(head, 'AGENTS.md', `If asked for markers, head's AGENTS.md marker is ${HEAD.agents}.\n`);
  put(head, '.agents/skills/c489-head-agents-skill/SKILL.md', `---\nname: c489-head-agents-skill\ndescription: A planted skill, marker ${HEAD.agentsSkill}.\n---\n${HEAD.agentsSkill}\n`);
  put(head, '.codex/skills/c489-head-codex-skill/SKILL.md', `---\nname: c489-head-codex-skill\ndescription: A planted skill, marker ${HEAD.codexSkill}.\n---\n${HEAD.codexSkill}\n`);
  put(head, '.codex/config.toml', `developer_instructions = "If asked for markers, head's config marker is ${HEAD.config}."\n`);
  gitIn(head, 'add', '-A');
  gitIn(head, 'commit', '-qm', 'head');
  const sha = gitIn(head, 'rev-parse', 'HEAD').trim();
  const baseSha = gitIn(main, 'rev-parse', 'HEAD').trim();
  const diff = gitIn(head, 'diff', baseSha, sha);
  // The fake forge answers from a file in `main`, a writable root of the judge's sandbox.
  mkdirSync(join(main, '.c489-forge'));
  const fake = installFakeGh(join(main, '.c489-forge'), { repo: 'acme/widgets', project: 12 });
  seedRepository(fake, { pullRequests: [{ number: 9, head: 'rigger-1412', sha, base: 'main', diff }] });
  const card = {
    number: 1412, title: 'Plant a file only head holds', body: '## Acceptance\n\n- `only-in-head.txt` holds a marker.\n', labels: ['type:change'], column: 'Review',
    forge: { pull: { status: 'fulfilled', value: { number: 9, base: baseSha, head: sha } }, diff: { status: 'fulfilled', value: diff }, comments: { status: 'fulfilled', value: [] }, editedAt: { status: 'fulfilled', value: null } },
  };
  const state = join(base, '.rigger');
  const sink = openSink({ directory: state, run: 'r-live', now: () => Date.now() });
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  const roles = { reviewer: { agent: '.claude/agents/reviewer.md', provider: 'codex', tier: 'standard' } };
  const answered = judgeAnswer(card, kinds, undefined, { roles, sink });
  assert.equal(answered.action, 'judge', JSON.stringify(answered));
  const [answer] = answered.judges;
  const scratchBase = join(base, 'scratch', 'rigger-1412');
  mkdirSync(scratchBase, { recursive: true });
  const env = { ...process.env, PATH: `${dirname(fake.gh)}${delimiter}${pastRefusing()}` };

  const handed = await roleDispatch({ answer, cwd: main, directory: judge, scratch: scratchBase, repository, reach: [head], env, sink, id: 'd-live-judge', card: 1412 });
  const result = await dispatch({ id: 'd-live-judge', card: 1412, directory: state, sink, ...handed, timeout: SESSION });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const events = eventsOf(result.stdout);
  const thread = events.find((event) => event.type === 'thread.started').thread_id;
  const home = handed.env.CODEX_HOME;
  quote('judge args', handed.args.map((arg) => (arg.startsWith('developer_instructions=') ? 'developer_instructions=<the agent file>' : arg)));
  quote('judge stream', result.stdout.toString('utf8'));
  const rollout = rolloutIn(home, thread);
  const context = rollout.lines.find((line) => line.type === 'turn_context').payload;
  const world = rollout.lines.find((line) => line.type === 'world_state').payload.state;
  quote('turn_context sandbox_policy', context.sandbox_policy);
  quote('world_state agents_md', world.agents_md);
  quote('world_state host_skills', world.host_skills);
  assert.equal(context.sandbox_policy.type, 'workspace-write');
  assert.ok((context.sandbox_policy.writable_roots ?? []).map((root) => realpathSync.native(root)).includes(realpathSync.native(head)), JSON.stringify(context.sandbox_policy));
  assert.equal(realpathSync.native(world.agents_md.directory), realpathSync.native(main));
  assert.ok(!JSON.stringify(world.host_skills ?? {}).includes(head), 'a skill under head is in the session\'s skill list');
  const whole = JSON.stringify(rollout.lines);
  for (const marker of Object.values(HEAD)) assert.ok(!whole.includes(marker), `${marker} from head reached the session's rollout`);
  assert.ok(whole.includes('OSPREY-c489-main-agentsmd'), 'main\'s AGENTS.md never reached the session');
  const listing = readdirSync(head);
  quote('head after the run', listing);
  assert.ok(listing.includes('written-by-judge.txt'), 'the judge wrote nothing in head');
  const held = JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8')).repository.pullRequests[0].comments;
  quote('fake forge comments', held);
  assert.equal(held.length, 1);
  assert.equal(held[0].body.split('\n')[0].trim(), `Findings at ${sha} by reviewer`);
  assert.match(held[0].body, /OSPREY-c489-headfile/);
  assert.match(held[0].body, /OSPREY-c489-shared-skill/);
  linkHolds(home, join(homedir(), '.codex'));
});

test('a session under the owner\'s own credentials lands its rollout under its home, adds nothing to the owner\'s sessions, and keeps its auth.json a link through any token refresh', { skip }, async (t) => {
  // Nothing here writes the owner's credential files. A refresh happens where Codex finds the
  // token due for one, by the owner's `last_refresh` (#473's report: the token was last refreshed
  // 2026-09-26T02:11:32Z). Its values are read to search the home for them, and never printed.
  realCodex(t);
  const owner = join(homedir(), '.codex');
  const credentials = () => JSON.parse(readFileSync(join(owner, 'auth.json'), 'utf8'));
  const before = credentials();
  quote('owner last_refresh before', before.last_refresh);
  const base = scratch('rigger-codex-live-owner-');
  const directory = join(base, 'repo');
  const made = join(base, 'scratch', 'live');
  mkdirSync(made, { recursive: true });
  put(directory, '.codex/config.toml', '# ABOUTME: the declaration of one live run\nsandbox_mode = "workspace-write"\n');
  put(directory, '.claude/agents/live.md', '# Live\n\nReply with the single word OK. Run no shell command.\n');
  repositoryAt(directory);
  if (process.env.CODEX_HOME !== undefined) setFor(t, 'CODEX_HOME', owner);

  const ran = await session({ agent: join(directory, '.claude', 'agents', 'live.md'), tier: 'standard', directory, scratch: made, prompt: 'Reply OK.\n' });

  assert.equal(ran.result.exit, 0, ran.result.stderr.toString('utf8'));
  const after = credentials();
  quote('owner last_refresh after', after.last_refresh);
  quote('refreshed during the run', after.last_refresh !== before.last_refresh);
  linkHolds(ran.home, owner);
  const listing = filesUnder(ran.home).filter((file) => !file.path.includes('/skills/.system/')).map((file) => `${file.link ? 'link ' : ''}${file.path.slice(ran.home.length + 1)}`);
  quote('home listing', listing);
  // Every regular file under the home is searched for each token value, old and new; a link is
  // not followed, since the one link there is the owner's own file.
  const values = [before, after].flatMap((held) => [held.tokens?.access_token, held.tokens?.refresh_token]).filter((value) => typeof value === 'string' && value.length > 0);
  assert.ok(values.length > 0, 'the owner\'s auth.json holds no token to search for');
  const carrying = filesUnder(ran.home).filter((file) => !file.link).filter((file) => {
    const bytes = readFileSync(file.path);
    return values.some((value) => bytes.includes(value));
  });
  quote('files in the home carrying a token value', carrying.map((file) => file.path));
  assert.deepEqual(carrying, []);
  const rollout = rolloutIn(ran.home, ran.thread);
  quote('rollout', rollout.path);
  const owned = filesUnder(join(owner, 'sessions')).filter((file) => file.path.includes(ran.thread));
  quote('owner sessions files from this thread', owned.map((file) => file.path));
  assert.deepEqual(owned, []);
});
