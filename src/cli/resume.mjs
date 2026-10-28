// ABOUTME: The `resume` verb: a thin caller of L3's admission module, whose `resume` removal removes
// every closer it read and records each, and then of L2's notice function, which closes the status
// issue; it says what it removed and closed, or why it removed or closed nothing, an unreadable
// admission's entries in the words `doctor` names them in.

import { join } from 'node:path';

import { FIXED_LABELS, validate } from '../config/validate.mjs';
import { admission } from '../scheduling/admission.mjs';
import { columnChanges } from '../workflow/transitions.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, removedCloserLine, settled, unreadableAdmission } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

/**
 * What `rigger resume` prints, and the status it exits with, in `ARCHITECTURE.md`'s order: it
 * resolves the repository and its state directory as `once` does, removes the closers it read,
 * and only then reads `rigger.config.mjs`, so a missing config or the forge never keeps admission
 * closed (`R-SCHED-23`). It reaches L2's notice function through L2's own entry point, built from
 * the config, as `once` reaches L2, to close each issue a removed closer's name gave and every other
 * open issue carrying the status label (`R-SCHED-24`). Where it removed nothing, it reads no config
 * and closes no issue. `now` is the module's clock, `fs` the `node:fs` calls the module makes and
 * `send` the runners' spawn, each a test's to replace.
 */
export const resume = (options) => recording((opened) => resuming(opened, options));

/** `resume`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function resuming(opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, now = Date.now, fs, send,
} = {}) {
  const { named, refusal } = await settled('resume', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: opened.sink, ...(fs && { fs }) });
  let answer;
  try {
    answer = await admissionRecord.resume();
  } catch (failure) {
    return { text: `rigger resume: ${failure.unreadable ? unreadableAdmission(failure.unreadable) : failure.message}`, code: 1 };
  }
  const { removed, gone } = answer;
  if (removed.length === 0 && gone.length === 0) return { text: 'rigger resume: admission was already open', code: 0 };
  const lines = [
    ...removed.map((closer) => `rigger resume: ${removedCloserLine(closer)}`),
    ...gone.map(({ kind, path }) => `rigger resume: the ${kind} closer ${path} was already gone`),
  ];
  // Every closer read was gone at its removal: another `resume` removed them, and closes the issue.
  if (removed.length === 0) return { text: lines.join('\n'), code: 0 };
  const { config, problem } = await consumerConfig(named);
  const invalid = problem === undefined ? validate(config) : [];
  const why = problem ?? (invalid.length > 0 ? `\`${CONFIG}\`: ${invalid.join('; ')}` : undefined);
  if (why !== undefined) return { text: [...lines, `rigger resume: no status issue was closed, because ${why}`].join('\n'), code: 1 };
  const issues = [...removed, ...gone].filter(({ issue }) => issue !== undefined).map(({ issue }) => Number(issue));
  const { closed, left, unread } = await columnChanges({ config, sink: opened.sink, send }).notice.close(issues);
  return {
    text: [
      ...lines,
      ...closed.map((number) => `rigger resume: closed the status issue #${number}`),
      ...(unread === undefined ? [] : [`rigger resume: the read of the open issues labelled ${FIXED_LABELS.status} failed, so only the issues the closers named were closed: ${unread}`]),
      ...left.map(({ issue, why: cause }) => `rigger resume: the status issue #${issue} was left open: ${cause}`),
    ].join('\n'),
    code: left.length === 0 && unread === undefined ? 0 : 1,
  };
}
