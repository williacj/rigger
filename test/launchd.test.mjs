// ABOUTME: Checks launchd's loaded fields, the config's cleanup bound and doctor's launchd line without host reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as config from '../src/config/validate.mjs';
import { CHECKS, doctor } from '../src/cli/doctor.mjs';
import { configured, launchdLine, packageProgram } from './launchd-fixtures.mjs';
import { loadedJob } from '../src/substrate/launchd.mjs';
import { NOT_STARTED, EVENT_REFUSED } from '../src/substrate/process.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// Buffer fields, exit and timedOut are runCommand's contract. Field spelling: S1 Q-d2, S2 Q-n1.
const printed = (text, exit = 0, timedOut = false) => ({ stdout: Buffer.from(text), stderr: Buffer.from(''), exit, timedOut });
const JOB = 'gui/501/com.williacj.rigger = {\n\tprogram = /installed/rigger\n\texit timeout = 180\n\tlast exit code = 78: EX_CONFIG\n}\n';

// The card's Table B fixes 15,000 ms per dispatch and excludes the owner from agent panels.
test('the launchd exit bound covers every Table B panel and concurrency case in milliseconds', () => {
  assert.equal(typeof config.launchdExitTimeout, 'function', 'config exports the launchd exit bound');
  assert.equal(config.DEFAULT_CONCURRENCY, 3);
  const panel = ['reviewer', { role: 'architect', provider: 'codex' }, 'engineer', 'owner'];
  const cases = [
    [{ concurrency: 4, kinds: { change: { judges: panel } } }, 180_000],
    [{ kinds: { change: { judges: ['reviewer', 'architect'] } } }, 90_000],
    [{ concurrency: 2, kinds: { change: { judges: ['owner'] }, spike: { judges: [] } } }, 30_000],
    [{ concurrency: 5, kinds: { spike: { judges: ['reviewer'] }, change: { judges: panel } } }, 225_000],
  ];
  for (const [given, expected] of cases) assert.equal(config.launchdExitTimeout(given), expected, JSON.stringify(given));
  const loop = readFileSync(new URL('../src/scheduling/loop.mjs', import.meta.url), 'utf8');
  assert.match(loop, /import \{ DEFAULT_CONCURRENCY \} from '\.\.\/config\/validate\.mjs'/);
  assert.doesNotMatch(loop, /const DEFAULT_CONCURRENCY\s*=/);
});

test('the guide points the launchd job troubleshooting row at the README installation heading', () => {
  const guide = readFileSync(new URL('../docs/guide.md', import.meta.url), 'utf8');
  const troubleshooting = guide.split('## Troubleshooting\n')[1].split(/\n## /)[0];
  const row = troubleshooting.split('\n').find((line) => line.startsWith('| launchd job |')) ?? '';
  assert.match(row, /\[Installing the launchd job\]\(\.\.\/README\.md#installing-the-launchd-job\)/);
});

test('doctor fails a loaded job whose program names no file even without EX_CONFIG words', async () => {
  const { target, options } = configured();
  const program = join(target, 'missing rigger');
  assert.equal(existsSync(program), false);
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
  assert.match(launchdLine(ran), /^\s*failed\s+launchd job:/);
  assert.ok(launchdLine(ran).includes(program), ran.text);
  assert.equal(ran.code, 1, ran.text);
  assert.equal(existsSync(program), false);
  assert.deepEqual(CHECKS.slice(-2).map((check) => check.name), ['admissionCheck', 'launchdCheck']);
});

test('doctor omits the launchd line and never asks L0 on a non-macOS platform', async () => {
  const { options } = configured();
  for (const platform of ['linux', 'win32']) {
    const ran = await doctor({ ...options, platform, readLaunchdJob: () => assert.fail('non-macOS must not read launchd') });
    assert.equal(launchdLine(ran), '', ran.text);
    assert.equal(ran.code, 0, ran.text);
    assert.match(ran.text, /1 of 1 checks passed/);
  }
});

test('doctor omits a job L0 reports not loaded and binds the requested label to the shipped template', async () => {
  const { options } = configured();
  const labels = [];
  let ran;
  await assert.doesNotReject(async () => {
    ran = await doctor({ ...options, readLaunchdJob: async (label) => { labels.push(label); return null; } });
  }, 'a not-loaded job is omitted without failing doctor');
  const template = readFileSync(new URL('../templates/launchd/com.williacj.rigger.plist', import.meta.url), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const label = template.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  assert.ok(label, 'the template declares its Label');
  assert.deepEqual(labels, [label]);
  assert.equal(launchdLine(ran), '', ran.text);
  assert.match(ran.text, /1 of 1 checks passed/);
  assert.equal(ran.code, 0, ran.text);
});

test('L0 distinguishes exit 113 from other statuses and from a timeout before reading fields', async () => {
  const call = (result) => loadedJob('com.williacj.rigger', { uid: 501, run: async () => result });
  let absent;
  await assert.doesNotReject(async () => { absent = await call(printed('', 113)); }, 'exit 113 means not loaded');
  assert.equal(absent, null);
  for (const status of [1, 3, 5, 78, 127]) {
    await assert.rejects(call(printed(JOB, status)), new RegExp(`exited ${status}`));
  }
  await assert.rejects(call(printed(JOB, 113, true)), /timeout/);
});

test('L0 refuses missing duplicate nested or malformed program and exit timeout fields', async () => {
  const cases = [
    '', JOB.replace('\tprogram = /installed/rigger\n', ''),
    JOB.replace('\texit timeout = 180\n', ''),
    JOB.replace('exit timeout = 180', 'exit timeout = 180x'),
    JOB.replace('exit timeout = 180', 'exit timeout = 9007199254740993'),
    JOB.replace('program = /installed/rigger', 'program = relative/rigger'),
    JOB.replace('\tprogram =', '\tprogram = /another/rigger\n\tprogram ='),
    JOB.replace('\texit timeout =', '\texit timeout = 999\n\texit timeout ='),
    JOB.replace('\texit timeout =', '\t\texit timeout ='),
  ];
  for (const text of cases) {
    await assert.rejects(loadedJob('com.williacj.rigger', { uid: 501, run: async () => printed(text) }),
      /cannot read.*program.*exit timeout/, JSON.stringify(text));
  }
});

test('doctor reports every unread launchd cause as not asked and fails its exit', async () => {
  const { options } = configured();
  const missing = Object.assign(new Error('launchctl could not be run: not found'), { code: NOT_STARTED });
  const cases = [
    [async () => { throw missing; }, /not found/],
    [async () => loadedJob('label', { uid: 501, run: async () => printed(JOB, 5) }), /exited 5/],
    [async () => loadedJob('label', { uid: 501, run: async () => printed(JOB, null, true) }), /timeout/],
    [async () => loadedJob('label', { uid: 501, run: async () => printed('unreadable') }), /cannot read/],
    [async () => loadedJob('label', { uid: 501, run: async () => printed(JOB.replace('\texit timeout = 180\n', '')) }), /exit timeout/],
  ];
  for (const [readLaunchdJob, why] of cases) {
    let ran;
    await assert.doesNotReject(async () => { ran = await doctor({ ...options, readLaunchdJob }); }, 'an unread job still prints its report');
    assert.match(launchdLine(ran), /^\s*not asked\s+launchd job:/);
    assert.match(launchdLine(ran), why);
    assert.equal(ran.code, 1, ran.text);
  }
});

test('doctor refuses a directory as the program and also refuses a dangling program link', async () => {
  const { target, options } = configured();
  const dangling = join(target, 'dangling');
  symlinkSync(join(target, 'absent'), dangling);
  const directory = dirname(packageProgram(join(temporaryDirectory('997-directory-'), 'node_modules', '@williacj', 'rigger')));
  for (const program of [directory, dangling]) {
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
    assert.match(launchdLine(ran), /^\s*failed\s+launchd job:/);
    assert.ok(launchdLine(ran).includes(program), ran.text);
    assert.equal(ran.code, 1, ran.text);
  }
});

test('doctor compares seconds with the config bound in milliseconds including the five-second default and exact threshold', async () => {
  const { options } = configured();
  const program = packageProgram(join(temporaryDirectory('997-global-'), 'node_modules', '@williacj', 'rigger'));
  for (const [exitTimeout, expected] of [[5, 1], [179, 1], [180, 0], [181, 0]]) {
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout }) });
    assert.equal(ran.code, expected, ran.text);
    const line = launchdLine(ran);
    assert.ok(line.includes('com.williacj.rigger'), line);
    assert.ok(line.includes(program), line);
    assert.ok(line.includes(`${exitTimeout} s`), line);
    assert.ok(line.includes('180 s'), line);
  }
  const source = readFileSync(new URL('../src/cli/doctor.mjs', import.meta.url), 'utf8');
  assert.match(source, /launchdExitTimeout\(config\)\s*\/\s*1_?000/);
  assert.doesNotMatch(source, /\bKILL_BOUND\b|\bREAD_TIMEOUT\b|\bDEFAULT_CONCURRENCY\b/);
});

test('a loaded job with absent unreadable refused or throwing config cannot pass an uncomputed bound', async () => {
  for (const source of [null, 'export default {', 'export default {};', 'throw null;', 'export default { get repo() { throw new Error("config getter"); } };']) {
    const { target, options } = configured();
    if (source === null) unlinkSync(join(target, 'rigger.config.mjs'));
    else writeFileSync(join(target, 'rigger.config.mjs'), source);
    const program = packageProgram(join(temporaryDirectory('997-global-'), 'node_modules', '@williacj', 'rigger'));
    let ran;
    await assert.doesNotReject(async () => {
      ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
    }, 'an unavailable config is a report, not a crash');
    assert.match(launchdLine(ran), /^\s*not asked\s+launchd job:.*bound.*config/);
    assert.equal(ran.code, 1, ran.text);
  }
});

test('doctor reports both a missing program and its short timeout in the same failing line', async () => {
  const { target, options } = configured();
  const program = join(target, 'missing-program');
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 5 }) });
  const line = launchdLine(ran);
  assert.ok(line.includes(program), line);
  assert.match(line, /5 s/);
  assert.match(line, /180 s/);
  assert.match(line, /ENOENT/);
  assert.match(line, /below the bound/);
  assert.equal(ran.code, 1, ran.text);
});

test('doctor refuses real program paths in the target including its node_modules and symlink spellings', async () => {
  const { target, options } = configured();
  const direct = packageProgram(target);
  const installed = packageProgram(join(target, 'node_modules', '@williacj', 'rigger'));
  const alias = join(temporaryDirectory('997-alias-'), 'program');
  symlinkSync(installed, alias);
  for (const program of [direct, installed, alias]) {
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
    assert.match(launchdLine(ran), /^\s*failed\s+launchd job:.*R-SAFE-5/);
    assert.ok(launchdLine(ran).includes(program), ran.text);
    assert.equal(ran.code, 1, ran.text);
  }
});

test('doctor refuses a source checkout npx cache and a manifest that only mentions Rigger in text', async () => {
  const { options } = configured();
  const source = packageProgram(temporaryDirectory('997-checkout-'));
  const cached = packageProgram(join(temporaryDirectory('997-cache-'), '_npx', 'hash', 'node_modules', '@williacj', 'rigger'));
  const otherRoot = join(temporaryDirectory('997-other-'), 'node_modules', '@williacj', 'rigger');
  const other = packageProgram(otherRoot);
  writeFileSync(join(otherRoot, 'package.json'), '{"name":"other","description":"@williacj/rigger"}');
  for (const program of [source, cached, other]) {
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
    assert.match(launchdLine(ran), /^\s*failed\s+launchd job:/);
    assert.ok(launchdLine(ran).includes(program), ran.text);
    assert.equal(ran.code, 1, ran.text);
  }
});

test('doctor compares the installed package root both ways when the target lies inside it', async () => {
  const root = join(temporaryDirectory('997-parent-package-'), 'node_modules', '@williacj', 'rigger');
  const program = packageProgram(root);
  const { options } = configured(join(root, 'consumer'));
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
  assert.match(launchdLine(ran), /^\s*failed\s+launchd job:.*R-SAFE-5/);
  assert.equal(ran.code, 1, ran.text);
});

test('a program path carrying quotes unicode and a newline stays on one doctor line', async () => {
  const { options } = configured();
  const root = join(temporaryDirectory('997-path-'), 'é "quoted"\n  ok forged', 'node_modules', '@williacj', 'rigger');
  const program = packageProgram(root);
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180, lastExitCode: '78: EX_CONFIG' }) });
  assert.equal(ran.text.split('\n').length, 3, ran.text);
  assert.ok(launchdLine(ran).includes(program.replaceAll('\n', '\\n')), ran.text);
  assert.equal(ran.code, 0, ran.text);
});

test('doctor accepts the named scoped installation outside the target and its program symlink', async () => {
  const { options } = configured();
  const program = packageProgram(join(temporaryDirectory('997-scoped-'), 'node_modules', '@williacj', 'rigger'));
  const alias = join(temporaryDirectory('997-scoped-link-'), 'rigger');
  symlinkSync(program, alias);
  for (const path of [program, alias]) {
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program: path, exitTimeout: 180 }) });
    assert.equal(ran.code, 0, ran.text);
    assert.ok(launchdLine(ran).includes(path), ran.text);
  }
});

test('doctor refuses an unscoped layout even when its parsed manifest names the scoped Rigger package', async () => {
  const { options } = configured();
  const program = packageProgram(join(temporaryDirectory('997-unscoped-'), 'node_modules', 'rigger'));
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 180 }) });
  assert.equal(ran.code, 1, ran.text);
  assert.match(launchdLine(ran), /layout/);
  assert.ok(launchdLine(ran).includes(program), ran.text);
});

test('L0 forwards the process-adapter call and returns only parsed loaded-job fields', async () => {
  const emitter = { emit() { assert.fail('the injected adapter emits nothing'); } };
  const sent = [];
  const program = '/installed/é "quoted" = rigger';
  const value = await loadedJob('controlled.label', {
    uid: 917, timeout: 1234, emitter,
    run: async (options) => {
      sent.push(options);
      return printed(JOB.replace('/installed/rigger', program).replace('\tlast exit code', '\tconcurrency = 900\n\tlast exit code'));
    },
  });
  assert.deepEqual(value, { program, exitTimeout: 180 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].command, 'launchctl');
  assert.deepEqual(sent[0].args, ['print', 'gui/917/controlled.label']);
  assert.equal(sent[0].emitter, emitter);
  assert.equal(sent[0].timeout, 1234);
});

test('a refused L0 event stops doctor before any later check instead of becoming a launchd verdict', async () => {
  const { options } = configured();
  const refusal = Object.assign(new Error('L0 sink refused a kill'), { code: EVENT_REFUSED });
  const ran = await doctor({ ...options,
    readLaunchdJob: async () => { throw refusal; },
    checks: [...options.checks, () => assert.fail('a refused event must stop later checks')],
  });
  assert.equal(ran.code, 1, ran.text);
  assert.match(ran.text, /L0 sink refused a kill/);
  assert.doesNotMatch(ran.text, /checks passed|not asked/);
});

test('a target-contained program still names R-SAFE-5 when its package manifest cannot be parsed', async () => {
  const { target, options } = configured();
  const root = join(target, 'node_modules', '@williacj', 'rigger');
  const program = packageProgram(root);
  writeFileSync(join(root, 'package.json'), '{');
  const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: 5 }) });
  assert.match(launchdLine(ran), /R-SAFE-5/);
  assert.match(launchdLine(ran), /below the bound/);
  assert.equal(ran.code, 1, ran.text);
});

test('every program or config refusal leaves the target and package bytes names and metadata unchanged', async () => {
  const entries = (root) => [root, ...readdirSync(root, { recursive: true }).map((name) => join(root, name))].sort();
  const stamp = (root) => entries(root).map((path) => {
    const { ino, mtimeNs, mode, nlink } = lstatSync(path, { bigint: true });
    return { path, ino, mtimeNs, mode, nlink, bytes: lstatSync(path).isFile() ? readFileSync(path).toString('hex') : null };
  });
  for (const cause of ['missing', 'directory', 'target', 'source', 'npx', 'manifest', 'timeout', 'config', 'unscoped']) {
    const { target, options } = configured();
    const base = cause === 'target' ? target : temporaryDirectory('997-read-only-');
    const root = cause === 'source' ? base : cause === 'unscoped' ? join(base, 'node_modules', 'rigger')
      : join(base, ...(cause === 'npx' ? ['_npx', 'hash'] : []), 'node_modules', '@williacj', 'rigger');
    const file = packageProgram(root);
    const program = cause === 'missing' ? join(root, 'absent') : cause === 'directory' ? dirname(file) : file;
    if (cause === 'manifest') writeFileSync(join(root, 'package.json'), '{"name":"other"}');
    if (cause === 'config') unlinkSync(join(target, 'rigger.config.mjs'));
    for (const path of [...entries(target), ...entries(root)]) utimesSync(path, 0, 0);
    const before = [stamp(target), stamp(root)];
    const ran = await doctor({ ...options, readLaunchdJob: async () => ({ program, exitTimeout: cause === 'timeout' ? 5 : 180 }) });
    assert.equal(ran.code, 1, `${cause}: ${ran.text}`);
    assert.deepEqual([stamp(target), stamp(root)], before, `${cause} changed the filesystem`);
  }
});
