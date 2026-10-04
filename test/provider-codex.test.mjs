// ABOUTME: Tests L0's provider adapter for Codex: the command line, standard input and environment
// it answers for one role's agent file in one directory, its skill probe, and its reader of
// `codex login status`, each against a stand-in `codex`, so no installed `codex` runs (O82).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as codex from '../src/substrate/providers/codex.mjs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { scratch } from './process-fixtures.mjs';
import { standInCodex } from './stub-claude.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt } from './git-repository.mjs';

/** An emitter that keeps every event it is handed. */
function keeping() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

/** The features #473's report lists as reaching the owner's browser or desktop (`docs/spikes/what-headless-sessions-load.md`). */
const HOST_FEATURES = ['browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser'];

/** The declaration a directory holds as its `.codex/config.toml` in these tests, written by hand. */
const DECLARATION = '# ABOUTME: a test declaration\nsandbox_mode = "workspace-write"\n';

/**
 * A consumer's directory in the test's own scratch directory, holding the declaration and an agent
 * file with frontmatter, a dispatch's scratch directory beside it, and a stand-in owner's Codex
 * home, which `CODEX_HOME` names for the test, so the owner's real one is never read.
 */
function layout(t) {
  const root = scratch(t);
  const directory = join(root, 'repo');
  const dispatchScratch = join(root, 'scratch', 'engineer');
  const owner = join(root, 'owner-codex');
  for (const each of [join(directory, '.codex'), join(directory, '.claude', 'agents'), dispatchScratch, owner]) mkdirSync(each, { recursive: true });
  writeFileSync(join(directory, '.codex', 'config.toml'), DECLARATION);
  const agent = join(directory, '.claude', 'agents', 'engineer.md');
  writeFileSync(agent, '---\nname: engineer\n---\n# Engineer\n\nThe last sentence of the agent file.\n');
  const inherited = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  process.env.CODEX_HOME = owner;
  t.after(() => {
    process.env.PATH = inherited.PATH;
    if (inherited.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = inherited.CODEX_HOME;
  });
  return { root, directory, scratch: dispatchScratch, owner, agent };
}

/** A stand-in `codex` built from `options`, put first on the `PATH` the adapter's probe reads. */
function onPath(options) {
  const stand = standInCodex(options);
  process.env.PATH = stand.first();
  return stand;
}

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

/** Every value following `flag` among `args`. */
const following = (args, flag) => args.flatMap((arg, at) => (args[at - 1] === flag ? [arg] : []));

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
  const { directory, scratch: made, agent } = layout(t);
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
  const { directory, scratch: made, agent, root } = layout(t);
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
  const { directory, scratch: made, agent } = layout(t);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  const off = following(args, '--disable');
  for (const feature of ['plugins', 'apps', ...HOST_FEATURES]) assert.ok(off.includes(feature), `${feature} is not disabled: ${args.join(' ')}`);
});

test('the invocation sets CODEX_HOME, and nothing else, to a directory in the dispatch\'s scratch directory holding the directory\'s declaration as its config.toml and a link to the owner\'s auth.json', async (t) => {
  const { directory, scratch: made, agent, owner } = layout(t);
  onPath({ skills: [] });

  const { env } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.deepEqual(Object.keys(env), ['CODEX_HOME']);
  const home = env.CODEX_HOME;
  assert.ok(home.startsWith(`${realpathSync.native(made)}/`), `${home} is not in the scratch directory ${made}`);
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), DECLARATION);
  assert.ok(lstatSync(join(home, 'auth.json')).isSymbolicLink(), 'the home\'s auth.json is no symbolic link');
  assert.equal(readlinkSync(join(home, 'auth.json')), join(owner, 'auth.json'));
});

test('the skill probe runs `codex -C <directory> debug prompt-input` in the directory, under the session\'s CODEX_HOME, with --disable plugins and --disable apps, and the two skills it lists outside the directory arrive disabled', async (t) => {
  const { directory, scratch: made, agent, root } = layout(t);
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
  const { directory, scratch: made, agent } = layout(t);
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
  const { directory, scratch: made, agent, root } = layout(t);
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
  const { directory, agent, root } = layout(t);
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
  const { directory, scratch: made, agent } = layout(t);
  onPath({ answer: probeAnswer(['- mine: Mine. (file: r0/mine/SKILL.md)'], { sections: ['### Skill roots', '- `r0` = `/owner/home/.agents/skills`'] }) });

  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() }), (failure) => /prompt-input/.test(failure.message) && /Available skills/.test(failure.message));
});

test('given a probe that outlives its bound, the invocation rejects naming the probe and its bound, and records the kill through the emitter it is handed', async (t) => {
  const { directory, scratch: made, agent } = layout(t);
  onPath({ hang: true });
  const emitter = keeping();

  await assert.rejects(codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter, probeTimeout: 500 }), (failure) => /prompt-input/.test(failure.message) && /500 ms/.test(failure.message));
  assert.ok(emitter.events.some((event) => event.event === 'timeout.killed'), JSON.stringify(emitter.events));
});

test('given reach naming a directory, the invocation passes it as --add-dir beside -C naming the working directory, and does not throw', async (t) => {
  const { directory, scratch: made, agent, root } = layout(t);
  const head = join(root, 'head');
  mkdirSync(head);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, reach: [head], emitter: keeping() });

  assert.deepEqual(following(args, '-C'), [directory]);
  assert.deepEqual(following(args, '--add-dir'), [head]);
});

test('the invocation hands the session the role\'s agent file whole, frontmatter included, from the path the role names, and refuses one outside the directory', async (t) => {
  const { directory, scratch: made, agent, root } = layout(t);
  onPath({ skills: [] });

  const { args } = await codex.invocation({ agent, tier: 'standard', prompt: 'p', directory, scratch: made, emitter: keeping() });

  assert.equal(JSON.parse(override(args, 'developer_instructions')), readFileSync(agent, 'utf8'));
  const stray = join(root, 'stray.md');
  writeFileSync(stray, '# stray\n');
  const other = join(root, 'scratch', 'other');
  mkdirSync(other);
  await assert.rejects(codex.invocation({ agent: stray, tier: 'standard', prompt: 'p', directory, scratch: other, emitter: keeping() }), /R-SAFE-6/);
});

/** A role answer as L2 gives one, naming provider `codex`, with `fields` over it. */
const answerOf = (fields) => ({
  role: 'engineer',
  agent: '.claude/agents/engineer.md',
  provider: 'codex',
  tier: 'standard',
  timeout: 60_000,
  instruction: 'Make the change card #1412 asks for.\n',
  evidence: 'Card #1412: the acceptance.\n',
  ...fields,
});

/**
 * A dispatch's directories in the test's own scratch directory, beside `layout`'s consumer
 * directory: the card's scratch base `scratch/rigger-1412/`, an empty git repository L1 made from,
 * and the state directory `.rigger/` with a sink open on it.
 */
function dispatchLayout(t) {
  const laid = layout(t);
  const base = join(laid.root, 'scratch', 'rigger-1412');
  mkdirSync(base, { recursive: true });
  const repository = repositoryAt(join(laid.root, 'repository'));
  const state = join(laid.root, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { ...laid, base, repository, state, sink };
}

/** Runs a role's dispatch as L3 does: `roleDispatch`, then L1's `dispatch`, under id `d-codex` and card #1412. */
async function throughL1({ sink, state, ...request }) {
  const handed = await roleDispatch({ sink, id: 'd-codex', card: 1412, ...request });
  return dispatch({ id: 'd-codex', card: 1412, directory: state, sink, ...handed });
}

/** Every event the stream in `state` holds, or none where nothing was recorded. */
const eventsIn = (state) => (existsSync(state) ? readEvents(state) : []);

test('given a role dispatch through L1 naming provider codex, the stand-in codex answers the probe, reads the prompt on its standard input, and runs in the working directory L1 was handed, with the probe\'s outside skills disabled', async (t) => {
  const { root, directory, base, repository, state, sink } = dispatchLayout(t);
  const outside = [join(root, 'elsewhere', 'skills', 'one', 'SKILL.md'), join(root, 'home', '.agents', 'skills', 'two', 'SKILL.md')];
  const stand = onPath({ skills: outside });

  const result = await throughL1({ answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state });

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
  const { directory, base, repository, state, sink } = dispatchLayout(t);
  const line = '- mine: Mine. (path: r0/mine/SKILL.md)';
  const stand = onPath({ answer: probeAnswer([line]) });

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state }),
    (failure) => failure.code === NOT_STARTED && failure.message.includes(JSON.stringify(line)),
  );
  assert.equal(stand.sessions().length, 0);
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
});

test('given a probe that fails through L1, roleDispatch rejects with NOT_STARTED naming the probe, no session starts, and L1 records no dispatch.start', async (t) => {
  const { directory, base, repository, state, sink } = dispatchLayout(t);
  const stand = onPath({ answer: 'codex: no such command\n', exit: 2 });

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state }),
    (failure) => failure.code === NOT_STARTED && /prompt-input/.test(failure.message),
  );
  assert.equal(stand.sessions().length, 0);
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
});

test('given a probe that outlives its bound through L1, its kill is recorded through L0 under the role dispatch\'s id and card, and no session starts', async (t) => {
  const { directory, base, repository, state, sink } = dispatchLayout(t);
  const stand = onPath({ hang: true });
  // The real module, with a bound short enough for a test.
  const bounded = { ...codex, invocation: (request) => codex.invocation({ ...request, probeTimeout: 500 }) };

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd: directory, directory, scratch: base, repository, reach: [], env: { PATH: stand.first() }, sink, state, adapters: { codex: bounded } }),
    (failure) => failure.code === NOT_STARTED && /500 ms/.test(failure.message),
  );
  const kills = eventsIn(state).filter((event) => event.event === 'timeout.killed');
  assert.ok(kills.length > 0, JSON.stringify(eventsIn(state)));
  for (const kill of kills) assert.deepEqual([kill.layer, kill.dispatch, kill.card], ['L0', 'd-codex', 1412]);
  assert.equal(stand.sessions().length, 0);
});

test('given a Codex judge dispatch through L1 against the fake forge, the stand-in codex receives -C naming main and --add-dir naming head', async (t) => {
  const { root, base, repository, state, sink } = dispatchLayout(t);
  const judge = join(root, 'judges', 'rigger-1412', 'reviewer');
  const main = join(judge, 'main');
  const head = join(judge, 'head');
  for (const each of [join(main, '.codex'), join(main, '.claude', 'agents'), head]) mkdirSync(each, { recursive: true });
  writeFileSync(join(main, '.codex', 'config.toml'), DECLARATION);
  writeFileSync(join(main, '.claude', 'agents', 'reviewer.md'), '# Reviewer\n');
  const fake = installFakeGh(join(root, 'judges'), { repo: 'acme/widgets', project: 12 });
  const stand = onPath({ skills: [] });
  const path = stand.first(`${dirname(fake.gh)}:${process.env.PATH}`);

  const result = await throughL1({ answer: answerOf({ role: 'reviewer', agent: '.claude/agents/reviewer.md', instruction: 'Judge pull request #9.\n' }), cwd: main, directory: judge, scratch: base, repository, reach: [head], env: { PATH: path }, sink, state });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const [session] = stand.sessions();
  assert.deepEqual(following(session.args, '-C'), [main]);
  assert.deepEqual(following(session.args, '--add-dir'), [head]);
  assert.equal(realpathSync.native(session.cwd), realpathSync.native(main));
});
