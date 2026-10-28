// ABOUTME: L0's push side: the one write that sets the data ref, refs/rigger/events on origin, to
// a commit holding the whole event stream, never forced ("Pushing the stream").

import { gitEnvironment } from './git-environment.mjs';
import { EVENT_REFUSED, runCommand } from './process.mjs';

/** Every push's time limit, in milliseconds, over the whole push (`R-RECORD-17`). */
export const PUSH_TIMEOUT = 30_000;

/** The data ref on `origin`, the one ref the push side writes (boundary rule 2). */
const DATA_REF = 'refs/rigger/events';

/** The message every stream commit carries. */
const MESSAGE = 'rigger: the event stream';

/**
 * Pushes `stream`, the stream's bytes as L5 read them, to the data ref on `origin` of the
 * repository at `repository`, by origin's one push URL, and answers how the push went: `{ outcome,
 * bytes, parent, commit, reason }`, each field present where "The outcome" says a `push.end` line
 * holds it.
 *
 * Every `git` call goes through `spawn`, which has `runCommand`'s contract and is `runCommand`
 * unless the caller hands another, with `emitter` for the process adapter's kill events and the
 * environment `gitEnvironment` gives of `environment`, with prompts off. The whole push has
 * `limit` milliseconds on the clock `now` reads, `PUSH_TIMEOUT` unless the caller hands a shorter
 * one, and each call is handed what is left of it.
 */
export async function pushStream({ repository, stream, emitter, limit = PUSH_TIMEOUT, spawn: run = runCommand, now = Date.now, environment = process.env }) {
  const start = now();
  const env = { ...gitEnvironment(environment), GIT_TERMINAL_PROMPT: '0' };
  // "The commit": the stream up to and including its last newline, so a line still being appended
  // waits for the next push.
  const held = stream.subarray(0, stream.lastIndexOf(0x0a) + 1);
  // The fields every answer carries, `parent` joining them once the tip is read.
  const known = { bytes: held.length };
  /**
   * Runs git with `args`, handing it `input`, and hands back what it printed, as text. A call its
   * timeout ended ends the push as timed out, in the process adapter's own phrase for that.
   */
  const git = async (args, input) => {
    const timeout = limit - (now() - start);
    // `runCommand` starts nothing given no positive timeout, and the push has then run out of time.
    if (timeout <= 0) throw new Ended('timed-out', `the push's limit of ${limit} ms was spent before git ${args[0]} started`);
    const result = await run({ command: 'git', args, cwd: repository, env, input, timeout, emitter });
    if (result.timedOut) throw new Ended('timed-out', `the timeout of ${timeout} ms ended git ${args[0]}`);
    return { ...result, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
  };
  /** Runs git as `git` does, ending the push as failed, in git's words, where it exits non-zero. */
  const needed = async (args, input) => {
    const result = await git(args, input);
    if (result.exit !== 0) throw new Ended('failed', printed(result));
    return result.stdout;
  };
  const steps = async () => {
    // A tip holding an empty copy would read as an empty record over a full stream.
    if (held.length === 0) throw new Ended('failed', 'the stream\'s bytes hold no complete line, so the push wrote nothing');
    // Every step addresses the one URL a push to `origin` goes to, so the guard, the parent and
    // the write name one repository, and a fetch mapping of origin's gets no ref to update.
    const urls = (await needed(['remote', 'get-url', '--push', '--all', 'origin'])).split('\n').filter(Boolean);
    // One URL only: a push to one of several would reach that one alone.
    if (urls.length !== 1) throw new Ended('failed', `origin has ${urls.length} push URLs, ${urls.join(', ') || 'none'}, where the push needs exactly one, so the push wrote nothing`);
    const [url] = urls;
    const { parent, other } = tipIn(await needed(['ls-remote', url, DATA_REF, 'refs/remotes/refs/rigger/events/HEAD']));
    if (parent !== undefined) known.parent = parent;
    if (other !== undefined) throw new Ended('failed', `${url} holds ${other}, to which git push would resolve ${DATA_REF}, so the push wrote nothing`);
    const blob = (await needed(['hash-object', '-w', '--stdin'], held)).trim();
    const tree = (await needed(['mktree'], `100644 blob ${blob}\tevents.jsonl\n`)).trim();
    const committed = (onto) => git(['commit-tree', tree, ...(onto === undefined ? [] : ['-p', onto]), '-m', MESSAGE]);
    let built = await committed(parent);
    if (built.exit !== 0 && parent !== undefined) {
      // None of the allowed calls asks whether the store holds an object in words that do not
      // depend on the locale, so the tip is taken as lacking where a commit with no parent can be
      // built and one onto the tip cannot. Only then is it fetched.
      if ((await committed(undefined)).exit !== 0) throw new Ended('failed', printed(built));
      await needed(['fetch', '--no-write-fetch-head', '--no-tags', url, parent]);
      built = await committed(parent);
    }
    if (built.exit !== 0) throw new Ended('failed', printed(built));
    const commit = built.stdout.trim();
    const sent = await git(['push', '--porcelain', '--no-signed', '--no-verify', url, `${commit}:${DATA_REF}`]);
    if (sent.exit !== 0) throw new Ended(rejected(sent.stdout) ? 'refused' : 'failed', printed(sent));
    return { outcome: 'pushed', ...known, commit };
  };
  try {
    return await steps();
  } catch (failure) {
    if (failure instanceof Ended) return { outcome: failure.outcome, ...known, reason: failure.reason };
    // A refused event here is one of the process adapter's kill events, which goes to L3's halt
    // and never into an outcome ("Failure model").
    if (failure?.code === EVENT_REFUSED) throw failure;
    return { outcome: 'failed', ...known, reason: failure.message };
  }
}

/** How a push that did not succeed ended, thrown from the step that ended it. */
class Ended {
  constructor(outcome, reason) {
    this.outcome = outcome;
    this.reason = reason;
  }
}

/**
 * Whether `git push --porcelain` printed a rejected status for the data ref: a line `!`, a tab,
 * `<commit>:refs/rigger/events`, a tab and the reason, as git's documentation for `--porcelain`
 * gives it.
 */
const rejected = (porcelain) => porcelain.split('\n').some((line) => line.startsWith('!\t') && line.split('\t')[1]?.endsWith(`:${DATA_REF}`));

/** What a `git` call printed, its standard error and then its standard output, trimmed. */
const printed = ({ stdout, stderr }) => `${stderr}${stdout}`.trim();

/**
 * What `git ls-remote` printed, one `<object>\t<ref>` line a ref, read as the data ref's tip,
 * `parent`, and the first other ref it printed, `other`, each undefined where there is none.
 */
function tipIn(listing) {
  const read = {};
  for (const line of listing.split('\n').filter(Boolean)) {
    const [object, ref] = line.split('\t');
    if (ref === DATA_REF) read.parent = object;
    else read.other ??= ref;
  }
  return read;
}
