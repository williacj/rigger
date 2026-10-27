// ABOUTME: The `resume` verb: a thin caller of L3's admission module, whose `resume` removal removes
// every closer it read and records each, and then says what it removed, or why it removed nothing,
// an unreadable admission's entries in the words `doctor` names them in.

import { join } from 'node:path';

import { admission } from '../scheduling/admission.mjs';
import { PACKAGE, removedCloserLine, settled, unreadableAdmission } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

/**
 * What `rigger resume` prints, and the status it exits with. It resolves the repository and its
 * state directory as `once` does, and reads no `rigger.config.mjs`. It removes closers only; the
 * status issue's read and close, `ARCHITECTURE.md`'s first and third steps of `resume`, are not
 * here, so it makes no forge call. `now` is the module's clock and `fs` the `node:fs` calls the
 * module makes, each a test's to replace.
 */
export const resume = (options) => recording((opened) => resuming(opened, options));

/** `resume`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function resuming(opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, now = Date.now, fs,
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
  return {
    text: [
      ...removed.map((closer) => `rigger resume: ${removedCloserLine(closer)}`),
      ...gone.map(({ kind, path }) => `rigger resume: the ${kind} closer ${path} was already gone`),
    ].join('\n'),
    code: 0,
  };
}
