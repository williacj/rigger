// ABOUTME: L1 report fixtures and L2's real judge answer under one card and a recording sink.

import { NOT_STARTED } from '../src/substrate/process.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

/** Node's no-pid spawn contract, also exercised by test/dispatch.test.mjs's controlled child. */
export function failedSpawn(command, code) {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('error', Object.assign(new Error(`spawn ${command} ${code}`), { code })));
  return child;
}

const fulfilled = (value) => ({ status: 'fulfilled', value });
const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
const roles = { engineer: { provider: 'claude', tier: 'standard' }, reviewer: { provider: 'claude', tier: 'high', agent: 'reviewer.md' } };
const card = {
  number: 7, title: 'Judge the change', body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'],
  forge: { stage: 'review', pull: fulfilled({ number: 70, base: '5'.repeat(40), head: '4'.repeat(40) }), comments: fulfilled([]), diff: fulfilled('the diff') },
};

/** A report in L1's vocabulary, independent of L2's row numbering. */
export const report = (startCause) => ({ status: 'rejected', reason: Object.assign(new Error('the judge could not start'), { code: NOT_STARTED, startCause }) });

/** L2's answer and the events it wrote, from the reports handed by L3. */
export function answer(directories, options = {}) {
  const events = [];
  const sink = { emitter: (context) => ({ emit: (event, fields) => events.push({ ...context, event, ...fields }) }) };
  const { firstFailures = {}, decisions, ...given } = options;
  const reports = Object.fromEntries(Object.entries(directories).map(([role, outcome]) => [role, firstFailures[role] === undefined ? outcome : { ...outcome, firstFailure: firstFailures[role] }]));
  const outcomes = decisions === undefined ? {} : Object.fromEntries(decisions.map((decision, at) => [String(at), { decision }]));
  const next = judgeAnswer(card, kinds, undefined, { roles, sink, directories: reports, outcomes, ...given });
  return { next, events };
}

/**
 * Independent oracle from #968's R2–R37 table: source vocabulary observed in the source tests,
 * the row's required result, and example identities from its counted-thing column.
 */
export const HOST_REPORTS = [
  ['R2', 'command-missing', { provider: 'claude' }], ['R3', 'command-not-executable', { provider: 'claude' }],
  ['R4', 'command-too-long'], ['R5', 'command-character'],
  ['R6', 'agent-outside', { file: 'agent.md' }], ['R7', 'agent-unresolved', { file: 'agent.md' }], ['R8', 'agent-unreadable', { file: 'agent.md' }],
  ['R9', 'claude-settings-unreadable'], ['R10', 'claude-compound-rule'], ['R11', 'codex-config-unreadable'],
  ['R12', 'claude-exclusion-path', { path: '/work/parent' }], ['R13', 'claude-reached-path', { path: '/work/head' }],
  ['R14', 'directory-illegible', { path: '/work/judge' }], ['R15', 'scratch-illegible', { path: '/work/scratch' }],
  ['R16', 'codex-probe-exit'], ['R17', 'codex-probe-answer'], ['R18', 'codex-skill-unresolved'], ['R19', 'codex-probe-timeout'],
  ['R20', 'adapter-variable', { variable: 'TMPDIR' }], ['R21', 'dispatch-location'], ['R22', 'dispatch-identity'], ['R23', 'dispatch-timeout'],
  ['R24', 'event-emitter-missing'], ['R25', 'groups-unwritable'], ['R26', 'codex-directory-unmade'], ['R27', 'codex-home-file-unwritten'],
  ['R28', 'process-resources'], ['R29', 'directory-unusable'], ['R30', 'working-directory-outside'], ['R31', 'directory-occupied'],
  ['R32', 'groups-unreadable'], ['R33', 'claude-rule-unreadable'], ['R34', 'owner-home-missing'], ['R35', 'agent-name-invalid'],
  ['R36', 'file-descriptors'], ['R37', 'host-error'],
];

/** Runs before the selected spawn, raising a supplied errno or letting the host decide its result. */
export function refuseSpawn(t, { command, code, before = () => {}, synchronous = false }) {
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (name, args, options) => {
    const selected = command === undefined || name === command;
    if (selected) before();
    if (!selected || code === undefined) return spawn(name, args, { ...options, env: options?.env });
    if (synchronous) throw Object.assign(new Error(`spawn ${name} ${code}`), { code });
    return failedSpawn(name, code);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}
