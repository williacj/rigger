// ABOUTME: Tests `rigger resume`'s close of the status issue, Table B of #1073, in process over a fake
// `gh`: the closers removed first, then for each issue the label removed and the issue closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resume } from '../src/cli/resume.mjs';
import { VERBS } from '../src/cli/verbs.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { TIME, admissionOf, closerText, seed } from './admission-world.mjs';
import { repositoryIn } from './git-repository.mjs';
import { configure, statusGh } from './notice-forge.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { REPO } from './verb-consumer.mjs';

const STATUS = 'rigger:status';

/** The guard's git, run directly as `asked` would run it, so the test signals no process group. */
const git = (command, args) => {
  const done = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  return { status: done.status, timedOut: false, stdout: done.stdout, stderr: done.stderr };
};

/** A status issue the stand-in holds: open, carrying the label, its body naming hold `id`. */
const status = (number, id) => ({ number, title: 'Rigger closed admission', body: `Why.\n\nHold: \`${id}\`\n`, labels: [STATUS] });

/**
 * A consumer repository holding `closers`, each a closer's file name, and its config unless
 * `config` is false or the text of one, beside a stand-in `gh` holding `issues`, as `statusGh` takes
 * them. `refuse(args)` names a request the forge refuses, answering what gh says for it, and
 * `observe(args)` sees each request as it is made. Answers the repository, its admission directory,
 * `run(options)`, which runs `resume` there in process, `issue(number)`, the issue as the stand-in
 * then holds it, and `sent`, every request made.
 */
function world({ closers = [], issues = [], config = true, refuse, observe = () => {} }) {
  const repository = realpathSync.native(repositoryIn('rigger-resume-close-'));
  for (const name of closers) seed(join(repository, '.rigger'), name, closerText({ reason: `reason of ${name}` }));
  if (config === true) configure(repository);
  else if (typeof config === 'string') writeFileSync(join(repository, 'rigger.config.mjs'), config);
  const gh = statusGh({ issues, refuse });
  const send = (command, args) => {
    observe(args);
    return gh(command, args);
  };
  return {
    repository,
    sent: gh.sent,
    admission: admissionOf(join(repository, '.rigger')),
    run: (options = {}) => resume({ target: repository, now: () => TIME, ask: git, send, ...options }),
    issue: (number) => gh.issues.find((each) => each.number === number),
  };
}

/** The closers left in `here`'s admission directory. */
const left = (here) => readdirSync(here.admission).filter((name) => !name.startsWith('.'));

/** What gh says of a refused request. */
const refused = (message) => ({ status: 1, stdout: '', stderr: `gh: ${message}\n` });

/** Whether `args` is the REST request whose path ends `tail`, sent with `method`. */
const rest = (args, tail, method) => args[1]?.endsWith(tail) && args[3] === method;

// proves R-SCHED-24
test('resume over hold closers naming issues, beside other open issues carrying the label, removes the closers, then removes the label from each issue and closes it, and exits 0', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json', 'owner-o4.json'], issues: [status(7, 'a1'), status(9, 'z9'), { number: 11, title: 'Copied', body: '', labels: [STATUS, 'type:change'] }] });

  const { text, code } = await here.run();

  assert.equal(code, 0, text);
  assert.deepEqual(left(here), []);
  for (const number of [7, 9, 11]) {
    const issue = await here.issue(number);
    assert.equal(issue.state, 'closed', `#${number}`);
    assert.ok(!issue.labels.includes(STATUS), `#${number}`);
    assert.match(text, new RegExp(`closed the status issue #${number}$`, 'm'), text);
  }
  // For each issue, its label's removal is sent before its close.
  const writes = here.sent.filter((args) => ['DELETE', 'PATCH'].includes(args[4])).map((args) => `${args[4]} ${args[2]}`);
  assert.deepEqual(writes, [7, 9, 11].flatMap((number) => [`DELETE repos/${REPO}/issues/${number}/labels/rigger%3Astatus`, `PATCH repos/${REPO}/issues/${number}`]));
});

// proves R-SCHED-24
test('resume removes the closers it read before it reads the config or makes any forge call', async () => {
  // The config records, as it is read, which closers then stood; the forge, as its first request arrives.
  const seen = join(temporaryDirectory('rigger-resume-close-seen-'), 'seen.json');
  const atFirstRequest = [];
  const here = world({ closers: ['hold-a1-issue-7.json', 'owner-o4.json'], issues: [status(7, 'a1')], config: false, observe: () => atFirstRequest.length === 0 && atFirstRequest.push(left(here)) });
  writeFileSync(join(here.repository, 'rigger.config.mjs'), [
    "import { readdirSync, writeFileSync } from 'node:fs';",
    `import { consumerConfig } from ${JSON.stringify(new URL('./verb-consumer.mjs', import.meta.url).href)};`,
    `writeFileSync(${JSON.stringify(seen)}, JSON.stringify(readdirSync(${JSON.stringify(here.admission)})));`,
    'export default consumerConfig(1);',
  ].join('\n'));

  const { text, code } = await here.run();

  assert.equal(code, 0, text);
  assert.deepEqual(JSON.parse(readFileSync(seen, 'utf8')), []);
  assert.deepEqual(atFirstRequest, [[]]);
});

// proves R-SCHED-23
test('resume whose closers were each already gone at their removal changes nothing: it names each one gone, reads no config, makes no forge call and exits 0', async () => {
  // Injected: each closer goes between the read and the unlink, as another `resume` removing it would.
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')], config: 'throw new Error(\'this config was read\');\n' });
  const unlinkSync = (path) => { nodeFs.unlinkSync(path); nodeFs.unlinkSync(path); };

  const { text, code } = await here.run({ fs: { ...nodeFs, unlinkSync } });

  assert.equal(code, 0, text);
  assert.match(text, /hold-a1-issue-7\.json was already gone/, text);
  assert.doesNotMatch(text, /config was read|closed the status issue/, text);
  assert.deepEqual(here.sent, []);
  assert.equal((await here.issue(7)).state, 'open');
});

// proves R-SCHED-24
test('resume closes a closer-named issue that no longer carries the label with no label write, and writes nothing for one already closed, deleted or transferred', async () => {
  const here = world({
    closers: ['hold-a1-issue-7.json', 'hold-b2-issue-8.json', 'hold-c3-issue-12.json', 'hold-d4-issue-13.json'],
    issues: [{ ...status(7, 'a1'), labels: [] }, { ...status(8, 'b2'), state: 'closed' }, { ...status(13, 'd4'), repository: 'someone/elsewhere' }],
  });

  const { text, code } = await here.run();

  assert.equal(code, 0, text);
  const writes = here.sent.filter((args) => ['DELETE', 'PATCH'].includes(args[4])).map((args) => `${args[4]} ${args[2]}`);
  assert.deepEqual(writes, [`PATCH repos/${REPO}/issues/7`]);
  assert.equal((await here.issue(7)).state, 'closed');
  assert.doesNotMatch(text, /left open/, text);
});

// proves R-SCHED-24
test('a read or write refused for one issue, its own read, its label removal or its close, leaves that issue open, and resume goes on to the next and exits non-zero naming the closers removed, the issue left open and why', async () => {
  const refusals = {
    'its read': (args) => args[1] === 'graphql' && args[3].includes('issue(number: 7) { number') && refused('HTTP 502: Bad Gateway'),
    'its label removal': (args) => rest(args, '/issues/7/labels/rigger%3Astatus', 'DELETE') && refused('HTTP 403: Forbidden'),
    'its close': (args) => rest(args, '/issues/7', 'PATCH') && refused('HTTP 403: Forbidden'),
  };
  for (const [what, refuse] of Object.entries(refusals)) {
    const here = world({ closers: ['hold-a1-issue-7.json', 'hold-b2-issue-9.json'], issues: [status(7, 'a1'), status(9, 'b2')], refuse: (args) => refuse(args) || undefined });

    const { text, code } = await here.run();

    assert.notEqual(code, 0, `${what}: ${text}`);
    assert.deepEqual(left(here), [], what);
    for (const name of ['hold-a1-issue-7.json', 'hold-b2-issue-9.json']) assert.match(text, new RegExp(`removed the hold closer .*${name.replaceAll('.', '\\.')}`), `${what}: ${text}`);
    assert.match(text, /the status issue #7 was left open: .*HTTP (502: Bad Gateway|403: Forbidden)/, `${what}: ${text}`);
    assert.equal((await here.issue(7)).state, 'open', what);
    assert.equal((await here.issue(9)).state, 'closed', what);
  }
});

// proves R-SCHED-23, R-SCHED-24
test('with no rigger.config.mjs, or one that does not validate, resume removes every closer first, closes no issue, and exits non-zero naming the closers removed and why no issue was closed', async () => {
  for (const [what, config, why] of [['no config', false, /`rigger\.config\.mjs` is not in /], ['an invalid config', 'export default { repo: 7 };\n', /`rigger\.config\.mjs`: /]]) {
    const here = world({ closers: ['hold-a1-issue-7.json', 'owner-o4.json'], issues: [status(7, 'a1')], config });

    const { text, code } = await here.run();

    assert.equal(code, 1, `${what}: ${text}`);
    assert.deepEqual(left(here), [], what);
    assert.match(text, /removed the hold closer .*hold-a1-issue-7\.json/, what);
    assert.match(text, /removed the owner closer .*owner-o4\.json/, what);
    assert.match(text, new RegExp(`no status issue was closed, because ${why.source}`), `${what}: ${text}`);
    assert.deepEqual(here.sent, [], what);
    assert.equal((await here.issue(7)).state, 'open', what);
  }
});

// proves R-SCHED-23, R-SCHED-24
test('where the read of the open issues carrying the label is refused, resume still removes every closer, removes the label from each issue a closer named and closes it, leaves every other open, and exits non-zero naming the read', async () => {
  const here = world({
    closers: ['hold-a1-issue-7.json'],
    issues: [status(7, 'a1'), status(9, 'z9')],
    refuse: (args) => (args[1] === 'graphql' && args[3].includes('issues(states: [OPEN]') ? refused('HTTP 502: Bad Gateway') : undefined),
  });

  const { text, code } = await here.run();

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), []);
  assert.match(text, /the read of the open issues labelled rigger:status failed, so only the issues the closers named were closed: .*HTTP 502/, text);
  assert.equal((await here.issue(7)).state, 'closed');
  assert.deepEqual((await here.issue(7)).labels, []);
  assert.equal((await here.issue(9)).state, 'open');
});

// proves R-SCHED-23
test('resume over an unreadable closer names it, changes nothing, closes no issue and exits non-zero', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  seed(join(here.repository, '.rigger'), 'not-a-closer');

  const { text, code } = await here.run();

  assert.notEqual(code, 0, text);
  assert.match(text, /not-a-closer \(no closer form\)/, text);
  assert.deepEqual(left(here).sort(), ['hold-a1-issue-7.json', 'not-a-closer']);
  assert.deepEqual(here.sent, []);
  assert.equal((await here.issue(7)).state, 'open');
});

// proves R-SCHED-23
test('resume with nothing to remove removes no label, closes no issue, reads no config and exits 0', async () => {
  const here = world({ issues: [status(7, 'a1')], config: 'throw new Error(\'this config was read\');\n' });

  const { text, code } = await here.run();

  assert.equal(code, 0, text);
  assert.equal(text, 'rigger resume: admission was already open');
  assert.deepEqual(here.sent, []);
  assert.deepEqual((await here.issue(7)).labels, [STATUS]);
});

// proves R-SCHED-24
test('the README\'s resume line says the verb closes the status issue, and the verb\'s summary equals it', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const [, comment] = /^npx @williacj\/rigger resume\s+# (.*)$/m.exec(readme) ?? [];

  assert.equal(comment, 'reopen admission and close the status issue');
  assert.deepEqual(VERBS.find(([verb]) => verb === 'resume'), ['resume', comment]);
});
