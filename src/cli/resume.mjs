// ABOUTME: The `resume` verb: a thin caller of L3's admission module, whose `resume` removal removes
// every closer it read and records each, and then of L2's notice function, which closes the status
// issue; it says what it removed and closed, or why it removed or closed nothing, an unreadable
// admission's entries in the words `doctor` names them in.

import { join } from 'node:path';

import { FIXED_LABELS, validate } from '../config/validate.mjs';
import { admission, admissions } from '../scheduling/admission.mjs';
import { causeOf } from '../workflow/status-issue.mjs';
import { columnChanges } from '../workflow/transitions.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, outsideText, removedCloserLine, settled, unreadableAdmission } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';



/**
 * What `rigger resume` prints, and the status it exits with, in `ARCHITECTURE.md`'s order: it
 * resolves the repository and its state directory as `once` does, removes the closers it read,
 * and only then reads `rigger.config.mjs`, so a missing config or the forge never keeps admission
 * closed (`R-SCHED-23`). It reaches L2's notice function through L2's own entry point, built from
 * the config, as `once` reaches L2, to close each issue a removed closer's name gave and every other
 * open issue carrying the status label (`R-SCHED-24`). Where it removed nothing, it reads no config
 * and closes no issue. `now` is the module's clock, `fs` the `node:fs` calls the module makes and
 * `send` the runners' spawn, each a test's to replace. `sink` replaces only admission's sink for tests.
 */
export const resume = (options) => recording((opened) => resuming(opened, options));

/** `resume`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function resuming(opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, now = Date.now, fs, send, sink,
} = {}) {
  const { named, refusal } = await settled('resume', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: sink ?? opened.sink, ...(fs && { fs }) });
  const refusalLines = (events = []) => events.map(({ name, why }) => `rigger resume: the sink refused the admission.open event for ${outsideText(name)}: ${outsideText(why)}`);
  let answer;
  try {
    answer = await admissionRecord.resume();
  } catch (failure) {
    // Only a failure admission built is read for its fields; any other is said whole.
    const { unreadable, removed: removedSoFar, unrecorded } = admissions(failure) ? failure : {};
    if (Array.isArray(unreadable)) return { text: `rigger resume: ${unreadableAdmission(unreadable)}`, code: 1 };
    // A removal that stopped partway still names each closer it removed, then why no issue was closed.
    const done = Array.isArray(removedSoFar) ? removedSoFar : [];
    return {
      text: [
        ...done.map((closer) => `rigger resume: ${removedCloserLine(closer)}`),
        ...refusalLines(unrecorded),
        `rigger resume: ${outsideText(causeOf(failure))}`,
        ...(done.length === 0 ? [] : ['rigger resume: no status issue was closed, because the removal of the closers stopped before every closer was removed']),
      ].join('\n'),
      code: 1,
    };
  }
  const { removed, gone, unrecorded: admissionRefusals } = answer;
  if (removed.length === 0 && gone.length === 0) return { text: 'rigger resume: admission was already open', code: 0 };
  const lines = [
    ...removed.map((closer) => `rigger resume: ${removedCloserLine(closer)}`),
    ...gone.map(({ kind, path }) => `rigger resume: the ${kind} closer ${path} was already gone`),
    ...refusalLines(admissionRefusals),
  ];
  // Every closer read was gone at its removal: another `resume` removed them, and closes the issue.
  if (removed.length === 0) return { text: lines.join('\n'), code: 0 };
  /** The answer where nothing after the removal reached L2: the removals made, and why no issue was closed. */
  const unclosed = (why) => ({ text: [...lines, `rigger resume: no status issue was closed, because ${outsideText(why)}`].join('\n'), code: 1 });
  const { config, problem } = await consumerConfig(named);
  if (problem !== undefined) return unclosed(problem);
  const invalid = validate(config);
  if (invalid.length > 0) return unclosed(`\`${CONFIG}\`: ${invalid.join('; ')}`);
  const { notice } = columnChanges({ config, sink: opened.sink, send });
  const issues = [...removed, ...gone].filter(({ issue }) => issue !== undefined).map(({ issue }) => Number(issue));
  let closing;
  try {
    closing = await notice.close(issues);
  } catch (failure) {
    // L2 answers each issue's failure itself, so a throw here came before its first write.
    return unclosed(`closing the status issues stopped: ${causeOf(failure)}`);
  }
  const { closed, left, unrecorded, unread } = closing;
  /** The record a write the forge made for issue `number` and the sink refused, as `write` names it, or undefined. */
  const refused = (number, write) => unrecorded.find((each) => each.issue === number && each.write === write)?.why;
  /** `said`, then, where `why` names a refused record, that the sink refused it. */
  const but = (said, why) => (why === undefined ? said : `${said}, but the sink refused its record: ${outsideText(why)}`);
  return {
    text: [
      ...lines,
      ...unrecorded.filter(({ write }) => write === 'label').map(({ issue, why }) => `rigger resume: ${but(`removed the status label from issue #${issue}`, why)}`),
      ...closed.map((number) => `rigger resume: ${but(`closed the status issue #${number}`, refused(number, 'close'))}`),
      ...(unread === undefined ? [] : [`rigger resume: the read of the open issues labelled ${FIXED_LABELS.status} failed, so only the issues the closers named were closed: ${outsideText(unread)}`]),
      ...left.map(({ issue, why: cause, unlabelled }) => `rigger resume: the status issue #${issue} was left open${unlabelled ? ', its status label already removed, so no later read by label finds it' : ''}: ${outsideText(cause)}`),
    ].join('\n'),
    code: left.length === 0 && unrecorded.length === 0 && unread === undefined && admissionRefusals.length === 0 ? 0 : 1,
  };
}
