// ABOUTME: Projects targeted suite-reaper process reads into bounded, nonsecret evidence.

const PARSER_CLASSES = new Set(['read-failed', 'absent', 'absence-unconfirmed', 'omitted', 'framing', 'malformed', 'live', 'zombie']);
const SIGNALS = new Set(['SIGKILL', 'SIGTERM', 'SIGINT']);
const ERROR_CODES = new Set(['ENOENT', 'ETIMEDOUT', 'EACCES', 'EPERM', 'EIO', 'ENOBUFS']);
const SIGNAL_ZERO = new Set(['not-checked', 'ESRCH', 'reached', 'EPERM', 'other']);
const SEPARATORS = new Map([
  ['\n', 'lf'], ['\r', 'cr'], ['\v', 'vt'], ['\f', 'ff'],
  ['\u0085', 'nel'], ['\u2028', 'ls'], ['\u2029', 'ps'],
]);
const SEPARATOR_KINDS = new Set([...SEPARATORS.values(), 'crlf']);

const known = (set, value) => set.has(value) ? value : 'other';
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const positive = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;

function separatorsIn(stdout) {
  const separators = [];
  let count = 0;
  let endedWithSeparator = false;
  for (let at = 0; at < stdout.length; at += 1) {
    let kind = SEPARATORS.get(stdout[at]);
    if (stdout[at] === '\r' && stdout[at + 1] === '\n') {
      kind = 'crlf';
      at += 1;
    }
    if (!kind) {
      endedWithSeparator = false;
      continue;
    }
    count += 1;
    if (separators.length < 64) separators.push({ at: kind === 'crlf' ? at - 1 : at, kind });
    endedWithSeparator = true;
  }
  return {
    separators, separatorCount: count, separatorsTruncated: count > 64,
    rowCount: stdout === '' ? 0 : count + (endedWithSeparator ? 0 : 1),
  };
}

function skeletonOf(stdout) {
  return [...stdout.slice(0, 256)].map((character) => {
    if (/[0-9]/.test(character)) return '0';
    if (/[A-Z]/.test(character)) return 'A';
    if (/[a-z]/.test(character)) return 'a';
    if (character === ' ' || character === '\t') return ' ';
    if (SEPARATORS.has(character)) return '|';
    return '.';
  }).join('');
}

export function targetReadRecord({ cell, pid, readSequence, parserClass, signalZero = 'not-checked', result }) {
  const stdout = typeof result?.stdout === 'string' ? result.stdout : null;
  const stderr = typeof result?.stderr === 'string' ? result.stderr : null;
  return {
    cell: /^E[56]-F[1-7]$/.test(cell) ? cell : 'other',
    pid: positive(pid),
    readSequence: readSequence === undefined ? undefined : positive(readSequence),
    parserClass: known(PARSER_CLASSES, parserClass),
    signalZero: known(SIGNAL_ZERO, signalZero),
    status: nonnegative(result?.status),
    signal: result?.signal === null ? 'none' : known(SIGNALS, result?.signal),
    errorCode: result?.error == null ? 'none' : known(ERROR_CODES, result.error.code),
    stdoutUnits: stdout === null ? null : stdout.length,
    stderrUnits: stderr === null ? null : stderr.length,
    ...(stdout === null ? { rowCount: null, separatorCount: null, separators: [], separatorsTruncated: false, skeleton: '', skeletonTruncated: false } : {
      ...separatorsIn(stdout),
      skeleton: skeletonOf(stdout),
      skeletonTruncated: stdout.length > 256,
    }),
  };
}

export function safeTargetReadRecord(record, readSequence = record?.readSequence) {
  const validNumber = (value) => value === null || nonnegative(value) !== null;
  const validEnum = (set, value) => value === 'other' || set.has(value);
  const validSeparators = Array.isArray(record?.separators) && record.separators.length <= 64
    && record.separators.every((entry) => nonnegative(entry?.at) !== null && SEPARATOR_KINDS.has(entry?.kind));
  if (!record || typeof record !== 'object'
      || !/^E[56]-F[1-7]$/.test(record.cell)
      || positive(record.pid) === null || positive(readSequence) === null
      || !validEnum(PARSER_CLASSES, record.parserClass)
      || !SIGNAL_ZERO.has(record.signalZero)
      || !validNumber(record.status)
      || !(record.signal === 'none' || validEnum(SIGNALS, record.signal))
      || !(record.errorCode === 'none' || validEnum(ERROR_CODES, record.errorCode))
      || !validNumber(record.stdoutUnits) || !validNumber(record.stderrUnits)
      || !validNumber(record.rowCount) || !validNumber(record.separatorCount)
      || !validSeparators || record.separatorCount < record.separators.length
      || typeof record.separatorsTruncated !== 'boolean'
      || typeof record.skeleton !== 'string' || !/^[Aad0. |]{0,256}$/.test(record.skeleton)
      || typeof record.skeletonTruncated !== 'boolean') {
    throw new Error('trace record is incomplete');
  }
  return {
    cell: record.cell,
    pid: record.pid,
    readSequence,
    parserClass: record.parserClass,
    signalZero: record.signalZero,
    status: record.status,
    signal: record.signal,
    errorCode: record.errorCode,
    stdoutUnits: record.stdoutUnits,
    stderrUnits: record.stderrUnits,
    rowCount: record.rowCount,
    separatorCount: record.separatorCount,
    separators: record.separators.map(({ at, kind }) => ({ at, kind })),
    separatorsTruncated: record.separatorsTruncated,
    skeleton: record.skeleton,
    skeletonTruncated: record.skeletonTruncated,
  };
}

export function traceEvidence(bytes, cell) {
  if (typeof bytes !== 'string' || bytes.length === 0) return { records: [], incomplete: true };
  const lines = bytes.split('\n');
  const complete = lines.at(-1) === '';
  lines.pop();
  const records = [];
  let incomplete = !complete;
  let terminal;
  let terminalCount = 0;
  for (const [at, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'terminal') {
        terminalCount += 1;
        terminal = parsed;
        if (at !== lines.length - 1) incomplete = true;
        continue;
      }
      if (terminalCount > 0) incomplete = true;
      const sequence = positive(parsed?.readSequence);
      const record = safeTargetReadRecord(parsed, sequence ?? records.length + 1);
      if (record.cell !== cell || sequence !== records.length + 1) incomplete = true;
      records.push(record);
    } catch {
      incomplete = true;
    }
  }
  if (records.length === 0 || terminalCount !== 1 || terminal?.cell !== cell
      || positive(terminal?.completedReads) !== records.length || terminal?.lostWrite !== false) incomplete = true;
  return { records, incomplete };
}

export function traceDiagnosticLines(bytes, cell) {
  const evidence = traceEvidence(bytes, cell);
  return [
    ...evidence.records.map((record) => 'RIGGER_REAPER_READ ' + JSON.stringify(record)),
    'RIGGER_REAPER_CASE ' + JSON.stringify({
      cell, records: evidence.records.length,
      evidence: evidence.incomplete ? 'incomplete' : 'complete',
    }),
  ];
}
