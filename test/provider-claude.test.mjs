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

// proves R-SAFE-7
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

// proves R-LOOP-14, R-EVIDENCE-6
test('given reach naming a directory, the invocation grants it by route B: no --add-dir, no additionalDirectories, and Read and Edit rules on its real path', async (t) => {
  // #519's report, "Recommendation", items 1 and 2: `--add-dir` lists the reached directory's
  // agents (c2, c12), and path-scoped rules in `--settings` reach it loading nothing (c6 to c8).
  const repo = consumer(t);
  const reached = scratch(t);
  const { args } = await invoked(repo, { reach: [reached] });
  assert.equal(args.includes('--add-dir'), false);
  const given = settings(args);
  assert.equal(given.additionalDirectories, undefined);
  assert.equal(given.permissions.additionalDirectories, undefined);
  assert.ok(given.permissions.allow.includes(`Read(/${reached}/**)`), JSON.stringify(given.permissions));
  assert.ok(given.permissions.allow.includes(`Edit(/${reached}/**)`), JSON.stringify(given.permissions));
});

// proves R-EVIDENCE-6
test('given reach naming a directory through a link, the rules name its real path and never the link', async (t) => {
  // #519's report, "What #520 must not assume": every run used the resolved path, and a rule on
  // `/tmp/…` was not measured to match `/private/tmp/…`, or the reverse. macOS names `/tmp` by a link.
  const repo = consumer(t);
  const reached = scratch(t);
  const link = join(scratch(t), 'linked');
  symlinkSync(reached, link);
  const { allow } = settings((await invoked(repo, { reach: [link] })).args).permissions;
  assert.ok(allow.includes(`Read(/${reached}/**)`), JSON.stringify(allow));
  assert.ok(allow.includes(`Edit(/${reached}/**)`), JSON.stringify(allow));
  assert.deepEqual(allow.filter((rule) => rule.includes(link)), []);
});

// proves R-EVIDENCE-6
test('given reach, the invocation writes no cd rule, keeps a rule of its own for each command the directory\'s settings declare, and no compound line', async (t) => {
  // Ruling 12 on #520: #531 measured that changing into `<head>` needed no rule on Claude Code
  // 2.1.287. #519's report, c16, c17 and c19: Claude Code matches a Bash rule against each part of
  // a compound command, so `cd <head> && npm test` runs under `Bash(npm test)`, and a rule naming
  // the whole line admits nothing.
  const repo = consumer(t);
  const reached = scratch(t);
  const declared = ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(git diff:*)'];
  put(repo.directory, '.claude/settings.json', { permissions: { allow: declared } });
  const { permissions } = settings((await invoked(repo, { reach: [reached] })).args);
  assert.deepEqual(permissions.allow.filter((rule) => rule.startsWith('Bash(cd')), [], JSON.stringify(permissions.allow));
  for (const rule of declared) assert.ok(permissions.allow.includes(rule), rule);
  const compound = Object.values(permissions).flat().filter((rule) => /^Bash\(.*(&&|\|\||;|\|)/.test(rule));
  assert.deepEqual(compound, []);
});

test('given reach, a Bash rule the directory\'s settings declare for a compound line is refused, naming the rule, since it would admit nothing', async (t) => {
  // #519's report, c17: `Bash(cd <head> && npm run fail)` did not admit that very command.
  const repo = consumer(t);
  const reached = scratch(t);
  for (const rule of ['Bash(cd /x && npm test)', 'Bash(npm test; echo done)', 'Bash(npm test | tee log)', 'Bash(make || true)']) {
    put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Bash(npm test:*)', rule] } });
    await assert.rejects(invoked(repo, { reach: [reached] }), (failure) => failure.message.includes(rule));
  }
});

test('given reach, a Bash rule the directory\'s settings declare with a lone & is refused, naming the rule', async (t) => {
  // The engineer judge's B1 on #531: `Bash(echo alpha & echo beta)` was carried across, and a live
  // session asked for that very command was denied it as using "the `&` background operator".
  const repo = consumer(t);
  const reached = scratch(t);
  const rule = 'Bash(npm test & echo x)';
  put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Bash(npm test:*)', rule] } });
  await assert.rejects(invoked(repo, { reach: [reached] }), (failure) => failure.message.includes(rule));
});

test('given reach, a Bash rule the directory\'s settings declare with a line break is refused, naming the rule', async (t) => {
  // The engineer judge's B1 on #531: a line break ends one command and starts the next.
  const repo = consumer(t);
  const reached = scratch(t);
  for (const rule of ['Bash(npm test\necho x)', 'Bash(npm test\r\necho x)']) {
    put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Bash(npm test:*)', rule] } });
    await assert.rejects(invoked(repo, { reach: [reached] }), (failure) => failure.message.includes(rule), JSON.stringify(rule));
  }
});

test('given reach, each Read or Edit deny rule relative to the working directory is copied, anchored at each reached directory\'s real path, and a // or ~/ rule is not', async (t) => {
  // O61 on #520: #531's engineer judge measured `Read(./.env)` and `Read(**/.secret)` protecting
  // main's copy and not head's under route B. Measured on Claude Code 2.1.287 and 2.1.288: a
  // single-segment `./.env` or `.env` blocks at any depth, as do `secrets/**`, `secrets/` and
  // `./secrets/**`, whose one segment comes before `/**` or a trailing `/`; a multi-segment
  // `./a/b.txt` or `a/b.txt` blocks at its own place only (#531's engineer judge, B3; Codex round 3,
  // item 7; the maker's probes, rounds 5 and 6).
  const repo = consumer(t);
  const one = scratch(t);
  const two = scratch(t);
  const declared = [
    'Read(./.env)', 'Read(.env)', 'Read(**/.secret)', 'Edit(secrets/**)', 'Read(src/config/**)', 'Read(./config/local.json)',
    'Read(keys/)', 'Read(./vault/**)',
    'Read(//etc/hosts)', 'Edit(~/.ssh/**)', 'Bash(git push --force:*)',
  ];
  put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Bash(npm test:*)'], deny: declared } });
  const { deny } = settings((await invoked(repo, { reach: [one, two] })).args).permissions;
  const copies = (head) => [
    `Read(/${head}/**/.env)`, `Read(/${head}/**/.env)`, `Read(/${head}/**/.secret)`, `Edit(/${head}/**/secrets/**)`, `Read(/${head}/src/config/**)`,
    `Read(/${head}/**/keys/)`, `Read(/${head}/**/vault/**)`,
    `Read(/${head}/config/local.json)`,
  ];
  assert.deepEqual([...deny].sort(), [...declared, ...copies(one), ...copies(two)].sort());
});

test('given reach, a /path deny rule is copied to each reached directory\'s real path and anchored at the working directory\'s real path too, and a ! rule is not copied', async (t) => {
  // Ruling 12 on #520: `/path` is "this path in the repository". #531 measured on Claude Code
  // 2.1.287 that `Read(/secret.txt)` passed inline in `--settings` did not block the working
  // directory's `secret.txt`, so the rule is anchored there too. A `!` pattern cannot carry over to
  // an anchored copy, so the reached directory stands stricter.
  const repo = consumer(t);
  const one = scratch(t);
  const two = scratch(t);
  const declared = ['Read(/secret.txt)', 'Edit(/config/**)', 'Read(!keep.txt)'];
  put(repo.directory, '.claude/settings.json', { permissions: { deny: declared } });
  const { deny } = settings((await invoked(repo, { reach: [one, two] })).args).permissions;
  const copies = (at) => [`Read(/${at}/secret.txt)`, `Edit(/${at}/config/**)`];
  assert.deepEqual([...deny].sort(), [...declared, ...copies(one), ...copies(two), ...copies(repo.directory)].sort());
});

test('given reach whose real path holds a space, the invocation grants it, naming the path as it is', async (t) => {
  // Ruling 12 on #520: the default worktree root sits beside the consumer's checkout, so a home
  // directory holding a space must not be refused.
  const repo = consumer(t);
  const reached = join(scratch(t), 'with space');
  mkdirSync(reached);
  const { allow } = settings((await invoked(repo, { reach: [reached] })).args).permissions;
  assert.ok(allow.includes(`Read(/${reached}/**)`), JSON.stringify(allow));
  assert.ok(allow.includes(`Edit(/${reached}/**)`), JSON.stringify(allow));
});

/** Asserts each directory named in `names`, made under a scratch directory, is refused as `reach`, naming its path. */
async function refusedAsReach(t, names) {
  const repo = consumer(t);
  const base = scratch(t);
  for (const name of names) {
    const reached = join(base, name);
    mkdirSync(reached);
    await assert.rejects(invoked(repo, { reach: [reached] }), (failure) => failure.message.includes(reached), name);
  }
}

test('given reach whose real path holds a command separator, the invocation is refused, naming it, since its rules would read the path as more than one', async (t) => {
  // Codex's round-1 finding on #531: a real directory named `head;echo` once made a compound `cd`
  // rule (#519's report, c17). No `cd` rule is written now (ruling 12), and the refusal stands for
  // every character outside letters, digits, a space and `/._+-`.
  await refusedAsReach(t, ['head;echo', 'x&&y', 'x&y', 'p|q', 'n\nl']);
});

test('given reach whose real path holds a character a shell would read as more than a path, other than a space, the invocation is refused, naming it', async (t) => {
  // Ruling 12 on #520: a space is admitted and every other such character is still refused.
  await refusedAsReach(t, ["q'uote", 'd"q', 's$t', 'b(r)', 'b`t', 'l<g', 'h#sh', 't~l']);
});

test('given reach whose real path holds a glob or rule character, the invocation is refused, naming it, since its Read and Edit rules would match past it', async (t) => {
  // #534's engineer judge, N1: `Read(/<head>/**)` written with `head` holding `*`, `?`, `[` or `]`
  // matches directories other than `head`, against ruling 10's delta. A brace or `!` is glob
  // syntax too, and `:` reads as a rule's `:*` prefix form.
  await refusedAsReach(t, ['g*lob', 'q?m', 'set[1]', 'r]b', 'br{a,b}', 'n!t', 'c:d']);
});

test('given reach naming a directory that does not exist, the invocation is refused, naming it', async (t) => {
  // A path that cannot be resolved fails safe: a rule on a spelling it does not resolve to was not
  // measured to match (#519's report, "What #520 must not assume").
  const repo = consumer(t);
  const absent = join(scratch(t), 'absent');
  await assert.rejects(invoked(repo, { reach: [absent] }), (failure) => failure.message.includes(absent));
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

/**
 * The tools Claude Code 2.1.287 offers a session that act through the owner's own sessions or
 * login, each by what its own definition says it does, as a session's request carried it:
 * `ListAgents` lists "other local Claude sessions on this machine" and the account's cloud
 * sessions; `SendMessage` sends to any of them; `PushNotification` "sends a desktop notification in
 * the user's terminal" and to their phone; `RemoteTrigger` creates "routines: cloud agents on a
 * schedule"; `DesignSync` reads and updates claude.ai designs "through their claude.ai login".
 */
const OWNERS = ['ListAgents', 'SendMessage', 'PushNotification', 'RemoteTrigger', 'DesignSync'];

// proves R-SAFE-7
test('the invocation withholds every tool that acts through the owner\'s own sessions or login', async (t) => {
  // `R-SAFE-9`: such a tool counts as declared only where the repository declares it. #519's report
  // found a `-p` session calling `ListAgents` and listing four of the owner's interactive sessions.
  // `--no-chrome` keeps out Claude in Chrome, which drives the owner's browser.
  const { args } = await invoked(consumer(t));
  const withheld = after(args, '--disallowedTools').split(',');
  for (const tool of OWNERS) assert.ok(withheld.includes(tool), tool);
  assert.ok(args.includes('--no-chrome'));
});

test('a tool acting through the owner\'s account that the directory\'s own settings allow is not withheld', async (t) => {
  // The repository declares such a tool by naming it in its own permission rules, which the
  // invocation hands the session. The others stay withheld.
  const repo = consumer(t);
  put(repo.directory, '.claude/settings.json', { permissions: { allow: ['SendMessage'] } });
  const withheld = after((await invoked(repo)).args, '--disallowedTools').split(',');
  assert.equal(withheld.includes('SendMessage'), false);
  for (const tool of OWNERS.filter((each) => each !== 'SendMessage')) assert.ok(withheld.includes(tool), tool);
});

// proves R-SAFE-7
test('the invocation withholds every built-in plugin the directory does not enable', async (t) => {
  // #473's report withheld its two built-in plugins by `enabledPlugins` (c36), and #519's report
  // found a third under `--setting-sources project` on 2.1.287, `cc-plugin-plugin-authoring`.
  const repo = consumer(t);
  const builtins = ['cc-plugin-agents-md@builtin', 'cc-plugin-telemetry@builtin', 'cc-plugin-plugin-authoring@builtin'];
  assert.deepEqual(settings((await invoked(repo)).args).enabledPlugins, Object.fromEntries(builtins.map((id) => [id, false])));
  put(repo.directory, '.claude/settings.json', { enabledPlugins: { 'cc-plugin-telemetry@builtin': true } });
  const enabled = settings((await invoked(repo)).args).enabledPlugins;
  assert.equal(Object.hasOwn(enabled, 'cc-plugin-telemetry@builtin'), false, 'a plugin the directory enables is switched off');
  assert.equal(enabled['cc-plugin-plugin-authoring@builtin'], false);
});

// proves R-SAFE-7
test('the invocation withholds the agent tool, whose remote isolation acts through the owner\'s account, unless the directory\'s own settings allow it', async (t) => {
  // O45 on #467: the agent tool's `isolation: "remote"` "launches the agent in a remote cloud
  // environment" on the owner's account, and no flag withholds that form alone, so dispatched
  // agents get no subagents. Claude Code names the tool `Task` in `init` and accepts `Task` or
  // `Agent` in a rule (#519's report, c2, c3).
  const repo = consumer(t);
  assert.ok(after((await invoked(repo)).args, '--disallowedTools').split(',').includes('Task'));
  for (const declared of ['Task', 'Agent']) {
    put(repo.directory, '.claude/settings.json', { permissions: { allow: [declared] } });
    assert.equal(after((await invoked(repo)).args, '--disallowedTools').split(',').includes('Task'), false, declared);
  }
});

// proves R-SAFE-7
test('the invocation withholds Workflow, whose agents no flag limits, from a directory whose own settings do not allow it', async (t) => {
  // O52 on #467: for the reason O45 withholds the agent tool, no flag limits what a workflow's
  // agents may do, so a dispatched session is not given `Workflow` unless the repository declares it.
  const repo = consumer(t);
  assert.ok(after((await invoked(repo)).args, '--disallowedTools').split(',').includes('Workflow'), 'no settings file');
  put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Read'] } });
  assert.ok(after((await invoked(repo)).args, '--disallowedTools').split(',').includes('Workflow'), 'settings allowing another tool');
});

// proves R-SAFE-7
test('Workflow is not withheld where the directory\'s own settings allow it, and every other withheld tool stays withheld', async (t) => {
  const repo = consumer(t);
  put(repo.directory, '.claude/settings.json', { permissions: { allow: ['Workflow'] } });
  const withheld = after((await invoked(repo)).args, '--disallowedTools').split(',');
  assert.equal(withheld.includes('Workflow'), false);
  for (const tool of ['Task', ...OWNERS, 'EnterWorktree', 'ExitWorktree']) assert.ok(withheld.includes(tool), tool);
});

test('the invocation keeps the session\'s transcript off disk', async (t) => {
  // `claude --help`: `--no-session-persistence` means sessions "will not be saved to disk", which
  // would otherwise land under the owner's `~/.claude/projects/`, outside the directory.
  assert.ok((await invoked(consumer(t))).args.includes('--no-session-persistence'));
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

test('the invocation sets CLAUDE_CODE_TMPDIR to one fixed, dot-named directory under the dispatch\'s directory', async (t) => {
  // #473's report, c35: `CLAUDE_CODE_TMPDIR` moved background-task output under the session's
  // directory, where `TMPDIR` left it under `/tmp/claude-<uid>/` (c34). Ruling 9 on #467 has the
  // invocation answer it in `env`, as a path under the directory, never one L1 removes.
  const repo = consumer(t);
  const { env, unset } = await invoked(repo);
  assert.deepEqual(Object.keys(env), ['CLAUDE_CODE_TMPDIR']);
  const value = env.CLAUDE_CODE_TMPDIR;
  assert.equal(dirname(value), repo.directory, 'the directory is not directly under the dispatch\'s');
  assert.match(value.slice(repo.directory.length + 1), /^\.[^/]+$/, 'the directory is not dot-named');
  assert.equal(unset.includes('CLAUDE_CODE_TMPDIR'), false);
  const other = consumer(t);
  assert.equal((await invoked(other)).env.CLAUDE_CODE_TMPDIR.slice(other.directory.length), value.slice(repo.directory.length), 'the name is not fixed');
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
