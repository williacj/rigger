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
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { TIME, admissionOf, closerText, seed } from './admission-world.mjs';
import { moduleOver, recordingSink, stateOf } from './admission-world.mjs';
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

/**
 * A config whose evaluation leaves a mark at `mark`, whatever its importer then does with it, and
 * which throws, so a reader that swallowed the throw still leaves the mark.
 */
const marking = (mark) => `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(mark)}, 'evaluated');\nthrow new Error('this config was read');\n`;

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
  const mark = join(temporaryDirectory('rigger-resume-close-mark-'), 'evaluated');
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')], config: marking(mark) });
  const unlinkSync = (path) => { nodeFs.unlinkSync(path); nodeFs.unlinkSync(path); };

  const { text, code } = await here.run({ fs: { ...nodeFs, unlinkSync } });

  assert.equal(code, 0, text);
  assert.match(text, /hold-a1-issue-7\.json was already gone/, text);
  assert.doesNotMatch(text, /config was read|closed the status issue/, text);
  assert.equal(nodeFs.existsSync(mark), false, 'resume evaluated the config');
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
    assert.match(text, /the status issue #7 was left open(, its status label already removed, so no later read by label finds it)?: .*HTTP (502: Bad Gateway|403: Forbidden)/, `${what}: ${text}`);
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
  const mark = join(temporaryDirectory('rigger-resume-close-mark-'), 'evaluated');
  const here = world({ issues: [status(7, 'a1')], config: marking(mark) });

  const { text, code } = await here.run();

  assert.equal(code, 0, text);
  assert.equal(text, 'rigger resume: admission was already open');
  assert.equal(nodeFs.existsSync(mark), false, 'resume evaluated the config');
  assert.deepEqual(here.sent, []);
  assert.deepEqual((await here.issue(7)).labels, [STATUS]);
});

test('the README\'s resume line says the verb closes the status issue, and the verb\'s summary equals it', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const [, comment] = /^npx @williacj\/rigger resume\s+# (.*)$/m.exec(readme) ?? [];

  assert.equal(comment, 'reopen admission and close the status issue');
  assert.deepEqual(VERBS.find(([verb]) => verb === 'resume'), ['resume', comment]);
});

/**
 * A spawn over `gh` that, for the request `matches` names, lets the stand-in make the write and
 * then rejects as L0 does where the sink refused the call's `call.end`: `EVENT_REFUSED`, carrying
 * the call's result and the unrecorded event. The write side then marks the failure `made` itself.
 * Answers the spawn and `made`, the requests that were made and refused their record.
 */
function recordRefused(gh, matches) {
  const made = [];
  const send = (command, args) => {
    const result = gh(command, args);
    if (matches(args) && result.status === 0) {
      made.push(`${args[3]} ${args[1]}`);
      throw Object.assign(new Error('the sink refused 1 L0 event: call.end went unrecorded: EIO'), {
        code: 'EVENT_REFUSED',
        result: { exit: 0, timedOut: false, stdout: result.stdout, stderr: result.stderr },
        unrecorded: [{ event: 'call.end', command: 'gh', exit: 0, cause: new Error('EIO') }],
      });
    }
    return result;
  };
  return { send, made };
}

// proves R-SCHED-24
test('resume never reports a forge-confirmed close as an issue left open when only its event was refused: it says the issue was closed, names the unrecorded event, and exits non-zero', async () => {
  // The reviewer's round-2 probe on #1079.
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  const gh = statusGh({ issues: [status(7, 'a1')] });
  const { send, made } = recordRefused(gh, (args) => rest(args, '/issues/7', 'PATCH'));

  const { text, code } = await here.run({ send });

  assert.deepEqual(made, [`PATCH repos/${REPO}/issues/7`]);
  assert.equal(gh.issues[0].state, 'closed');
  assert.equal(code, 1, text);
  assert.doesNotMatch(text, /the status issue #7 was left open/, text);
  assert.match(text, /^rigger resume: closed the status issue #7, but the sink refused its record: .*call\.end went unrecorded/m, text);
});

// proves R-SCHED-24
test('a label removal the forge made whose event was refused still lets resume close the issue, and resume names the unrecorded removal and exits non-zero', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  const gh = statusGh({ issues: [status(7, 'a1')] });
  const { send, made } = recordRefused(gh, (args) => rest(args, '/issues/7/labels/rigger%3Astatus', 'DELETE'));

  const { text, code } = await here.run({ send });

  assert.deepEqual(made, [`DELETE repos/${REPO}/issues/7/labels/rigger%3Astatus`]);
  assert.deepEqual([gh.issues[0].state, gh.issues[0].labels], ['closed', []]);
  assert.equal(code, 1, text);
  assert.doesNotMatch(text, /left open/, text);
  assert.match(text, /^rigger resume: removed the status label from issue #7, but the sink refused its record: .*call\.end went unrecorded/m, text);
  assert.match(text, /^rigger resume: closed the status issue #7$/m, text);
});

// proves R-SCHED-24
test('resume reports a close the forge made truthfully when only its event was refused, and goes on to close the next issue carrying the label', async () => {
  // The architect's round-2 probe on #1079: the real repository-write side marks the refusal made,
  // with the forge's answer, before L2 sees it.
  const here = world({ closers: ['hold-a1-issue-7.json'] });
  const gh = statusGh({ issues: [7, 9].map((number) => ({ number, labels: [STATUS] })) });
  let refusal;
  const send = (command, args) => {
    const answer = gh(command, args);
    if (rest(args, '/issues/7', 'PATCH')) {
      refusal = Object.assign(new Error('the sink refused 1 L0 event(s): call.end: EIO'), {
        code: 'EVENT_REFUSED',
        result: { exit: answer.status, timedOut: false, stdout: Buffer.from(answer.stdout), stderr: Buffer.from('') },
        unrecorded: [{ event: 'call.end', command: 'gh', exit: 0, cause: new Error('EIO') }],
      });
      throw refusal;
    }
    return answer;
  };

  const { text, code } = await here.run({ send });

  assert.equal(refusal.made.answer.state, 'closed', 'the repository-write side must confirm that the close was made');
  assert.deepEqual(gh.issues.map(({ number, state }) => [number, state]), [[7, 'closed'], [9, 'closed']]);
  assert.equal(code, 1, text);
  assert.match(text, /call\.end: EIO/, text);
  assert.doesNotMatch(text, /the status issue #7 was left open/, text);
  assert.match(text, /^rigger resume: closed the status issue #9$/m, text);
});

// proves R-SCHED-24
test('resume, whose close of an issue is refused after its status label was removed, names the issue left open and that its label is already gone', async () => {
  // The pre-judge attack of round 8 on #1079: no later read by label finds such an issue.
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')], refuse: (args) => (rest(args, '/issues/7', 'PATCH') ? refused('HTTP 403: Forbidden') : undefined) });

  const { text, code } = await here.run();

  assert.equal(code, 1, text);
  assert.deepEqual(here.issue(7).labels, []);
  assert.equal(here.issue(7).state, 'open');
  assert.match(text, /^rigger resume: the status issue #7 was left open, its status label already removed, so no later read by label finds it: .*HTTP 403/m, text);
});

// proves R-SCHED-24
test('resume whose removal stops partway names each closer it already removed, the closer left and why, and that no status issue was closed', async () => {
  // The pre-judge re-attack of round 9 on #1079: the second closer's unlink is refused.
  const here = world({ closers: ['hold-a1-issue-7.json', 'hold-b2-issue-8.json'], issues: [status(7, 'a1'), status(8, 'b2')] });
  const unlinkSync = (path) => {
    if (String(path).endsWith('hold-b2-issue-8.json')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return nodeFs.unlinkSync(path);
  };

  const { text, code } = await here.run({ fs: { ...nodeFs, unlinkSync } });

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), ['hold-b2-issue-8.json']);
  assert.match(text, /^rigger resume: removed the hold closer .*hold-a1-issue-7\.json/m, text);
  assert.match(text, /left .*hold-b2-issue-8\.json.*EACCES/, text);
  assert.match(text, /^rigger resume: no status issue was closed, because /m, text);
  assert.deepEqual(here.sent, [], text);
});

// proves R-SCHED-24
test('resume, whose admission.open record is refused after a later removal, names every closer and the refusal and closes every status issue', async (t) => {
  // Both judges' round-8 probe on #1079: the second removal's record is refused by a real
  // read-only stream after the first removal and its record succeeded.
  const here = world({ closers: ['hold-a1-issue-7.json', 'hold-b2-issue-8.json'], issues: [status(7, 'a1'), status(8, 'b2')] });
  const stream = join(here.repository, '.rigger', 'events.jsonl');
  let armed = false;
  t.after(() => { if (armed) nodeFs.chmodSync(stream, 0o644); });
  const unlinkSync = (path) => {
    nodeFs.unlinkSync(path);
    if (String(path).endsWith('hold-b2-issue-8.json')) {
      nodeFs.chmodSync(stream, 0o444);
      armed = true;
    }
  };

  const { text, code } = await here.run({ fs: { ...nodeFs, unlinkSync } });

  assert.equal(armed, true);
  assert.deepEqual(left(here), [], 'both closers were removed');
  assert.equal(code, 1, text);
  assert.deepEqual([here.issue(7).state, here.issue(8).state], ['closed', 'closed']);
  assert.match(text, /^rigger resume: removed the hold closer .*hold-a1-issue-7\.json/m, text);
  assert.match(text, /^rigger resume: removed the hold closer .*hold-b2-issue-8\.json/m, text);
  assert.match(text, /hold-b2-issue-8\.json, and the sink refused its admission\.open event/, text);
  assert.match(text, /^rigger resume: closed the status issue #7$/m, text);
  assert.match(text, /^rigger resume: closed the status issue #8$/m, text);
});

// proves R-SCHED-23
test('resume whose admission rejects with a failure admission did not build, carrying removed and unreadable fields, says that failure whole and reads neither field', async () => {
  // The round-14 audit on #1079: only a failure admission built is read for the closers it removed.
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  const forged = Object.assign(new Error('EIO a foreign close'), { removed: [{ kind: 'hold', id: 'zz', name: 'hold-zz.json' }], unreadable: [{ path: '/forged', cause: 'forged' }] });
  const closeSync = () => { throw forged; };

  const { text, code } = await here.run({ fs: { ...nodeFs, closeSync } });

  assert.notEqual(code, 0, text);
  assert.match(text, /EIO a foreign close/, text);
  assert.doesNotMatch(text, /\/forged|hold-zz/, text);
});

// Round 12 on #1079 (U109 rule 4): every line `resume` prints from text that came from outside Rigger
// is printable, each control character written as its escape and none dropped.
const ESCAPE = '\u001b[31m forged terminal text\u009b2J';

/** `text` holds no raw control character, and holds `ESCAPE` written visibly. */
const printed = (text) => {
  assert.doesNotMatch(text.replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f]/, text);
  assert.ok(text.includes('\\u001b[31m forged terminal text\\u009b2J'), text);
};

// proves R-SCHED-24
test('resume prints a refused read of the open issues carrying the label, whose gh answer holds terminal controls, with each control written as its escape', async () => {
  // The reviewer's round-12 probe on #1079.
  const here = world({
    closers: ['hold-a1-issue-7.json'],
    issues: [status(7, 'a1')],
    refuse: (args) => (args[1] === 'graphql' && args[3].includes('issues(states: [OPEN]') ? refused(`HTTP 502${ESCAPE}`) : undefined),
  });

  const { text, code } = await here.run();

  assert.equal(code, 1, text);
  printed(text);
});

// proves R-SCHED-24
test('resume prints an issue left open for a refused read whose gh answer holds terminal controls with each control written as its escape', async () => {
  const here = world({
    closers: ['hold-a1-issue-7.json'],
    issues: [status(7, 'a1')],
    refuse: (args) => (args[1] === 'graphql' && args[3].includes('issue(number: 7) { number') ? refused(`HTTP 502${ESCAPE}`) : undefined),
  });

  const { text, code } = await here.run();

  assert.equal(code, 1, text);
  assert.match(text, /the status issue #7 was left open/, text);
  printed(text);
});

// proves R-SCHED-24
test('resume prints a refused record of a write the forge made, whose refusal holds terminal controls, with each control written as its escape', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  const gh = statusGh({ issues: [status(7, 'a1')] });
  const send = (command, args) => {
    const result = gh(command, args);
    if (rest(args, '/issues/7', 'PATCH') && result.status === 0) {
      throw Object.assign(new Error(`the sink refused 1 L0 event: call.end went unrecorded${ESCAPE}`), { code: 'EVENT_REFUSED', result: { exit: 0, timedOut: false, stdout: result.stdout, stderr: result.stderr }, unrecorded: [{ event: 'call.end' }] });
    }
    return result;
  };

  const { text, code } = await here.run({ send });

  assert.equal(code, 1, text);
  assert.match(text, /closed the status issue #7, but the sink refused its record/, text);
  printed(text);
});

// proves R-SCHED-23
test('resume prints a config that throws text holding terminal controls with each control written as its escape, after naming the closers it removed', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')], config: `throw new Error(${JSON.stringify(`the config refused${ESCAPE}`)});\n` });

  const { text, code } = await here.run();

  assert.equal(code, 1, text);
  assert.match(text, /no status issue was closed, because/, text);
  printed(text);
});

// proves R-SCHED-23
test('resume prints a failure admission did not build, holding terminal controls, with each control written as its escape', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')] });
  const closeSync = () => { throw new Error(`EIO a foreign close${ESCAPE}`); };

  const { text, code } = await here.run({ fs: { ...nodeFs, closeSync } });

  assert.notEqual(code, 0, text);
  printed(text);
});

// proves R-SCHED-24
test('resume prints a forge refusal of an issue\'s label removal or its close, whose text holds terminal controls, with each control written as its escape', async () => {
  for (const [what, refuse] of [
    ['its label removal', (args) => rest(args, '/issues/7/labels/rigger%3Astatus', 'DELETE')],
    ['its close', (args) => rest(args, '/issues/7', 'PATCH')],
  ]) {
    const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1')], refuse: (args) => (refuse(args) ? refused(`HTTP 403${ESCAPE}`) : undefined) });

    const { text, code } = await here.run();

    assert.equal(code, 1, `${what}: ${text}`);
    assert.match(text, /the status issue #7 was left open/, `${what}: ${text}`);
    printed(text);
  }
});

// proves R-SCHED-23, R-SCHED-24
test('resume closes every status issue after the only closer removal event is refused, then a second resume finds admission open', async () => {
  const here = world({ closers: ['hold-a1-issue-7.json'], issues: [status(7, 'a1'), status(9, 'z9')] });
  const first = await withRemovalRecords(here, ['hold-a1-issue-7.json']);

  assert.deepEqual(left(here), []);
  assert.deepEqual([here.issue(7).state, here.issue(9).state], ['closed', 'closed']);
  assert.equal(first.code, 1, first.text);
  assert.match(first.text, /removed the hold closer .*hold-a1-issue-7\.json/, first.text);
  assert.match(first.text, /hold-a1-issue-7\.json.*admission\.open event/, first.text);
  for (const number of [7, 9]) assert.match(first.text, new RegExp(`closed the status issue #${number}`), first.text);

  const second = await here.run();
  assert.equal(second.code, 0, second.text);
  assert.equal(second.text, 'rigger resume: admission was already open');
  assert.deepEqual([here.issue(7).state, here.issue(9).state], ['closed', 'closed']);
});

/** A real L5 append refusal for each named unlink; restores permissions even when the verb fails. */
async function withRemovalRecords(here, refusedNames) {
  const stream = join(here.repository, '.rigger', 'events.jsonl');
  writeFileSync(stream, '', { mode: 0o644 });
  const unlinkSync = (path) => {
    nodeFs.unlinkSync(path);
    nodeFs.chmodSync(stream, refusedNames.some((name) => String(path).endsWith(`/${name}`)) ? 0o444 : 0o644);
  };
  try {
    return await here.run({ fs: { ...nodeFs, unlinkSync } });
  } finally {
    if (nodeFs.existsSync(stream)) nodeFs.chmodSync(stream, 0o644);
  }
}

/** L3's answer for a cell, after it reads and removes each closer. */
async function l3Removal(closers, refusedNames) {
  const state = stateOf();
  for (const name of closers) seed(state, name);
  const { sink } = recordingSink((event, fields) => {
    if (event === 'admission.open' && refusedNames.includes(fields.name)) throw new Error(`EIO on ${fields.name}`);
  });
  const answer = await moduleOver(state, { sink }).resume();
  assert.deepEqual(readdirSync(admissionOf(state)), []);
  assert.deepEqual(answer.removed.map(({ name }) => name), closers);
  assert.deepEqual(answer.unrecorded.map(({ name }) => name), refusedNames);
}

/** One refused-removal cell: the sink records accepted opens and names refused ones. */
async function removalCell(closers, numbers, refusedNames) {
  const here = world({ closers, issues: [...numbers.map((number, index) => status(number, ['a1', 'b2', 'c3'][index])), status(10, 'extra')] });
  const { text, code } = await withRemovalRecords(here, refusedNames);

  assert.deepEqual(left(here), []);
  assert.equal(code, refusedNames.length ? 1 : 0, text);
  for (const name of closers) assert.match(text, new RegExp(`removed the hold closer .*${name.replaceAll('.', '\\.')}`), text);
  for (const number of [...numbers, 10]) {
    assert.equal(here.issue(number).state, 'closed', `#${number}: ${text}`);
    assert.match(text, new RegExp(`closed the status issue #${number}`), text);
  }
  for (const name of refusedNames) assert.match(text, new RegExp(`sink refused the admission\\.open event for ${name.replaceAll('.', '\\.')}`), text);
  const accepted = readEvents(join(here.repository, '.rigger')).filter(({ event, by }) => event === 'admission.open' && by === 'resume');
  assert.deepEqual(accepted.map(({ name }) => name), closers.filter((name) => !refusedNames.includes(name)));
  await l3Removal(closers, refusedNames);
}

const THREE = ['hold-a1-issue-7.json', 'hold-b2-issue-8.json', 'hold-c3-issue-9.json'];

// proves R-SCHED-23, R-SCHED-24
test('resume continues after the first of three removal records is refused', () => removalCell(THREE, [7, 8, 9], [THREE[0]]));

// proves R-SCHED-23, R-SCHED-24
test('resume continues after the middle of three removal records is refused', () => removalCell(THREE, [7, 8, 9], [THREE[1]]));

// proves R-SCHED-23, R-SCHED-24
test('resume reports the last of three removal records refused after closing all issues', () => removalCell(THREE, [7, 8, 9], [THREE[2]]));

// proves R-SCHED-23, R-SCHED-24
test('resume reports both removal records refused and closes all issues', () => removalCell(THREE.slice(0, 2), [7, 8], THREE.slice(0, 2)));

// proves R-SCHED-23, R-SCHED-24
test('resume reports all three removal records refused and closes all issues', () => removalCell(THREE, [7, 8, 9], THREE));

// proves R-SCHED-23, R-SCHED-24
test('resume with one or three closers and no refused record closes all issues and exits zero', async () => {
  await removalCell(THREE.slice(0, 1), [7], []);
  await removalCell(THREE, [7, 8, 9], []);
});

// proves R-SCHED-23, R-SCHED-24
test('resume names a first refused record and a later unlink failure, leaves the second closer and closes no issue', async () => {
  const here = world({ closers: THREE.slice(0, 2), issues: [status(7, 'a1'), status(8, 'b2'), status(10, 'extra')] });
  const { sink } = recordingSink((event, fields) => {
    if (event === 'admission.open' && fields.name === THREE[0]) throw new Error('EIO');
  });
  const unlinkSync = (path) => {
    if (String(path).endsWith(THREE[1])) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    return nodeFs.unlinkSync(path);
  };

  const { text, code } = await here.run({ sink, fs: { ...nodeFs, unlinkSync } });

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), [THREE[1]]);
  assert.deepEqual([7, 8, 10].map((number) => here.issue(number).state), ['open', 'open', 'open']);
  assert.match(text, /removed the hold closer .*hold-a1-issue-7\.json/, text);
  assert.match(text, /sink refused the admission\.open event for hold-a1-issue-7\.json/, text);
  assert.match(text, /resume left hold-b2-issue-8\.json: EACCES/, text);
  assert.match(text, /no status issue was closed/, text);
});

// proves R-SCHED-23, R-SCHED-24
test('resume names a refused removal and missing config after unlinking, leaving every issue open', async () => {
  await l3Removal([THREE[0]], [THREE[0]]);
  const here = world({ closers: [THREE[0]], issues: [status(7, 'a1'), status(10, 'extra')], config: false });
  const { sink } = recordingSink((event) => { if (event === 'admission.open') throw new Error('EIO'); });

  const { text, code } = await here.run({ sink });

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), []);
  assert.deepEqual(here.sent, []);
  assert.deepEqual([here.issue(7).state, here.issue(10).state], ['open', 'open']);
  assert.match(text, /removed the hold closer .*hold-a1-issue-7\.json/, text);
  assert.match(text, /sink refused the admission\.open event for hold-a1-issue-7\.json/, text);
  assert.match(text, /no status issue was closed, because `rigger\.config\.mjs` is not in /, text);
});

/** A forge write whose record is refused after the write: every closer and issue still completes. */
async function forgeRecordCell(count, write) {
  const closers = THREE.slice(0, count);
  await l3Removal(closers, []);
  const numbers = [7, 8].slice(0, count);
  const issues = [...numbers.map((number, index) => status(number, ['a1', 'b2'][index])), status(10, 'extra')];
  const here = world({ closers, issues });
  const gh = statusGh({ issues });
  const matcher = write === 'label'
    ? (args) => rest(args, '/issues/7/labels/rigger%3Astatus', 'DELETE')
    : (args) => rest(args, '/issues/7', 'PATCH');
  const { send, made } = recordRefused(gh, matcher);

  const { text, code } = await here.run({ send });

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), []);
  assert.equal(made.length, 1, text);
  for (const name of closers) assert.match(text, new RegExp(`removed the hold closer .*${name.replaceAll('.', '\\.')}`), text);
  for (const number of [...numbers, 10]) {
    assert.equal(gh.issues.find((issue) => issue.number === number).state, 'closed', `#${number}: ${text}`);
    assert.match(text, new RegExp(`closed the status issue #${number}`), text);
  }
  assert.match(text, new RegExp(`(?:removed the status label from issue|closed the status issue) #7, but the sink refused its record: .*call\\.end went unrecorded`), text);
}

// proves R-SCHED-23, R-SCHED-24
test('resume with one closer completes after a label-removal event is refused', () => forgeRecordCell(1, 'label'));

// proves R-SCHED-23, R-SCHED-24
test('resume with two closers completes after a label-removal event is refused', () => forgeRecordCell(2, 'label'));

// proves R-SCHED-23, R-SCHED-24
test('resume with one closer completes after a close event is refused', () => forgeRecordCell(1, 'close'));

// proves R-SCHED-23, R-SCHED-24
test('resume with two closers completes after a close event is refused', () => forgeRecordCell(2, 'close'));

// proves R-SCHED-23, R-SCHED-24
test('resume prints a middle removal refusal with line break, tab and control character as escapes on one line', async () => {
  const here = world({ closers: THREE, issues: [status(7, 'a1'), status(8, 'b2'), status(9, 'c3'), status(10, 'extra')] });
  const { sink } = recordingSink((event, fields) => {
    if (event === 'admission.open' && fields.name === THREE[1]) throw new Error('one\ntwo\tthree\u0001');
  });

  const { text, code } = await here.run({ sink });

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), []);
  assert.deepEqual([7, 8, 9, 10].map((number) => here.issue(number).state), ['closed', 'closed', 'closed', 'closed']);
  const line = text.split('\n').find((entry) => entry.includes('sink refused the admission.open event'));
  assert.match(line, /hold-b2-issue-8\.json.*one\\ntwo\\tthree\\u0001/);
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/);
});

// proves R-SCHED-23, R-SCHED-24
test('resume records each accepted closer removal around a refused middle event in the real stream', async () => {
  const here = world({ closers: THREE, issues: [status(7, 'a1'), status(8, 'b2'), status(9, 'c3'), status(10, 'extra')] });
  const { text, code } = await withRemovalRecords(here, [THREE[1]]);

  assert.equal(code, 1, text);
  assert.deepEqual(left(here), []);
  assert.deepEqual([7, 8, 9, 10].map((number) => here.issue(number).state), ['closed', 'closed', 'closed', 'closed']);
  const recorded = readEvents(join(here.repository, '.rigger')).filter(({ event, by }) => event === 'admission.open' && by === 'resume');
  assert.deepEqual(recorded.map(({ name }) => name), [THREE[0], THREE[2]]);
  assert.match(text, /sink refused the admission\.open event for hold-b2-issue-8\.json/, text);
});
