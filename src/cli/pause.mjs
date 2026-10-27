// ABOUTME: The `pause` verb: a thin caller of L3's admission module, which closes admission as the
// owner and records it, and then says the closer it added and every closer then present.

import { join } from 'node:path';

import { admission } from '../scheduling/admission.mjs';
import { PACKAGE, closerLine, settled } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

/** The reason every closer `pause` adds names. */
const OWNER_PAUSE = "the owner's pause";

/**
 * The line `pause` prints for closer `closer`: the words `once`, `plan` and `doctor` name a closer
 * in (`closerLine`), then the closer's path (K100 on #740).
 */
const presentLine = (closer) => `rigger pause: ${closerLine(closer)}; at ${closer.path}`;

/** The line verb `verb` prints for an entry it could not read: its path and the cause. */
const unreadableLine = (verb) => ({ path, cause }) => `rigger ${verb}: unreadable closer ${path} (${cause})`;

/**
 * What `rigger pause` prints, and the status it exits with. It resolves the repository and its
 * state directory as `once` does, and reads no `rigger.config.mjs`. `now` is the clock the closer's
 * time is read from, and `fs` the `node:fs` calls the module makes, each a test's to replace.
 */
export const pause = (options) => recording((opened) => pausing(opened, options));

/** `pause`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function pausing(opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, now = Date.now, fs,
} = {}) {
  const { named, refusal } = await settled('pause', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const admissionRecord = admission({ directory: join(named, STATE), run: opened.run, now, sink: opened.sink, ...(fs && { fs }) });
  /** Every closer present, and every entry that cannot be read, a line each. */
  const present = () => {
    const state = admissionRecord.read();
    return [...(state.closers ?? []).map(presentLine), ...(state.unreadable ?? []).map(unreadableLine('pause'))];
  };
  let closer;
  try {
    closer = await admissionRecord.close({ kind: 'owner', reason: OWNER_PAUSE });
  } catch (failure) {
    // A refusal after the link leaves the closer standing, so what is present is said either way.
    return { text: [`rigger pause: ${failure.message}`, ...present()].join('\n'), code: 1 };
  }
  return {
    text: [
      `rigger pause: closed admission as the owner at ${closer.path}: ${closer.reason}; time ${closer.time}`,
      ...(closer.leftover ? [`rigger pause: the temporary file ${closer.leftover} could not be removed, and the close stands`] : []),
      ...present(),
    ].join('\n'),
    code: 0,
  };
}
