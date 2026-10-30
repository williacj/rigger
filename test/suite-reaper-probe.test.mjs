// ABOUTME: Controls the suite reaper's bounded read projection and diagnostic sessions without real processes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
import { safeTargetReadRecord, targetReadRecord, traceEvidence } from './suite-reaper-probe.mjs';
import * as reaperProbe from './suite-reaper-probe.mjs';

test('targeted read projection retains framing but hides command text and paths', () => {
  const stdout = '123 Z Mon Oct 28 10:00:00 2026 SECRET_WALRUS=/private/branch\nnext\r\n';
  for (const cell of ['E5-F1', 'E4-F6']) {
    const record = targetReadRecord({
      cell, pid: 123, readSequence: 1, parserClass: 'malformed',
      result: { status: 0, signal: null, error: null, stdout, stderr: '' },
    });
    assert.equal(record.cell, cell);
    assert.equal(record.stdoutUnits, stdout.length);
    assert.equal(record.stderrUnits, 0);
    assert.equal(record.rowCount, 2);
    assert.equal(record.separatorCount, 2);
    assert.deepEqual(record.separators, [
      { at: stdout.indexOf('\n'), kind: 'lf' },
      { at: stdout.lastIndexOf('\r\n'), kind: 'crlf' },
    ]);
    assert.doesNotMatch(JSON.stringify(record), /SECRET_WALRUS|\/private\/branch/);
    assert.match(record.skeleton, /^[Aad0. |]*$/);
  }
});

test('outer targeted-read diagnostic hides a synthetic secret and path while showing framing and parser result', () => {
  for (const cell of ['E5-F1', 'E4-F6']) {
    const trace = {
      cell, pid: 123, readSequence: 1, parserClass: 'framing', signalZero: 'not-checked',
      status: 0, signal: 'none', errorCode: 'none', stdoutUnits: 10, stderrUnits: 0,
      rowCount: 2, separatorCount: 2,
      separators: [{ at: 3, kind: 'lf' }, { at: 8, kind: 'crlf' }],
      separatorsTruncated: false, skeleton: '000|aaa|', skeletonTruncated: false,
      command: 'SECRET_WALRUS=/private/branch', cwd: '/private/branch',
      stdout: 'SECRET_WALRUS=/private/branch',
    };
    const terminal = { type: 'terminal', cell, completedReads: 1, lostWrite: false };
    const diagnostics = reaperProbe.traceDiagnosticLines(JSON.stringify(trace) + '\n' + JSON.stringify(terminal) + '\n', cell);
    assert.equal(diagnostics.length, 2, cell + ' literal complete session retains READ and CASE');
    assert.doesNotMatch(diagnostics.join('\n'), /SECRET_WALRUS|\/private\/branch/);
    assert.match(diagnostics[0], /^RIGGER_REAPER_READ /);
    const read = JSON.parse(diagnostics[0].slice('RIGGER_REAPER_READ '.length));
    assert.equal(read.parserClass, 'framing');
    assert.equal(read.rowCount, 2);
    assert.deepEqual(read.separators, [
      { at: 3, kind: 'lf' },
      { at: 8, kind: 'crlf' },
    ]);
    assert.match(diagnostics[1], /^RIGGER_REAPER_CASE /);
    assert.deepEqual(JSON.parse(diagnostics[1].slice('RIGGER_REAPER_CASE '.length)), {
      cell, records: 1, evidence: 'complete',
    });
  }
});

test('targeted read projection caps its public shape for large tool answers', () => {
  const stdout = 'X'.repeat(300) + '\n'.repeat(80);
  const record = targetReadRecord({
    cell: 'E6-F7', pid: 123, readSequence: 2, parserClass: 'framing',
    result: { status: 0, signal: null, error: null, stdout, stderr: '' },
  });
  assert.equal(record.stdoutUnits, 380);
  assert.equal(record.skeleton.length, 256);
  assert.equal(record.skeletonTruncated, true);
  assert.equal(record.separatorCount, 80);
  assert.equal(record.separators.length, 64);
  assert.equal(record.separatorsTruncated, true);
  assert.equal(record.rowCount, 80);
  assert.doesNotMatch(JSON.stringify(record), /X{10}/);
});

test('unsafe or incomplete targeted-read records cannot become complete public evidence', () => {
  const record = targetReadRecord({
    cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
    result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
  });
  assert.throws(() => safeTargetReadRecord({ ...record, pid: null }), /trace record is incomplete/);
  assert.throws(() => safeTargetReadRecord({ ...record, skeleton: 'SECRET_WALRUS' }), /trace record is incomplete/);
  assert.throws(() => safeTargetReadRecord({ ...record, separators: [{ at: 0, kind: 'private' }] }), /trace record is incomplete/);
  assert.equal(JSON.stringify(safeTargetReadRecord({ ...record, command: '/private/secret' })).includes('/private/secret'), false);
});

test('missing or truncated reaper trace remains incomplete evidence', () => {
  const record = targetReadRecord({
    cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
    result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
  });
  const line = JSON.stringify(record) + '\n';
  const terminal = (completedReads) => JSON.stringify({ type: 'terminal', cell: 'E5-F1', completedReads, lostWrite: false }) + '\n';
  assert.deepEqual(traceEvidence(line + terminal(1), 'E5-F1'), { records: [record], incomplete: false });
  const second = { ...record, readSequence: 2 };
  assert.deepEqual(traceEvidence(line + JSON.stringify(second) + '\n' + terminal(2), 'E5-F1'), { records: [record, second], incomplete: false });
  assert.deepEqual(traceEvidence(line, 'E5-F1'), { records: [record], incomplete: true });
  assert.deepEqual(traceEvidence(undefined, 'E5-F1'), { records: [], incomplete: true });
  assert.deepEqual(traceEvidence(line.slice(0, -1), 'E5-F1'), { records: [], incomplete: true });
  assert.deepEqual(traceEvidence(JSON.stringify({ ...record, skeleton: 'SECRET_WALRUS' }) + '\n', 'E5-F1'), { records: [], incomplete: true });
});

test('only a matching final terminal validates a complete contiguous targeted-read session', () => {
  // These literal fields implement the card's trace contract independently of its projection.
  const first = { cell: 'E5-F1', pid: 123, readSequence: 1, parserClass: 'live',
    signalZero: 'not-checked', status: 0, signal: 'none', errorCode: 'none',
    stdoutUnits: 45, stderrUnits: 0, rowCount: 1, separatorCount: 1,
    separators: [{ at: 44, kind: 'lf' }], separatorsTruncated: false,
    skeleton: '000 A Aaa Aaa 00 00.00.00 0000 aaaaaaa|', skeletonTruncated: false };
  const second = { ...first, readSequence: 2 };
  const terminal = { type: 'terminal', cell: 'E5-F1', completedReads: 2, lostWrite: false };
  const encode = (records) => records.map((record) => JSON.stringify(record) + '\n').join('');
  for (const [name, records, complete] of [
    ['two reads', [first, second, terminal], true],
    ['one read', [first, { ...terminal, completedReads: 1 }], true],
    ['missing terminal', [first, second], false],
    ['duplicate terminal', [first, second, terminal, terminal], false],
    ['early terminal', [first, terminal, second], false],
    ['another cell', [first, second, { ...terminal, cell: 'E6-F1' }], false],
    ['lost append', [first, second, { ...terminal, lostWrite: true }], false],
    ['wrong count', [first, terminal], false],
    ['sequence gap', [first, { ...second, readSequence: 3 }, terminal], false],
    ['duplicate sequence', [first, first, terminal], false],
    ['no reads', [{ ...terminal, completedReads: 0 }], false],
    ['unsafe count', [first, { ...terminal, completedReads: null }], false],
  ]) {
    assert.equal(traceEvidence(encode(records), 'E5-F1').incomplete, !complete, name);
  }
  assert.equal(traceEvidence(encode([first, second, terminal]).slice(0, -1), 'E5-F1').incomplete, true, 'truncated terminal');
});

test('a successful trace prefix followed by a lost later read remains incomplete without changing ending decisions', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('function targetState(pid) {');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start, 'the targeted read function is present');
  const targetFunction = source.slice(source.indexOf('let completedReads = 0;'), end);
  const root = temporaryDirectory('rigger-reaper-lost-read-', { context: t });
  const destination = join(root, 'reads.jsonl');
  // Literal /bin/ps row follows the existing documented targeted-read contract.
  const answer = { status: 0, signal: null, error: null,
    stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' };
  const run = (tracing) => {
    let writes = 0;
    const context = {
      spawnSync: () => ({ ...answer }),
      process: { env: tracing ? { RIGGER_REAPER_TRACE_FILE: destination,
        RIGGER_REAPER_TRACE_ROOT: root, RIGGER_REAPER_CELL: 'E5-F1' } : {},
        getuid: process.getuid.bind(process), kill: () => {} },
      targetReadRecord, realpathSync, dirname, isAbsolute, relative, sep,
      statSync, existsSync, join, lstatSync, openSync, resolve, files: constants, closeSync, Buffer,
      writeSync: (...args) => {
        writes += 1;
        if (writes === 2) throw Object.assign(new Error('controlled append loss'), { code: 'EIO' });
        return writeSync(...args);
      },
    };
    return runInNewContext(targetFunction + '\nJSON.stringify([targetState(123), targetState(123)])', context);
  };
  const untraced = run(false);
  const traced = run(true);
  assert.equal(traced, untraced, 'a lost observation changed the confirmed-ending decisions');
  assert.deepEqual(JSON.parse(traced), [
    { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
    { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
  ]);
  const bytes = readFileSync(destination, 'utf8');
  assert.equal(bytes.endsWith('\n'), true, 'the retained prefix is newline-complete');
  assert.equal(bytes.trimEnd().split('\n').length, 1, 'the first append survived and the second was lost');
  const evidence = traceEvidence(bytes, 'E5-F1');
  assert.equal(evidence.records.length, 1, 'the surviving answered read is retained');
  assert.equal(evidence.incomplete, true, 'a valid prefix cannot prove that later read observations survived');
});

test('interruption during a later targeted read leaves its earlier valid prefix incomplete', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('let completedReads = 0;');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start);
  const root = temporaryDirectory('rigger-reaper-interrupted-read-', { context: t });
  const destination = join(root, 'reads.jsonl');
  let reads = 0;
  const context = {
    spawnSync: () => {
      reads += 1;
      if (reads === 2) throw new Error('controlled interruption before read return');
      return { status: 0, signal: null, error: null,
        stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' };
    },
    process: { env: { RIGGER_REAPER_TRACE_FILE: destination,
      RIGGER_REAPER_TRACE_ROOT: root, RIGGER_REAPER_CELL: 'E5-F1' },
      getuid: process.getuid.bind(process), kill: () => {} },
    targetReadRecord, realpathSync, dirname, isAbsolute, relative, sep,
    statSync, existsSync, join, lstatSync, openSync, resolve, files: constants, writeSync, closeSync, Buffer,
  };
  assert.throws(() => runInNewContext(source.slice(start, end) + '\ntargetState(123); targetState(123); finishTrace();', context),
    /controlled interruption before read return/);
  assert.equal(reads, 2);
  const records = readFileSync(destination, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 1, 'an unreturned read or terminal must not be invented');
  assert.equal(records[0].readSequence, 1);
  assert.equal(traceEvidence(readFileSync(destination, 'utf8'), 'E5-F1').incomplete, true);
});

test('targeted-read sessions preserve decisions and report complete reads or latched append loss', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const targetStart = source.indexOf('function targetState(pid) {');
  const sessionStart = source.indexOf('let completedReads = 0;');
  const end = source.indexOf('\nfunction inside(path) {', targetStart);
  assert.ok(targetStart >= 0 && end > targetStart);
  const sessionSource = source.slice(sessionStart >= 0 ? sessionStart : targetStart, end);
  const root = temporaryDirectory('rigger-reaper-session-', { context: t });
  // Literal ps outcomes: one valid physical Unix row and status-1/nonempty refusal.
  for (const result of [
    { status: 0, signal: null, error: null, stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' },
    { status: 1, signal: null, error: null, stdout: 'refused row\n', stderr: '' },
  ]) {
    for (const [cell, mode] of [
      ['E5-F1', 'complete'], ['E5-F1', 'EIO'], ['E5-F1', 'short'],
      ...(result.status === 0 ? [['E4-F6', 'complete']] : []),
    ]) {
      const destination = join(root, randomUUID() + '.jsonl');
      const run = (tracing) => {
        let writes = 0;
        const context = {
          spawnSync: () => ({ ...result }),
          process: { env: tracing ? { RIGGER_REAPER_TRACE_FILE: destination,
            RIGGER_REAPER_TRACE_ROOT: root, RIGGER_REAPER_CELL: cell } : {},
            getuid: process.getuid.bind(process), kill: () => {} },
          targetReadRecord, realpathSync, dirname, isAbsolute, relative, sep,
          statSync, existsSync, join, lstatSync, openSync, resolve, files: constants, closeSync, Buffer,
          writeSync: (...args) => {
            writes += 1;
            if (writes === 2 && mode === 'EIO') throw Object.assign(new Error('controlled append loss'), { code: 'EIO' });
            if (writes === 2 && mode === 'short') return 0;
            return writeSync(...args);
          },
        };
        return runInNewContext(sessionSource + `
          const capture = () => {
            try { return { kind: 'return', value: targetState(123) }; }
            catch (error) { return { kind: 'throw', message: error.message }; }
          };
          const decisions = [capture(), capture()];
          if (typeof finishTrace === 'function') finishTrace();
          JSON.stringify(decisions);
        `, context);
      };
      assert.equal(run(true), run(false), `${mode} changed an ending decision`);
      const bytes = readFileSync(destination, 'utf8');
      const records = bytes.trimEnd().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(records.at(-1), {
        type: 'terminal', cell, completedReads: 2, lostWrite: mode !== 'complete',
      }, cell + ' ' + mode + ' terminal');
      assert.equal(traceEvidence(bytes, cell).incomplete, mode !== 'complete', mode);
      assert.deepEqual(records.slice(0, -1).map((record) => record.readSequence), mode === 'complete' ? [1, 2] : [1]);
    }
  }
});

test('targeted read outcomes and trace failures retain the confirmed-ending decision', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('function targetState(pid) {');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start, 'the targeted read function is present');
  const targetFunction = source.slice(source.indexOf('let completedReads = 0;'), end);
  const root = temporaryDirectory('rigger-reaper-probe-', { context: t });
  const row = '123 S Mon Oct 28 10:00:00 2026 command\n';
  const zombie = '123 Z Mon Oct 28 10:00:00 2026 command\n';
  const answer = (changes = {}) => ({ status: 0, signal: null, error: null, stdout: row, stderr: '', ...changes });
  const cases = [
    ['live row', answer(), 'reached', 'live', 'return'],
    ['zombie row', answer({ stdout: zombie }), 'reached', 'zombie', 'return'],
    ['status 0 absent', answer({ stdout: '' }), 'ESRCH', 'absent', 'return'],
    ['status 0 reached', answer({ stdout: '' }), 'reached', 'omitted', 'throw'],
    ['status 0 forbidden', answer({ stdout: '' }), 'EPERM', 'absence-unconfirmed', 'throw'],
    ['status 1 absent', answer({ status: 1, stdout: '' }), 'ESRCH', 'absent', 'return'],
    ['status 1 reached', answer({ status: 1, stdout: '' }), 'reached', 'omitted', 'throw'],
    ['status 1 forbidden', answer({ status: 1, stdout: '' }), 'EPERM', 'absence-unconfirmed', 'throw'],
    ['status 1 nonempty', answer({ status: 1 }), 'reached', 'read-failed', 'throw'],
    ['multiple rows', answer({ stdout: row + row }), 'reached', 'framing', 'throw'],
    ['malformed row', answer({ stdout: 'wrong row\n' }), 'reached', 'malformed', 'throw'],
    ['spawn error', answer({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }), 'reached', 'read-failed', 'throw'],
    ['signal', answer({ signal: 'SIGKILL' }), 'reached', 'read-failed', 'throw'],
    ['nonempty stderr', answer({ stderr: 'tool failed' }), 'reached', 'read-failed', 'throw'],
  ];
  const run = (result, signalZero, traceFile, traceRoot) => {
    const mockedProcess = {
      env: traceFile ? { RIGGER_REAPER_TRACE_FILE: traceFile, RIGGER_REAPER_TRACE_ROOT: traceRoot, RIGGER_REAPER_CELL: 'E5-F1' } : {},
      getuid: process.getuid.bind(process),
      kill: () => {
        if (signalZero === 'reached') return;
        throw Object.assign(new Error(signalZero), { code: signalZero });
      },
    };
    const context = {
      spawnSync: () => result, process: mockedProcess, targetReadRecord,
      realpathSync, dirname, isAbsolute, relative, sep, statSync, existsSync, join,
      lstatSync, openSync, resolve, files: constants, writeSync, closeSync, Buffer,
    };
    try {
      return { kind: 'return', value: JSON.stringify(runInNewContext(targetFunction + '\ntargetState(123)', context)) };
    } catch (error) {
      return { kind: 'throw', value: error.message };
    }
  };
  for (const [name, result, signalZero, parserClass, kind] of cases) {
    const destination = join(root, randomUUID() + '.jsonl');
    const untraced = run(result, signalZero);
    const traced = run(result, signalZero, destination, root);
    assert.deepEqual(traced, untraced, name + ' changed the reaper decision');
    assert.equal(traced.kind, kind, name);
    const records = readFileSync(destination, 'utf8').trimEnd().split('\n');
    assert.equal(records.length, 1, name);
    const record = JSON.parse(records[0]);
    assert.equal(record.parserClass, parserClass, name);
    assert.equal(record.signalZero, result.stdout === '' ? signalZero : 'not-checked', name);
    assert.equal(record.cell, 'E5-F1', name);
  }
  const outside = join(dirname(root), randomUUID() + '.jsonl');
  const checkout = join(resolve('.'), randomUUID() + '.jsonl');
  const link = join(root, 'link.jsonl');
  const linkTarget = join(root, 'link-target');
  writeFileSync(linkTarget, 'untouched');
  symlinkSync(linkTarget, link);
  const unwritable = join(root, 'unwritable.jsonl');
  writeFileSync(unwritable, 'untouched');
  chmodSync(unwritable, 0o400);
  t.after(() => chmodSync(unwritable, 0o600));
  for (const [name, destination, traceRoot] of [
    ['outside TMPDIR', outside, root],
    ['checkout TMPDIR', checkout, resolve('.')],
    ['symlink', link, root],
    ['unwritable', unwritable, root],
    ['missing root', join(root, 'missing-root.jsonl'), undefined],
  ]) {
    assert.deepEqual(run(answer(), 'reached', destination, traceRoot), run(answer(), 'reached'), name);
    if (name === 'unwritable') assert.equal(readFileSync(unwritable, 'utf8'), 'untouched');
    else if (name === 'symlink') assert.equal(readFileSync(linkTarget, 'utf8'), 'untouched');
    else assert.equal(existsSync(destination), false, name + ' wrote outside its permitted trace');
  }
});

