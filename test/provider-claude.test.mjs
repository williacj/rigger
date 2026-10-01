// ABOUTME: Tests the Claude Code provider adapter: the command line and standard input its
// invocation answers for an agent file, a tier, a prompt and a directory, and what it refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as claude from '../src/substrate/providers/claude.mjs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A fresh directory under `TMPDIR`, by its real path, removed when the test ends. */
function scratch(t) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'rigger-claude-adapter-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A consumer's repository under `t`'s scratch, holding the role's agent file. */
function consumer(t) {
  const directory = join(scratch(t), 'repo');
  mkdirSync(join(directory, '.claude', 'agents'), { recursive: true });
  const agent = join(directory, '.claude', 'agents', 'engineer.md');
  writeFileSync(agent, '---\nname: engineer\n---\n\n# Engineer\n');
  return { directory, agent };
}

/** Writes `value` as JSON at `path` under `directory`, making its parents. */
function put(directory, path, value) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), JSON.stringify(value));
}

/** The invocation for `directory`'s agent at `tier`, with `prompt` and any other input given. */
const invoked = ({ directory, agent }, more = {}) => claude.invocation({ agent, tier: 'standard', prompt: 'the prompt', directory, ...more });

/** The value that follows `flag` in `args`, or undefined where `flag` is absent. */
function after(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

/** The settings the invocation passes in `--settings`, parsed. */
const settings = (args) => JSON.parse(after(args, '--settings'));

test('the adapter map names the Claude Code module for `claude`', () => {
  // Ruling 1 Q1 on #467: one module per agent CLI, each found by its provider's name.
  assert.equal(ADAPTERS.claude, claude);
  assert.equal(claude.name, 'claude');
});

test('the invocation hands the prompt over as standard input, as its bytes, and no argument holds it', async (t) => {
  // A prompt carrying a diff runs past the argument-length limit (ruling 1 Q1), and an argument is
  // readable by every user of the host in the process table.
  const repo = consumer(t);
  const prompt = 'Judge the work at HEAD. – a line with a dash outside ASCII\n';
  const { input, args } = await invoked(repo, { prompt });
  assert.ok(Buffer.from(input).equals(Buffer.from(prompt, 'utf8')), 'the input is the prompt\'s bytes');
  assert.deepEqual(args.filter((arg) => arg.includes('Judge the work')), []);
  assert.ok(args.includes('-p'), 'the CLI runs headless, reading its prompt from standard input');
});

test('the invocation names the CLI by its command name, never by a path', async (t) => {
  // `R-SAFE-5` and ruling 2 AQ1: the CLI is the one on the path L1 hands the dispatch.
  const { command } = await invoked(consumer(t));
  assert.equal(command, 'claude');
});

test('tier standard selects sonnet and tier high selects opus, the models #473\'s report recommends', async (t) => {
  // `docs/spikes/what-headless-sessions-load.md`, "Recommendation", item 7, from run c32.
  const repo = consumer(t);
  assert.equal(after((await invoked(repo, { tier: 'standard' })).args, '--model'), 'sonnet');
  assert.equal(after((await invoked(repo, { tier: 'high' })).args, '--model'), 'opus');
});

test('a tier other than standard or high is refused, naming the tier', async (t) => {
  // `O4`: Rigger fixes the tier set. The defect this catches is a tier read as no `--model`,
  // where the CLI picks the owner's own default model.
  const repo = consumer(t);
  for (const tier of ['low', 'constructor', 'Standard']) {
    await assert.rejects(invoked(repo, { tier }), (failure) => failure.message.includes(`\`${tier}\``));
  }
});

test('the invocation passes no flag or setting that skips or widens the CLI\'s permission checks', async (t) => {
  // Ruling 1 Q1: the consumer's own provider settings decide what the agent may run unprompted.
  // Each flag below is one `claude --help` lists, on Claude Code 2.1.287, as bypassing,
  // pre-approving or widening what the session may do.
  const repo = consumer(t);
  writeFileSync(join(repo.directory, '.mcp.json'), '{"mcpServers":{}}');
  const { args } = await invoked(repo);
  const widening = [
    '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--permission-mode',
    '--permission-prompts', '--permission-prompt-tool', '--allowedTools', '--allowed-tools', '--add-dir',
    '--tools', '--chrome', '--plugin-dir', '--plugin-url',
  ];
  assert.deepEqual(args.filter((arg) => widening.includes(arg.split('=')[0])), []);
  const given = settings(args);
  assert.equal(given.permissions, undefined, 'the settings carry no permission rule');
  assert.equal(given.additionalDirectories, undefined);
});

// proves R-SAFE-7
test('given a directory holding .mcp.json, the session loads that file\'s servers and no other MCP configuration', async (t) => {
  // Report, "One MCP server declared": `--strict-mcp-config` withholds every connector and plugin
  // server, and the directory's own file with them, which `--mcp-config` has to name again (c2,
  // c5, c6).
  const repo = consumer(t);
  writeFileSync(join(repo.directory, '.mcp.json'), '{"mcpServers":{}}');
  const { args } = await invoked(repo);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(after(args, '--mcp-config'), join(repo.directory, '.mcp.json'));
});

// proves R-SAFE-7
test('given a directory holding no .mcp.json, the session loads no MCP server', async (t) => {
  const { args } = await invoked(consumer(t));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args.includes('--mcp-config'), false);
});

test('the invocation keeps user and local settings, user hooks, auto-memory and every CLAUDE.md above the directory out of the session', async (t) => {
  // Report, "Recommendation", items 1 and 3: `--setting-sources project` withholds user settings,
  // user hooks and the user `CLAUDE.md` (r1-c16); `autoMemoryEnabled: false` withholds the memory
  // every worktree of a repository shares (c22); `claudeMdExcludes` withholds a parent's
  // `CLAUDE.md`, which reaches the session under both flags (c10, c36).
  const repo = consumer(t);
  const { args } = await invoked(repo);
  assert.equal(after(args, '--setting-sources'), 'project');
  const given = settings(args);
  assert.equal(given.autoMemoryEnabled, false);
  const above = [];
  for (let at = dirname(repo.directory); ; at = dirname(at)) {
    above.push(at === '/' ? '/CLAUDE.md' : `${at}/CLAUDE.md`);
    if (at === '/') break;
  }
  for (const file of above) assert.ok(given.claudeMdExcludes.includes(file), `${file} is not excluded`);
  assert.equal(given.claudeMdExcludes.includes(join(repo.directory, 'CLAUDE.md')), false, 'the directory\'s own CLAUDE.md is excluded');
});

test('the invocation excludes the CLAUDE.md above the directory as given, where that is not its real path', async (t) => {
  // macOS names `/tmp` and `/var` through links. Claude Code walks up from the directory it was
  // started in, so each spelling's ancestors are excluded.
  const repo = consumer(t);
  const link = join(scratch(t), 'linked');
  symlinkSync(repo.directory, link);
  const given = settings((await invoked({ directory: link, agent: join(link, '.claude', 'agents', 'engineer.md') })).args);
  assert.ok(given.claudeMdExcludes.includes(join(dirname(link), 'CLAUDE.md')));
  assert.ok(given.claudeMdExcludes.includes(join(dirname(repo.directory), 'CLAUDE.md')));
});

test('a directory under a path holding a glob character is refused, naming the path, since its CLAUDE.md exclusions would match other files', async (t) => {
  // `claudeMdExcludes` holds globs. An ancestor named `set[1]` would exclude `set1/CLAUDE.md` and
  // leave its own in the session.
  const base = scratch(t);
  for (const name of ['star*', 'brace{x}', 'set[1]', 'at@(x)']) {
    const directory = join(base, name, 'repo');
    mkdirSync(directory, { recursive: true });
    await assert.rejects(
      claude.invocation({ agent: join(directory, 'a.md'), tier: 'standard', prompt: 'p', directory }),
      (failure) => failure.message.includes(directory),
    );
  }
});

test('given reach naming a directory, the invocation is refused, naming reach and #520, and answers no command', async (t) => {
  // Ruling 8 on #467: `--add-dir` loads the reached directory's skills and agents, against
  // `R-LOOP-14`, so no judge is started with a grant until #520 carries a route #519 measured.
  const repo = consumer(t);
  const reached = scratch(t);
  await assert.rejects(invoked(repo, { reach: [reached] }), (failure) => {
    assert.match(failure.message, /`reach`/);
    assert.match(failure.message, /#520/);
    return true;
  });
  const { args } = await invoked(repo, { reach: [] });
  assert.equal(args.includes('--add-dir'), false);
});

test('the invocation hands the session the permission rules the directory\'s own settings declare, and no other permission setting from them', async (t) => {
  // Report, "A command the directory's settings do not allow": a `-p` session ignores an untrusted
  // directory's own `permissions.allow` (c38), and honours the same rule passed in `--settings`
  // (c42). So the consumer's own rules are what decide (ruling 1 Q1), and a mode or a directory
  // that would skip or widen the checks is not carried across.
  const repo = consumer(t);
  const declared = { allow: ['mcp__c480__echo', 'Bash(npm test)'], deny: ['WebFetch'], ask: ['Bash(git push:*)'] };
  put(repo.directory, '.claude/settings.json', { permissions: { ...declared, defaultMode: 'bypassPermissions', additionalDirectories: ['/'] }, hooks: {} });
  assert.deepEqual(settings((await invoked(repo)).args).permissions, declared);
});

test('given no settings file, or one declaring no permissions, the invocation hands the session no permission rule', async (t) => {
  const repo = consumer(t);
  assert.equal(settings((await invoked(repo)).args).permissions, undefined);
  put(repo.directory, '.claude/settings.json', { hooks: {} });
  assert.equal(settings((await invoked(repo)).args).permissions, undefined);
});

test('a settings file that is no JSON object is refused, naming the file, since the CLI would silently ignore it', async (t) => {
  // `claude --help`, `-p`: "Settings files that fail validation are silently ignored in this mode".
  const repo = consumer(t);
  mkdirSync(join(repo.directory, '.claude'), { recursive: true });
  writeFileSync(join(repo.directory, '.claude', 'settings.json'), '{ "permissions": ');
  await assert.rejects(invoked(repo), (failure) => failure.message.includes(join(repo.directory, '.claude', 'settings.json')));
});

test('the invocation withholds the tools that act through the owner\'s own account', async (t) => {
  // `R-SAFE-9`: a built-in tool that acts through the owner's own sessions or login counts as
  // declared only where the repository declares it. Claude Code 2.1.287 offers three, read off
  // #480's live run's `init` record: `RemoteTrigger` starts the owner's cloud routines,
  // `PushNotification` notifies the owner's devices, and `DesignSync` writes to the owner's
  // claude.ai designs. `--no-chrome` keeps out Claude in Chrome, which drives the owner's browser.
  const { args } = await invoked(consumer(t));
  const withheld = after(args, '--disallowedTools').split(',');
  for (const tool of ['RemoteTrigger', 'PushNotification', 'DesignSync']) assert.ok(withheld.includes(tool), tool);
  assert.ok(args.includes('--no-chrome'));
});

test('the invocation withholds the worktree tools and every bundled skill', async (t) => {
  // Report, "The worktree tool" (c36) and "Bundled skills": `--disable-slash-commands` withholds
  // all 18 (c36), which `O18` and ruling 8 on #467 permit, because a role reads its skills by path.
  const { args } = await invoked(consumer(t));
  const withheld = after(args, '--disallowedTools').split(',');
  assert.ok(withheld.includes('EnterWorktree'));
  assert.ok(withheld.includes('ExitWorktree'));
  assert.ok(args.includes('--disable-slash-commands'));
});

test('the invocation answers an empty list of variables to unset, as #473\'s report measured none that changes a session', async (t) => {
  // Report, "Inherited environment variables": removing the eleven `CLAUDE*` variables changed
  // nothing (c1, c2, c23 to c26), and none carries the owner's authentication.
  const { unset } = await invoked(consumer(t));
  assert.deepEqual(unset, []);
});

test('the agent file the invocation hands the CLI is the one given, under the directory, and is not read', async (t) => {
  // The adapter does not check that the file exists: the CLI reports a missing one.
  const repo = consumer(t);
  const absent = join(repo.directory, '.claude', 'agents', 'absent.md');
  const { args } = await invoked(repo, { agent: absent });
  assert.equal(after(args, '--append-system-prompt-file'), absent);
});

// proves R-SAFE-6
test('an agent file whose real path lies outside the directory, inside Rigger\'s package, is refused, naming the path', async (t) => {
  // `R-SAFE-6`: a consumer's role prompts live in its repository, and Rigger reads none from its
  // own package. The defect this catches is a dispatch handed the package's template, whether by
  // its path or by a link inside the consumer's repository that resolves to it.
  const repo = consumer(t);
  const template = join(root, 'templates', 'claude', 'agents', 'engineer.md');
  await assert.rejects(invoked(repo, { agent: template }), (failure) => failure.message.includes(template));

  const link = join(repo.directory, '.claude', 'agents', 'linked.md');
  symlinkSync(template, link);
  await assert.rejects(invoked(repo, { agent: link }), (failure) => failure.message.includes(link));

  const escaping = join(repo.directory, '..', '..', 'elsewhere.md');
  await assert.rejects(invoked(repo, { agent: escaping }), (failure) => failure.message.includes(escaping));
});
