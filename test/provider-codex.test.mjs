// ABOUTME: Tests L0's provider adapter for Codex: the command line, standard input and environment
// it answers for one role's agent file in one directory, its skill probe, and its reader of
// `codex login status`, each against a stand-in `codex`, so no installed `codex` runs (O82).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as codex from '../src/substrate/providers/codex.mjs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { keeping, DECLARATION, following, answerOf, throughL1, controlledLayout, controlledDispatchLayout, refuseNativeSpawns } from './provider-codex-fixtures.mjs';

/** The features #473's report lists as reaching the owner's browser or desktop (`docs/spikes/what-headless-sessions-load.md`). */
const HOST_FEATURES = ['browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser'];

/** The value following each `-c` among `args`. */
const overrides = (args) => args.flatMap((arg, at) => (args[at - 1] === '-c' ? [arg] : []));

/** The value of the `-c` override for `key` among `args`, or undefined where there is none. */
const override = (args, key) => overrides(args).find((each) => each.startsWith(`${key}=`))?.slice(key.length + 1);

/** The `SKILL.md` paths the `skills.config` override among `args` disables, read from its text. */
function disabled(args) {
  const value = override(args, 'skills.config');
  if (value === undefined) return [];
  return [...value.matchAll(/\{path = ("(?:[^"\\]|\\.)*"), enabled = false\}/g)].map((match) => JSON.parse(match[1]));
}

test('H2: the supplied host starts the probe and disables each outside skill without disabling an inside skill', async (t) => {
  const { directory, scratch: made, agent, root, host, onPath } = controlledLayout(t);
  const outside = [join(root, 'owner tools', 'a "quoted" skill', 'SKILL.md'), join(`${directory}-neighbor`, 'SKILL.md')];
  const inside = join(directory, '.agents', 'skills', 'mine', 'SKILL.md');
  onPath({ skills: [...outside, inside] });
  refuseNativeSpawns(t);

  let answer;
  await assert.doesNotReject(async () => {
    answer = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping(), host });
  }, 'the skill probe must start through the supplied host');

  assert.deepEqual(host.starts.map(({ command }) => command), ['codex'], 'the supplied host did not start the probe');
  assert.deepEqual(disabled(answer.args).sort(), [...outside].sort(), 'only the independently listed outside skills must be disabled');
});

test('H3: a nonzero probe through the supplied host rejects with its exit code and preparation kind', async (t) => {
  const { directory, scratch: made, agent, host, onPath } = controlledLayout(t);
  onPath({ answer: 'probe refused\n', exit: 7 });
  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping(), host }), (failure) => {
    assert.equal(failure.startCause?.kind, 'codex-probe-exit', 'a nonzero probe must retain its preparation kind');
    assert.match(failure.message, /skill probe.*prompt-input/);
    assert.match(failure.message, /exited 7/);
    return true;
  });
  assert.deepEqual(host.starts.map(({ command }) => command), ['codex']);
});

test('H4: advancing the supplied clock past the probe bound rejects and records timeout.killed through its host', async (t) => {
  const { directory, scratch: made, agent, host, clock, onPath } = controlledLayout(t);
  onPath({ hang: true });
  const emitter = keeping();
  let outcome;
  codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter, host, probeTimeout: 500 })
    .then((value) => { outcome = { value }; }, (failure) => { outcome = { failure }; });
  assert.deepEqual(host.starts.map(({ command }) => command), ['codex'], 'the supplied host must start before advancing its clock');

  await clock.advance(clock.now() + 501);
  // The controlled read callbacks are microtasks; this checkpoint observes their quiescence.
  await new Promise((done) => setImmediate(done));
  assert.ok(outcome?.failure, 'advancing the supplied clock past 500 ms must reject the probe');
  assert.match(outcome.failure.message, /skill probe.*prompt-input/);
  assert.match(outcome.failure.message, /500 ms/);
  assert.ok(emitter.events.some(({ event }) => event === 'timeout.killed'), JSON.stringify(emitter.events));
  assert.ok(host.reads.some(({ command }) => command === host.ps), 'the supplied host must read the process table');
  assert.ok(host.signals.some(([, name]) => name === 'SIGKILL'), 'the supplied host must send the kill');
});

test('H5: an unreadable probe answer through the supplied host retains its preparation kind', async (t) => {
  const { directory, scratch: made, agent, host, onPath } = controlledLayout(t);
  onPath({ answer: '[]\n' });
  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping(), host }), (failure) => {
    assert.equal(failure.startCause?.kind, 'codex-probe-answer', 'an unreadable probe answer must retain its preparation kind');
    assert.match(failure.message, /skill probe.*prompt-input/);
    return true;
  });
  assert.deepEqual(host.starts.map(({ command }) => command), ['codex']);
});

test('H6: an unmapped tier rejects before the supplied host starts any probe', async (t) => {
  const { directory, scratch: made, agent, host, onPath } = controlledLayout(t);
  onPath({ skills: [] });
  await assert.rejects(codex.invocation({ agent, tier: 'cheap', prompt: 'p', directory, scratch: made, emitter: keeping(), host }), /`cheap`/);
  assert.deepEqual(host.starts, [], 'an unmapped tier must start no probe');
});

test('the Codex module answers to the name `codex` in the adapter map, and exports what the Claude Code module exports, with `signedIn` beside `auth`', () => {
  assert.equal(ADAPTERS.codex, codex);
  assert.equal(codex.name, 'codex');
  assert.deepEqual(codex.auth, ['codex', 'login', 'status']);
  assert.equal(codex.assets, '.codex');
  for (const each of ['name', 'auth', 'assets', 'tiers', 'invocation', 'signedIn']) assert.ok(Object.hasOwn(codex, each), each);
  for (const each of ['name', 'auth', 'assets', 'tiers', 'invocation', 'signedIn']) assert.ok(Object.hasOwn(ADAPTERS.claude, each), `the Claude Code module exports no ${each}`);
});

test('the Codex reader answers true, false or unknown from what `codex login status` said, as recorded with codex-cli 0.159.2', () => {
  // Recorded on 2026-10-03 with codex-cli 0.159.2: signed in, it wrote `Logged in using ChatGPT`
  // to standard error and exited 0; with `CODEX_HOME` an empty directory, `Not logged in` and 1.
  // Its standard output was empty both times. The check against the installed CLI is
  // `test/provider-codex-live.test.mjs`, which runs only under `RIGGER_LIVE_CODEX=1`.
  assert.equal(codex.signedIn({ status: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }), true);
  assert.equal(codex.signedIn({ status: 1, stdout: '', stderr: 'Not logged in\n' }), false);
  assert.equal(codex.signedIn({ status: 0, stdout: '', stderr: 'Signed in, somehow\n' }), undefined);
  assert.equal(codex.signedIn({ status: 1, stdout: '', stderr: '' }), undefined);
});

test('the Codex invocation names `codex` by its command name, hands the prompt on standard input and in no argument, and passes no `--ignore-user-config`', async (t) => {
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });

  const { command, args, input, unset } = await codex.invocation({ agent, tier: 'standard', prompt: 'the prompt PROMPT-MARKER-7', directory, scratch: made, emitter: keeping() });

  assert.equal(command, 'codex');
  assert.equal(args[0], 'exec');
  assert.deepEqual(input, Buffer.from('the prompt PROMPT-MARKER-7', 'utf8'));
  assert.equal(args.filter((arg) => arg.includes('PROMPT-MARKER-7')).length, 0, 'an argument holds the prompt');
  assert.ok(!args.includes('--ignore-user-config'), args.join(' '));
  assert.deepEqual(following(args, '-C'), [directory]);
  assert.deepEqual(unset, []);
});

test('given tier standard the invocation selects gpt-6.1-sol at medium effort, given high gpt-6.1-sol at high effort, and given any other tier it throws naming the tier and runs no probe', async (t) => {
  const { directory, scratch: made, agent, root, codex, onPath } = controlledLayout(t);
  const stand = onPath({ skills: [] });

  const standard = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });
  const highScratch = join(root, 'scratch', 'high');
  mkdirSync(highScratch);
  const high = await codex.invocation({ agent, tier: 'high', prompt: 'p', directory, scratch: highScratch, emitter: keeping() });

  assert.deepEqual(following(standard.args, '-m'), ['gpt-6.1-sol']);
  assert.equal(override(standard.args, 'model_reasoning_effort'), '"medium"');
  assert.deepEqual(following(high.args, '-m'), ['gpt-6.1-sol']);
  assert.equal(override(high.args, 'model_reasoning_effort'), '"high"');
  const probes = stand.probes().length;
  await assert.rejects(codex.invocation({ agent, tier: 'cheap', prompt: 'p', directory, scratch: made, emitter: keeping() }), /`cheap`/);
  assert.equal(stand.probes().length, probes, 'a probe ran for a tier Rigger does not fix');
});

test('the invocation passes --disable plugins and --disable apps, and disables every feature #473 found reaching the owner\'s browser or desktop', async (t) => {
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  const off = following(args, '--disable');
  for (const feature of ['plugins', 'apps', ...HOST_FEATURES]) assert.ok(off.includes(feature), `${feature} is not disabled: ${args.join(' ')}`);
});

/** Every `-c` override among `args` that sets a feature, a tool or web search, by its text. */
const toolKeys = (args) => overrides(args).filter((each) => /^(features|tools|web_search)\b/.test(each));

// proves R-SAFE-8
test('given a declaration that withholds no built-in tool, the invocation withholds none either: it disables only plugins, apps and the host features, and sets no feature or tool key', async (t) => {
  // Table T row T7 on #1301. A built-in such as `shell_tool` or `sleep_tool` is one
  // `codex features list` shows at codex-cli 0.166.0; disabling one would withhold it.
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.deepEqual(following(args, '--disable').sort(), ['apps', 'plugins', ...HOST_FEATURES].sort());
  assert.equal(args.includes('--enable'), false, args.join(' '));
  assert.deepEqual(toolKeys(args), []);
});

// proves R-SAFE-8
test('given a declaration that withholds a built-in by its feature key, the session\'s home carries the key as declared, and no flag or override turns the built-in back on', async (t) => {
  // Table T row T8 on #1301: `[features] sleep_tool = false` in a session's home `config.toml`
  // removed the `sleep` tool from its rollout at codex-cli 0.166.0 (the maker's probe, 2026-11-08).
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  const declaration = `${DECLARATION}\n[features]\nsleep_tool = false\n`;
  writeFileSync(join(directory, '.codex', 'config.toml'), declaration);
  onPath({ skills: [] });

  const { args, env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.equal(readFileSync(join(env.CODEX_HOME, 'config.toml'), 'utf8'), declaration);
  assert.equal(args.includes('--enable'), false, args.join(' '));
  assert.deepEqual(toolKeys(args), []);
});

// proves R-SAFE-9
test('given a declaration naming no plugin, app or host feature, both the skill probe and the session disable plugins, apps and each host feature', async (t) => {
  // Table T row T9 on #1301: each acts through the owner's account, browser or desktop, so each
  // counts as declared only where the repository declares it.
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  const stand = onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  const [probe] = stand.probes();
  for (const [name, given] of [['session', args], ['probe', probe.args]]) {
    const off = following(given, '--disable');
    for (const feature of ['plugins', 'apps', ...HOST_FEATURES]) assert.ok(off.includes(feature), `the ${name} leaves ${feature} on: ${given.join(' ')}`);
  }
});

// proves R-SAFE-9
test('given a declaration naming an MCP server, the session\'s home carries that server as declared, while plugins and apps stay disabled', async (t) => {
  // Table T row T11 on #1301, beside its withheld half, row T9: the declared server is offered,
  // and what the declaration does not name is not.
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  const declaration = `${DECLARATION}\n[mcp_servers.c1301]\ncommand = "node"\nargs = ["server.cjs"]\n`;
  writeFileSync(join(directory, '.codex', 'config.toml'), declaration);
  onPath({ skills: [] });

  const { args, env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.equal(readFileSync(join(env.CODEX_HOME, 'config.toml'), 'utf8'), declaration);
  assert.deepEqual(overrides(args).filter((each) => each.startsWith('mcp_servers')), [], 'an override replaces the declared server');
  for (const feature of ['plugins', 'apps']) assert.ok(following(args, '--disable').includes(feature), `${feature} is not disabled`);
});

test('the invocation sets CODEX_HOME to a directory in the dispatch\'s scratch directory holding the directory\'s declaration as its config.toml and a link to the owner\'s auth.json, and TMPDIR and TMPPREFIX to its temporary directory', async (t) => {
  const { directory, scratch: made, agent, owner, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });

  const { env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.deepEqual(Object.keys(env), ['CODEX_HOME', 'TMPDIR', 'TMPPREFIX']);
  const home = env.CODEX_HOME;
  assert.ok(home.startsWith(`${realpathSync.native(made)}/`), `${home} is not in the scratch directory ${made}`);
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), DECLARATION);
  assert.ok(lstatSync(join(home, 'auth.json')).isSymbolicLink(), 'the home\'s auth.json is no symbolic link');
  assert.equal(readlinkSync(join(home, 'auth.json')), join(owner, 'auth.json'));
});

test('the skill probe runs `codex -C <directory> debug prompt-input` in the directory, under the session\'s CODEX_HOME, with --disable plugins and --disable apps, and the two skills it lists outside the directory arrive disabled', async (t) => {
  const { directory, scratch: made, agent, root, codex, onPath } = controlledLayout(t);
  const outside = [join(root, 'elsewhere', 'skills', 'one', 'SKILL.md'), join(root, 'home', '.agents', 'skills', 'two', 'SKILL.md')];
  const inside = join(directory, '.agents', 'skills', 'mine', 'SKILL.md');
  const stand = onPath({ skills: [...outside, inside] });

  const { args, env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  const [probe] = stand.probes();
  assert.equal(stand.probes().length, 1);
  assert.deepEqual(following(probe.args, '-C'), [directory]);
  assert.deepEqual(probe.args.slice(-2), ['debug', 'prompt-input']);
  for (const feature of ['plugins', 'apps']) assert.ok(following(probe.args, '--disable').includes(feature), probe.args.join(' '));
  assert.ok(!probe.args.includes('--ignore-user-config'));
  assert.equal(realpathSync.native(probe.cwd), realpathSync.native(directory));
  assert.equal(probe.home, env.CODEX_HOME);
  assert.deepEqual(disabled(args).sort(), [...outside].sort());
});

test('the probe reads Codex\'s own recorded answer: each skill its root table places outside the directory arrives disabled by its absolute SKILL.md path', async (t) => {
  // The answer is codex-cli 0.159.2's own, recorded on 2026-10-03 from a probe repository under
  // the coordinator's scratchpad, so every skill it lists lies outside this test's directory. The
  // six paths are read off that file by hand: four bundled `.system` skills under the probe's
  // home, one under the probe repository's `.agents/skills` and one under its `.codex/skills`.
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  const answer = readFileSync(new URL('./fixtures/codex-prompt-input-0.159.2.json', import.meta.url), 'utf8');
  onPath({ answer });
  const probe = '/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe';

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.deepEqual(disabled(args).sort(), [
    `${probe}/home/skills/.system/imagegen/SKILL.md`,
    `${probe}/home/skills/.system/openai-docs/SKILL.md`,
    `${probe}/home/skills/.system/skill-creator/SKILL.md`,
    `${probe}/home/skills/.system/skill-installer/SKILL.md`,
    `${probe}/repo/.agents/skills/c489-agentsdir-skill/SKILL.md`,
    `${probe}/repo/.codex/skills/c489-codexdir-skill/SKILL.md`,
  ].sort());
});

test('given a probe that fails, or one whose answer holds no skill list, the invocation rejects naming the probe and why', async (t) => {
  const { directory, scratch: made, agent, root, codex, onPath } = controlledLayout(t);
  onPath({ answer: 'codex: the probe went wrong\n', exit: 3 });
  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() }), (failure) => /prompt-input/.test(failure.message) && /exited 3/.test(failure.message));

  const other = join(root, 'scratch', 'other');
  mkdirSync(other);
  onPath({ answer: '[]\n' });
  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: other, emitter: keeping() }), (failure) => /prompt-input/.test(failure.message) && /skill list/.test(failure.message));
});

/**
 * A probe answer in the shape codex-cli 0.159.2 printed (`test/fixtures/codex-prompt-input-0.159.2.json`),
 * written by hand: one developer message whose skills block holds `sections`, by default one root
 * and the Available skills heading, followed by the skill lines given.
 */
function probeAnswer(lines, { sections = ['### Skill roots', '- `r0` = `/owner/home/.agents/skills`', '### Available skills'] } = {}) {
  const text = ['<skills_instructions>', '## Skills', 'A skill is a set of local instructions.', ...sections, ...lines, '</skills_instructions>'].join('\n');
  return `${JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }])}\n`;
}

test('given a probe whose skill list holds a line in any other shape, the invocation rejects naming the probe and the line, rather than leave that skill enabled', async (t) => {
  // `R-SAFE-6`: a skill line the reader passed over would leave the owner's skill loaded. Each
  // shape below is the measured line `- mine: Mine. (file: r0/mine/SKILL.md)` changed one way a
  // later Codex could change it.
  const { directory, agent, root, codex, onPath } = controlledLayout(t);
  const shapes = {
    'a trailing space': ['- mine: Mine. (file: r0/mine/SKILL.md) '],
    'a line wrapped onto two': ['- mine: Mine, described', 'at length. (file: r0/mine/SKILL.md)'],
    'another key in place of file': ['- mine: Mine. (path: r0/mine/SKILL.md)'],
  };
  for (const [shape, lines] of Object.entries(shapes)) {
    const made = join(root, 'scratch', shape.replaceAll(' ', '-'));
    mkdirSync(made, { recursive: true });
    onPath({ answer: probeAnswer(lines) });
    await assert.rejects(
      codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() }),
      (failure) => /prompt-input/.test(failure.message) && failure.message.includes(JSON.stringify(lines[0])),
      shape,
    );
  }

  // The measured shape still reads, so the refusal is of the shape and not of every list.
  const made = join(root, 'scratch', 'measured');
  mkdirSync(made, { recursive: true });
  onPath({ answer: probeAnswer(['- mine: Mine. (file: r0/mine/SKILL.md)']) });
  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });
  assert.deepEqual(disabled(args), ['/owner/home/.agents/skills/mine/SKILL.md']);
});

test('given a probe whose skills block holds no Available skills heading, the invocation rejects naming the probe and the heading', async (t) => {
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ answer: probeAnswer(['- mine: Mine. (file: r0/mine/SKILL.md)'], { sections: ['### Skill roots', '- `r0` = `/owner/home/.agents/skills`'] }) });

  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() }), (failure) => /prompt-input/.test(failure.message) && /Available skills/.test(failure.message));
});

test('given a probe that outlives its bound, the invocation rejects naming the probe and its bound, and records the kill through the emitter it is handed', async (t) => {
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ hang: true });
  const emitter = keeping();

  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter, probeTimeout: 500 }), (failure) => /prompt-input/.test(failure.message) && /500 ms/.test(failure.message));
  assert.ok(emitter.events.some((event) => event.event === 'timeout.killed'), JSON.stringify(emitter.events));
});

test('given reach naming a directory, the invocation passes it as --add-dir beside -C naming the working directory, and does not throw', async (t) => {
  const { directory, scratch: made, agent, root, codex, onPath } = controlledLayout(t);
  const head = join(root, 'head');
  mkdirSync(head);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, reach: [head], emitter: keeping() });

  assert.deepEqual(following(args, '-C'), [directory]);
  assert.deepEqual(following(args, '--add-dir'), [head, join(realpathSync.native(made), 'tmp')]);
});

test('the invocation gives the session one writable temporary directory in its scratch directory: made, named by --add-dir, by TMPDIR, and holding the prefix TMPPREFIX names (O93)', async (t) => {
  const { directory, scratch: made, agent, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });
  const temporary = join(realpathSync.native(made), 'tmp');

  const { args, env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.ok(lstatSync(temporary).isDirectory(), `${temporary} is no directory`);
  assert.deepEqual(following(args, '--add-dir'), [temporary]);
  assert.equal(env.TMPDIR, temporary);
  assert.equal(env.TMPPREFIX, join(temporary, 'zsh'));
});

test('given a Codex role dispatch through L1, L1 hands the stand-in codex TMPDIR and TMPPREFIX in the role\'s own scratch directory, and the session\'s --add-dir names that directory', async (t) => {
  const { directory, base, repository, state, sink, codex, onPath, host } = controlledDispatchLayout(t);
  const stand = onPath({ skills: [] });
  const temporary = join(realpathSync.native(base), 'engineer', 'tmp');

  const handed = await roleDispatch({ adapters: { codex }, answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first(), TMPDIR: '/handed/tmp' }, sink, id: 'd-codex', card: 1412 });
  const result = await dispatch({ host, clock: host.clock.now, id: 'd-codex', card: 1412, directory: state, sink, ...handed });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.deepEqual([handed.env.TMPDIR, handed.env.TMPPREFIX], [temporary, join(temporary, 'zsh')]);
  const [session] = stand.sessions();
  assert.deepEqual(following(session.args, '--add-dir'), [temporary]);
});

/** Whether `path`, or a directory above it, holds a `.git`, and so lies in a git worktree. */
function inWorktree(path) {
  for (let at = path; at !== dirname(at); at = dirname(at)) if (existsSync(join(at, '.git'))) return true;
  return false;
}

test('two Codex dispatches get two different temporary directories, each inside its own scratch directory (O93)', async (t) => {
  const { directory, agent, root, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });
  const first = join(root, 'scratch', 'first');
  const second = join(root, 'scratch', 'second');
  for (const each of [first, second]) mkdirSync(each, { recursive: true });

  const one = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: first, emitter: keeping() });
  const two = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: second, emitter: keeping() });

  assert.notEqual(one.env.TMPDIR, two.env.TMPDIR);
  assert.ok(one.env.TMPDIR.startsWith(`${realpathSync.native(first)}/`), one.env.TMPDIR);
  assert.ok(two.env.TMPDIR.startsWith(`${realpathSync.native(second)}/`), two.env.TMPDIR);
});

test('given a Codex dispatch whose working directory is a git worktree, its temporary directory lies in no worktree (O93)', async (t) => {
  const { root, base, repository, sink, codex, onPath, host } = controlledDispatchLayout(t);
  for (const each of [join(repository, '.codex'), join(repository, '.claude', 'agents')]) mkdirSync(each, { recursive: true });
  writeFileSync(join(repository, '.codex', 'config.toml'), DECLARATION);
  writeFileSync(join(repository, '.claude', 'agents', 'engineer.md'), '# Engineer\n');
  const stand = onPath({ skills: [] });
  assert.ok(inWorktree(repository), `${repository} is no worktree, so this compares nothing`);

  const handed = await roleDispatch({ adapters: { codex }, answer: answerOf(), cwd: repository, directory: repository, scratch: base, repository: join(root, 'repository'), reach: [], env: { PATH: stand.first() }, sink, id: 'd-codex', card: 1412 });

  assert.equal(inWorktree(handed.env.TMPDIR), false, `${handed.env.TMPDIR} lies in a worktree`);
  assert.deepEqual(following(handed.args, '--add-dir'), [handed.env.TMPDIR]);
});

test('the invocation hands the session the role\'s agent file whole, frontmatter included, from the path the role names, and refuses one outside the directory', async (t) => {
  const { directory, scratch: made, agent, root, codex, onPath } = controlledLayout(t);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.equal(JSON.parse(override(args, 'developer_instructions')), readFileSync(agent, 'utf8'));
  const stray = join(root, 'stray.md');
  writeFileSync(stray, '# stray\n');
  const other = join(root, 'scratch', 'other');
  mkdirSync(other);
  await assert.rejects(codex.invocation({ agent: stray, tier: 'standard', prompt: 'p', directory, scratch: other, emitter: keeping() }), /R-SAFE-6/);
});

/** Every event the stream in `state` holds, or none where nothing was recorded. */
const eventsIn = (state) => (existsSync(state) ? readEvents(state) : []);

test('given a role dispatch through L1 naming provider codex, the stand-in codex answers the probe, reads the prompt on its standard input, and runs in the working directory L1 was handed, with the probe\'s outside skills disabled', async (t) => {
  const { root, directory, base, repository, state, sink, codex, onPath, host } = controlledDispatchLayout(t);
  const outside = [join(root, 'elsewhere', 'skills', 'one', 'SKILL.md'), join(root, 'home', '.agents', 'skills', 'two', 'SKILL.md')];
  const stand = onPath({ skills: outside });

  const result = await throughL1({ host, adapters: { codex }, answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const [probe] = stand.probes();
  const [session] = stand.sessions();
  assert.equal(stand.probes().length, 1);
  assert.equal(stand.sessions().length, 1);
  assert.deepEqual(probe.args.slice(-2), ['debug', 'prompt-input']);
  assert.equal(session.input, 'Make the change card #1412 asks for.\nCard #1412: the acceptance.\n');
  assert.equal(realpathSync.native(session.cwd), realpathSync.native(directory));
  assert.equal(session.home, probe.home);
  assert.ok(session.home.startsWith(`${realpathSync.native(join(base, 'engineer'))}/`), session.home);
  assert.deepEqual(disabled(session.args).sort(), [...outside].sort());
});

test('given a probe whose skill list holds a line in another shape through L1, roleDispatch rejects with NOT_STARTED naming the line, and no session starts', async (t) => {
  const { directory, base, repository, state, sink, codex, onPath, host } = controlledDispatchLayout(t);
  const line = '- mine: Mine. (path: r0/mine/SKILL.md)';
  const stand = onPath({ answer: probeAnswer([line]) });

  await assert.rejects(
    throughL1({ host, adapters: { codex }, answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state }),
    (failure) => failure.code === NOT_STARTED && failure.message.includes(JSON.stringify(line)),
  );
  assert.equal(stand.sessions().length, 0);
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
});

test('given a probe that fails through L1, roleDispatch rejects with NOT_STARTED naming the probe, no session starts, and L1 records no dispatch.start', async (t) => {
  const { directory, base, repository, state, sink, codex, onPath, host } = controlledDispatchLayout(t);
  const stand = onPath({ answer: 'codex: no such command\n', exit: 2 });

  await assert.rejects(
    throughL1({ host, adapters: { codex }, answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state }),
    (failure) => failure.code === NOT_STARTED && /prompt-input/.test(failure.message),
  );
  assert.equal(stand.sessions().length, 0);
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
});

test('given a probe that outlives its bound through L1, its kill is recorded through L0 under the role dispatch\'s id and card, and no session starts', async (t) => {
  const { directory, base, repository, state, sink, codex, onPath, host } = controlledDispatchLayout(t);
  const stand = onPath({ hang: true });
  // The real module, with a bound short enough for a test.
  const bounded = { ...codex, invocation: (request) => codex.invocation({ ...request, probeTimeout: 500 }) };

  await assert.rejects(
    throughL1({ host, answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state, adapters: { codex: bounded } }),
    (failure) => failure.code === NOT_STARTED && /500 ms/.test(failure.message),
  );
  const kills = eventsIn(state).filter((event) => event.event === 'timeout.killed');
  assert.ok(kills.length > 0, JSON.stringify(eventsIn(state)));
  for (const kill of kills) assert.deepEqual([kill.layer, kill.dispatch, kill.card], ['L0', 'd-codex', 1412]);
  assert.equal(stand.sessions().length, 0);
});
