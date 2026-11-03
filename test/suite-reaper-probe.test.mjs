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
  for (const cell of ['E4-F6', 'E5-F1']) {
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
    assert.doesNotMatch(JSON.stringify(record), /SECRET_WALRUS|\/private\/branch/, cell + ' synthetic secret/path exclusion');
    assert.match(record.skeleton, /^[Aad0. |]*$/);
  }
});

test('outer targeted-read diagnostic hides a synthetic secret and path while showing framing and parser result', () => {
  for (const cell of ['E4-F6', 'E5-F1']) {
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
    assert.doesNotMatch(diagnostics.join('\n'), /SECRET_WALRUS|\/private\/branch/, cell + ' outer synthetic secret/path exclusion');
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
  for (const cell of ['E4-F6', 'E6-F7']) {
    const stdout = 'X'.repeat(300) + '\n'.repeat(80);
    const record = targetReadRecord({
      cell, pid: 123, readSequence: 2, parserClass: 'framing',
      result: { status: 0, signal: null, error: null, stdout, stderr: '' },
    });
    assert.equal(record.stdoutUnits, 380);
    assert.equal(record.skeleton.length, 256, cell + ' exact public skeleton bound');
    assert.equal(record.skeletonTruncated, true);
    assert.equal(record.separatorCount, 80);
    assert.equal(record.separators.length, 64);
    assert.equal(record.separatorsTruncated, true);
    assert.equal(record.rowCount, 80);
    assert.doesNotMatch(JSON.stringify(record), /X{10}/);
  }
});

test('unsafe or incomplete targeted-read records cannot become complete public evidence', () => {
  for (const cell of ['E4-F6', 'E5-F1']) {
    const record = targetReadRecord({
      cell, pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
      result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
    });
    assert.throws(() => safeTargetReadRecord({ ...record, pid: null }), /trace record is incomplete/);
    assert.throws(() => safeTargetReadRecord({ ...record, skeleton: 'SECRET_WALRUS' }), /trace record is incomplete/);
    assert.throws(() => safeTargetReadRecord({ ...record, separators: [{ at: 0, kind: 'private' }] }), /trace record is incomplete/);
    assert.equal(JSON.stringify(safeTargetReadRecord({ ...record, command: '/private/secret' })).includes('/private/secret'), false, cell + ' unsafe property exclusion');
  }
});

test('missing or truncated reaper trace remains incomplete evidence', () => {
  for (const cell of ['E4-F6', 'E5-F1']) {
    const record = targetReadRecord({
      cell, pid: 123, readSequence: 1, parserClass: 'absent', signalZero: 'ESRCH',
      result: { status: 1, signal: null, error: null, stdout: '', stderr: '' },
    });
    const line = JSON.stringify(record) + '\n';
    const terminal = (completedReads) => JSON.stringify({ type: 'terminal', cell, completedReads, lostWrite: false }) + '\n';
    assert.deepEqual(traceEvidence(line + terminal(1), cell), { records: [record], incomplete: false });
    const second = { ...record, readSequence: 2 };
    assert.deepEqual(traceEvidence(line + JSON.stringify(second) + '\n' + terminal(2), cell), { records: [record, second], incomplete: false });
    assert.deepEqual(traceEvidence(line, cell), { records: [record], incomplete: true }, cell + ' missing final terminal');
    assert.deepEqual(traceEvidence(undefined, cell), { records: [], incomplete: true });
    assert.deepEqual(traceEvidence('', cell), { records: [], incomplete: true });
    assert.deepEqual(traceEvidence(line.slice(0, 9), cell), { records: [], incomplete: true });
    assert.deepEqual(traceEvidence(line.slice(0, -1), cell), { records: [], incomplete: true });
    assert.deepEqual(traceEvidence(JSON.stringify({ ...record, skeleton: 'SECRET_WALRUS' }) + '\n', cell), { records: [], incomplete: true });
  }
});

test('only a matching final terminal validates a complete contiguous targeted-read session', () => {
  for (const cell of ['E4-F6', 'E5-F1']) {
    // These literal fields implement the card's trace contract independently of its projection.
    const first = { cell, pid: 123, readSequence: 1, parserClass: 'live',
      signalZero: 'not-checked', status: 0, signal: 'none', errorCode: 'none',
      stdoutUnits: 45, stderrUnits: 0, rowCount: 1, separatorCount: 1,
      separators: [{ at: 44, kind: 'lf' }], separatorsTruncated: false,
      skeleton: '000 A Aaa Aaa 00 00.00.00 0000 aaaaaaa|', skeletonTruncated: false };
    const second = { ...first, readSequence: 2 };
    const terminal = { type: 'terminal', cell, completedReads: 2, lostWrite: false };
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
      assert.equal(traceEvidence(encode(records), cell).incomplete, !complete, cell + ' ' + name);
    }
    assert.equal(traceEvidence(encode([first, second, terminal]).slice(0, -1), cell).incomplete, true, cell + ' truncated terminal');
    assert.equal(traceEvidence(encode([first, second, terminal]).slice(0, -5), cell).incomplete, true, cell + ' snapshot cut inside terminal');
  }
});

test('a successful trace prefix followed by a lost later read remains incomplete without changing ending decisions', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('function targetState(pid) {');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start, 'the targeted read function is present');
  const targetFunction = source.slice(source.indexOf('let completedReads = 0;'), end);
  const root = temporaryDirectory('rigger-reaper-lost-read-', { context: t });
  // Literal /bin/ps row follows the existing documented targeted-read contract.
  const answer = { status: 0, signal: null, error: null,
    stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' };
  for (const [cell, mode, withTerminal] of [
    ['E4-F6', 'EIO', true],
    ['E4-F6', 'short', true],
    ['E5-F1', 'EIO', false],
  ]) {
    const destination = cell === 'E5-F1' ? join(root, 'reads.jsonl') : join(root, randomUUID() + '.jsonl');
    const run = (tracing) => {
      let writes = 0;
      const context = {
        spawnSync: () => ({ ...answer }),
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
      const program = '\nconst decisions = [targetState(123), targetState(123)];'
        + (withTerminal ? '\nfinishTrace();' : '') + '\nJSON.stringify(decisions);';
      return runInNewContext(targetFunction + program, context);
    };
    const untraced = run(false);
    const traced = run(true);
    assert.equal(traced, untraced, cell + ' ' + mode + ' a lost observation changed the confirmed-ending decisions');
    assert.deepEqual(JSON.parse(traced), [
      { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
      { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
    ]);
    const bytes = readFileSync(destination, 'utf8');
    assert.equal(bytes.endsWith('\n'), true, 'the retained prefix is newline-complete');
    const records = bytes.trimEnd().split('\n').map((line) => JSON.parse(line));
    assert.equal(records.length, withTerminal ? 2 : 1, 'the first append survived and the second was lost');
    if (withTerminal) assert.deepEqual(records[1], { type: 'terminal', cell, completedReads: 2, lostWrite: true });
    const evidence = traceEvidence(bytes, cell);
    assert.equal(evidence.records.length, 1, 'the surviving answered read is retained');
    assert.equal(evidence.incomplete, true, cell + ' ' + mode + ' a valid prefix cannot prove that later read observations survived');
  }
});

test('interruption during a later targeted read leaves its earlier valid prefix incomplete', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const start = source.indexOf('let completedReads = 0;');
  const end = source.indexOf('\nfunction inside(path) {', start);
  assert.ok(start >= 0 && end > start);
  const root = temporaryDirectory('rigger-reaper-interrupted-read-', { context: t });
  for (const cell of ['E4-F6', 'E5-F1']) {
    for (const interruption of ['during later read', 'before terminal']) {
      const destination = cell === 'E5-F1' && interruption === 'during later read'
        ? join(root, 'reads.jsonl') : join(root, randomUUID() + '.jsonl');
      let reads = 0;
      const context = {
        spawnSync: () => {
          reads += 1;
          if (reads === 2 && interruption === 'during later read') throw new Error('controlled interruption before read return');
          return { status: 0, signal: null, error: null,
            stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' };
        },
        process: { env: { RIGGER_REAPER_TRACE_FILE: destination,
          RIGGER_REAPER_TRACE_ROOT: root, RIGGER_REAPER_CELL: cell },
          getuid: process.getuid.bind(process), kill: () => {} },
        targetReadRecord, realpathSync, dirname, isAbsolute, relative, sep,
        statSync, existsSync, join, lstatSync, openSync, resolve, files: constants, writeSync, closeSync, Buffer,
      };
      const program = interruption === 'during later read'
        ? '\ntargetState(123); targetState(123); finishTrace();'
        : '\ntargetState(123); targetState(123); throw new Error("controlled interruption before terminal");';
      assert.throws(() => runInNewContext(source.slice(start, end) + program, context),
        interruption === 'during later read' ? /controlled interruption before read return/ : /controlled interruption before terminal/);
      assert.equal(reads, 2);
      const records = readFileSync(destination, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
      assert.equal(records.length, interruption === 'during later read' ? 1 : 2, 'an unreturned read or terminal must not be invented');
      assert.equal(records[0].readSequence, 1);
      if (interruption === 'before terminal') assert.equal(records[1].readSequence, 2);
      assert.equal(traceEvidence(readFileSync(destination, 'utf8'), cell).incomplete, true, cell + ' ' + interruption + ' remains incomplete');
    }
  }
});

test('targeted-read sessions preserve decisions and report complete reads or latched append loss', (t) => {
  const source = readFileSync(new URL('./suite-reaper', import.meta.url), 'utf8');
  const targetStart = source.indexOf('function targetState(pid) {');
  const sessionStart = source.indexOf('let completedReads = 0;');
  const end = source.indexOf('\nfunction inside(path) {', targetStart);
  assert.ok(targetStart >= 0 && end > targetStart);
  const sessionSource = source.slice(sessionStart >= 0 ? sessionStart : targetStart, end);
  const root = temporaryDirectory('rigger-reaper-session-', { context: t });
  const observations = [];
  // Literal ps outcomes: one valid physical Unix row and status-1/nonempty refusal.
  for (const result of [
    { status: 0, signal: null, error: null, stdout: '123 S Mon Oct 28 10:00:00 2026 command\n', stderr: '' },
    { status: 1, signal: null, error: null, stdout: 'refused row\n', stderr: '' },
  ]) {
    for (const cell of ['E4-F6', 'E5-F1']) {
      for (const mode of ['complete', 'EIO', 'short']) {
        const destination = join(root, randomUUID() + '.jsonl');
        let injectedLosses = 0;
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
              if (writes === 2 && mode === 'EIO') {
                injectedLosses += 1;
                throw Object.assign(new Error('controlled append loss'), { code: 'EIO' });
              }
              if (writes === 2 && mode === 'short') {
                injectedLosses += 1;
                return 0;
              }
              return writeSync(...args);
            },
          };
          const program = [
            'const capture = () => {',
            "  try { return { kind: 'return', value: targetState(123) }; }",
            "  catch (error) { return { kind: 'throw', message: error.message }; }",
            '};',
            'const decisions = [capture(), capture()];',
            "if (typeof finishTrace === 'function') finishTrace();",
            'JSON.stringify(decisions);',
          ].join('\n');
          return runInNewContext(sessionSource + '\n' + program, context);
        };
        const traced = run(true);
        const untraced = run(false);
        const bytes = readFileSync(destination, 'utf8');
        const records = bytes.trimEnd().split('\n').map((line) => JSON.parse(line));
        observations.push({ cell, status: result.status, mode, traced, untraced, bytes, records, injectedLosses });
      }
    }
  }
  // Observe every E4 loss stimulus before one assertion can stop this declaration.
  const e4Observations = observations.filter(({ cell }) => cell === 'E4-F6');
  assert.deepEqual(e4Observations.map(({ cell, status, mode, injectedLosses }) => ({
    cell, status, mode, injectedLosses,
  })), [
    { cell: 'E4-F6', status: 0, mode: 'complete', injectedLosses: 0 },
    { cell: 'E4-F6', status: 0, mode: 'EIO', injectedLosses: 1 },
    { cell: 'E4-F6', status: 0, mode: 'short', injectedLosses: 1 },
    { cell: 'E4-F6', status: 1, mode: 'complete', injectedLosses: 0 },
    { cell: 'E4-F6', status: 1, mode: 'EIO', injectedLosses: 1 },
    { cell: 'E4-F6', status: 1, mode: 'short', injectedLosses: 1 },
  ], 'E4-F6 session loss stimuli actually reached their controlled write');
  const e4Equality = e4Observations.map(({ cell, status, mode, traced, untraced, injectedLosses }) => ({
    cell, status, mode, injectedLosses, equal: traced === untraced,
  }));
  if (e4Equality.some(({ equal }) => !equal)) t.diagnostic('E4-F6 session qualification observations ' + JSON.stringify(e4Equality));
  assert.deepEqual(e4Equality.map(({ cell, status, mode, equal }) => ({ cell, status, mode, equal })), [
    { cell: 'E4-F6', status: 0, mode: 'complete', equal: true },
    { cell: 'E4-F6', status: 0, mode: 'EIO', equal: true },
    { cell: 'E4-F6', status: 0, mode: 'short', equal: true },
    { cell: 'E4-F6', status: 1, mode: 'complete', equal: true },
    { cell: 'E4-F6', status: 1, mode: 'EIO', equal: true },
    { cell: 'E4-F6', status: 1, mode: 'short', equal: true },
  ], 'E4-F6 complete/EIO/short status-0/status-1 decision equivalence');
  for (const { cell, status, mode, traced, untraced, bytes, records } of observations) {
    assert.equal(traced, untraced, cell + ' ' + mode + ' changed an ending decision');
    const decisions = JSON.parse(traced);
    assert.deepEqual(decisions.map(({ kind }) => kind), status === 0 ? ['return', 'return'] : ['throw', 'throw'], cell + ' ' + mode + ' independently expected decisions');
    if (status === 0) assert.deepEqual(decisions.map(({ value }) => value), [
      { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
      { started: 'Mon Oct 28 10:00:00 2026', zombie: false },
    ]);
    assert.deepEqual(records.at(-1), {
      type: 'terminal', cell, completedReads: 2, lostWrite: mode !== 'complete',
    }, cell + ' ' + mode + ' terminal');
    assert.equal(traceEvidence(bytes, cell).incomplete, mode !== 'complete', cell + ' ' + mode + ' completeness');
    assert.deepEqual(records.slice(0, -1).map((record) => record.readSequence), mode === 'complete' ? [1, 2] : [1]);
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
    ['non-timeout spawn error', answer({ status: null, stdout: '', error: Object.assign(new Error('executable not found'), { code: 'ENOENT' }) }), 'reached', 'read-failed', 'throw', 'not-checked'],
    ['signal', answer({ signal: 'SIGKILL' }), 'reached', 'read-failed', 'throw'],
    ['nonempty stderr', answer({ stderr: 'tool failed' }), 'reached', 'read-failed', 'throw'],
  ];
  let injectedLosses = 0;
  const run = (result, signalZero, traceFile, traceRoot, cell = 'E5-F1', mode = 'complete') => {
    const mockedProcess = {
      env: traceFile ? { RIGGER_REAPER_TRACE_FILE: traceFile, RIGGER_REAPER_TRACE_ROOT: traceRoot, RIGGER_REAPER_CELL: cell } : {},
      getuid: process.getuid.bind(process),
      kill: () => {
        if (signalZero === 'reached') return;
        throw Object.assign(new Error(signalZero), { code: signalZero });
      },
    };
    const context = {
      spawnSync: () => result, process: mockedProcess, targetReadRecord,
      realpathSync, dirname, isAbsolute, relative, sep, statSync, existsSync, join,
      lstatSync, openSync, resolve, files: constants, closeSync, Buffer,
      writeSync: (...args) => {
        if (mode === 'EIO') {
          injectedLosses += 1;
          throw Object.assign(new Error('controlled read observation loss'), { code: 'EIO' });
        }
        if (mode === 'short') {
          injectedLosses += 1;
          return 0;
        }
        return writeSync(...args);
      },
    };
    try {
      return { kind: 'return', value: JSON.stringify(runInNewContext(targetFunction + '\ntargetState(123)', context)) };
    } catch (error) {
      return { kind: 'throw', value: error.message };
    }
  };
  const e4Observations = [];
  // These synthetic command/stderr tokens exercise the actual writer, not just the projection.
  for (const [name, result, signalZero, parserClass, kind, signalZeroOverride] of cases) {
    const privateResult = {
      ...result,
      stdout: result.stdout === row ? '123 S Mon Oct 28 10:00:00 2026 command SECRET_WALRUS=/private/branch\n'
        : result.stdout === zombie ? '123 Z Mon Oct 28 10:00:00 2026 command SECRET_WALRUS=/private/branch\n' : result.stdout,
      stderr: result.stderr === '' ? '' : 'tool failed SECRET_WALRUS=/private/branch',
    };
    for (const mode of ['complete', 'EIO', 'short']) {
      const destination = join(root, randomUUID() + '.jsonl');
      const beforeInjectedLosses = injectedLosses;
      const untraced = run(privateResult, signalZero, undefined, undefined, 'E4-F6', mode);
      const traced = run(privateResult, signalZero, destination, root, 'E4-F6', mode);
      const bytes = readFileSync(destination, 'utf8');
      e4Observations.push({ name, mode, result: privateResult, signalZero, parserClass, kind, signalZeroOverride, untraced, traced, bytes, injectedLosses: injectedLosses - beforeInjectedLosses });
    }
  }
  // The expected equality is the card's fail-open contract; no SUT output supplies it.
  assert.deepEqual(e4Observations.map(({ name, mode, injectedLosses }) => ({
    cell: 'E4-F6', name, mode, injectedLosses,
  })), cases.flatMap(([name]) => ['complete', 'EIO', 'short'].map((mode) => ({
    cell: 'E4-F6', name, mode, injectedLosses: mode === 'complete' ? 0 : 1,
  }))), 'E4-F6 read-map loss stimuli actually reached their controlled write');
  const e4Equality = e4Observations.map(({ name, mode, traced, untraced, injectedLosses }) => ({
    cell: 'E4-F6', name, mode, injectedLosses, equal: traced.kind === untraced.kind && traced.value === untraced.value,
  }));
  if (e4Equality.some(({ equal }) => !equal)) t.diagnostic('E4-F6 read-map qualification observations ' + JSON.stringify(e4Equality));
  assert.deepEqual(e4Equality.map(({ cell, name, mode, equal }) => ({ cell, name, mode, equal })), cases.flatMap(([name]) => ['complete', 'EIO', 'short'].map((mode) => ({
    cell: 'E4-F6', name, mode, equal: true,
  }))), 'E4-F6 complete/EIO/short read-map decision equivalence');
  for (const { name, mode, result, signalZero, parserClass, kind, signalZeroOverride, traced, untraced, bytes } of e4Observations) {
    assert.deepEqual(traced, untraced, 'E4-F6 ' + name + ' ' + mode + ' changed the reaper decision');
    assert.equal(traced.kind, kind, 'E4-F6 ' + name + ' ' + mode);
    assert.doesNotMatch(bytes, /SECRET_WALRUS|\/private\/branch/, 'E4-F6 ' + name + ' ' + mode + ' actual writer synthetic secret/path exclusion');
    if (mode !== 'complete') {
      assert.equal(bytes, '', 'E4-F6 ' + name + ' ' + mode + ' lost write invents no record');
      assert.equal(traceEvidence(bytes, 'E4-F6').incomplete, true);
      continue;
    }
    const records = bytes.trimEnd().split('\n');
    assert.equal(records.length, 1, 'E4-F6 ' + name);
    const record = JSON.parse(records[0]);
    assert.equal(record.parserClass, parserClass, 'E4-F6 ' + name);
    assert.equal(record.signalZero, signalZeroOverride ?? (result.stdout === '' ? signalZero : 'not-checked'), 'E4-F6 ' + name);
    assert.equal(record.cell, 'E4-F6', 'E4-F6 ' + name);
    assert.equal(record.status, result.status, 'E4-F6 ' + name);
    assert.equal(record.errorCode, result.error?.code ?? 'none', 'E4-F6 ' + name);
  }
  for (const [name, result, signalZero, parserClass, kind, signalZeroOverride] of cases) {
    const destination = join(root, randomUUID() + '.jsonl');
    const untraced = run(result, signalZero);
    const traced = run(result, signalZero, destination, root);
    assert.deepEqual(traced, untraced, name + ' changed the reaper decision');
    assert.equal(traced.kind, kind, name);
    const records = readFileSync(destination, 'utf8').trimEnd().split('\n');
    assert.equal(records.length, 1, name);
    const record = JSON.parse(records[0]);
    assert.equal(record.parserClass, parserClass, name);
    assert.equal(record.signalZero, signalZeroOverride ?? (result.stdout === '' ? signalZero : 'not-checked'), name);
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
  for (const cell of ['E4-F6', 'E5-F1']) {
    for (const [name, destination, traceRoot] of [
      ['outside TMPDIR', outside, root],
      ['checkout TMPDIR', checkout, resolve('.')],
      ['symlink', link, root],
      ['unwritable', unwritable, root],
      ['missing root', join(root, 'missing-root.jsonl'), undefined],
    ]) {
      assert.deepEqual(run(answer(), 'reached', destination, traceRoot, cell), run(answer(), 'reached'), cell + ' ' + name);
      if (name === 'unwritable') assert.equal(readFileSync(unwritable, 'utf8'), 'untouched');
      else if (name === 'symlink') assert.equal(readFileSync(linkTarget, 'utf8'), 'untouched');
      else assert.equal(existsSync(destination), false, name + ' wrote outside its permitted trace');
    }
  }
});
