// ABOUTME: Reports which words a clause gained or lost when it moved between documents, and which clauses moved nowhere at all.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A rephrase that changes meaning usually changes words. This finds the changed words
// and shows them; a person decides whether the change was intended. It never decides.
//
// WHAT IT CATCHES
//   A clause absorbed by NOTHING. That is the only finding it reports as a failure,
//   and the only one it is sound on: no destination row shares enough vocabulary, so
//   the clause has no home. Exit code is non-zero and the clause is named.
//
// WHAT IT DOES NOT CATCH, AND WILL NOT
//   A clause absorbed NARROWLY. Word overlap cannot see quantifier scope, so a rule
//   whose reach shrinks while its vocabulary survives scores as a clean absorption.
//
//   This is not a tuning problem. It is what comparing bags of words means.
//
//   It has happened once, in the change this script was written to guard. The clause
//
//       "One engine runs against one repository, with sole control of its board and
//        its worktrees."
//
//   scored as absorbed, because engine, repository, board, control and worktree all
//   appear in the destination. What the destination actually said was
//
//       "At most one actor mutates a card's board state or its workspace at any
//        moment."
//
//   — per CARD, not per REPOSITORY. Two engines working disjoint sets of cards satisfy
//   the second and violate the first. Every word survived; the guarantee did not. The
//   check reported zero orphans and a human found it afterwards.
//
//   So: a green run means no clause was dropped whole. It does not mean the rules that
//   remain say what they used to say. Only reading the pairs does that, and the report
//   exists to make the pairs short enough to read.

const STOP = new Set(`a an and are as at be been before both but by can for from has have if in
into is it its may must never no not of on only or other over own same so than that the their then
there these this those to under until up upon was what when where whether which while who whom
whose will with within without`.split(/\s+/));

// Words that carry scope. A difference in one of these is far more likely to change
// a rule's meaning than a difference in any other word, so they are reported apart.
const SCOPE = new Set(`all any every each no none nothing anything everything some only just
sole single one two three both either neither always never ever outside inside beyond unless
except reach escalate proceed admit refuse block see give carry hold state record`
  .split(/\s+/));

const words = (s) =>
  s.toLowerCase()
    .replace(/`[^`]*`/g, ' ')          // inline code names a mechanism, not a scope
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

// Plurals only. Stripping -ing would collapse the noun "findings" onto the verb "find",
// which is the difference this check exists to see.
const stem = (w) =>
  /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : /(ss|ches|shes|xes|zes|ses)$/.test(w) ? w.replace(/es$/, '')
  : /[^s]s$/.test(w) ? w.slice(0, -1)
  : w;
const bag = (s) => new Set(words(s).map(stem));

const overlap = (a, b) => {
  const inter = [...a].filter((w) => b.has(w)).length;
  return inter / Math.max(1, Math.min(a.size, b.size));
};

/**
 * Compare one source clause against the rows it is claimed to have become.
 * Returns what the destination added, what it dropped, and which of those carry scope.
 */
export function compare(source, destinations) {
  const src = bag(source);
  const dst = new Set(destinations.flatMap((d) => [...bag(d)]));
  const added = [...dst].filter((w) => !src.has(w));
  const dropped = [...src].filter((w) => !dst.has(w));
  const scoped = (list) => list.filter((w) => SCOPE.has(w) || SCOPE.has(stem(w)));
  return {
    added,
    dropped,
    addedScope: scoped(added),
    droppedScope: scoped(dropped),
    score: overlap(src, dst),
  };
}

/** Pull the bullets out of a named section of a markdown file. */
export function bullets(path, heading) {
  const text = readFileSync(path, 'utf8');
  const i = text.indexOf(heading);
  if (i < 0) throw new Error(`no section ${heading} in ${path}`);
  const rest = text.slice(i + heading.length);
  const body = rest.slice(0, rest.search(/\n## /) < 0 ? rest.length : rest.search(/\n## /));
  return body
    .split(/\n(?=- )/)
    .map((b) => b.replace(/^- /, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Pull the requirement rows out of the requirements table. */
export function rows(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => /^\| R-[A-Z]+-\d+ \|/.test(l))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      return { id: cells[1], text: cells[2] };
    });
}

// Words a requirement drops on purpose, because naming a mechanism is what the
// rewrite removed. A drop from this list is expected; every other drop is a question.
const MECHANISM = new Set(`worktree branch checkout git hook sha commit marker packet ci
jsonl pgid cli ref prompt dispatch layer column`.split(/\s+/));

/**
 * For each source clause, the rows that absorbed it, and what changed.
 * `show` is how many matches to print; what a clause gained or lost is computed
 * against every row above `min`, so a clause absorbed by many rows is judged
 * against all of them rather than against an arbitrary top few.
 */
export function report(sources, destRows, { min = 0.2, show = 4 } = {}) {
  return sources.map((source) => {
    const ranked = destRows
      .map((r) => ({ ...r, s: overlap(bag(source), bag(r.text)) }))
      .sort((a, b) => b.s - a.s)
      .filter((r) => r.s >= min);
    // Asymmetric on purpose. A word is only LOST if no row that absorbed the clause
    // carries it, so dropped is judged against every match. A word is only WIDER if
    // the row closest to the clause added it; judged against all matches, the union
    // is the whole vocabulary and says nothing.
    const isMech = (w) => MECHANISM.has(w) || MECHANISM.has(stem(w));
    const wide = compare(source, ranked.slice(0, 2).map((r) => r.text));
    const lost = compare(source, ranked.map((r) => r.text));
    return {
      source,
      matches: ranked.slice(0, show),
      absorbedBy: ranked.length,
      added: wide.added,
      addedScope: wide.addedScope,
      droppedScope: lost.droppedScope.filter((w) => !isMech(w)),
      dropped: lost.dropped.filter((w) => !isMech(w)),
      droppedMechanism: lost.dropped.filter(isMech),
      score: lost.score,
    };
  });
}

// ---------------------------------------------------------------------------
// Self-test: the two real defects this check exists to catch. Both were written,
// both passed lint and every structural check, and both were found by a person
// reading a neighbouring row. If the check stops flagging them, it is broken.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: 'widened verb: escalates -> reaches',
    source: 'Nothing escalates to the owner outside the configured escalation set, and nothing inside it proceeds without the owner.',
    destination: 'Nothing reaches the owner outside the configured escalation set, and nothing inside it proceeds without the owner.',
    expect: 'reach',
  },
  {
    name: 'widened object: verdict -> findings or verdict',
    source: 'Every judge runs in its own dispatch, sees no other judge’s verdict, and writes its own verdict into a marker bound to the head SHA.',
    destination: 'No judge sees another judge’s findings or verdict, and no judge sees the maker’s session.',
    expect: 'finding',
  },
];

function selfTest() {
  let failed = 0;
  for (const c of CASES) {
    const { addedScope, added } = compare(c.source, [c.destination]);
    const all = [...addedScope, ...added];
    const hit = all.some((w) => stem(w) === c.expect || w === c.expect);
    console.log(`${hit ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(`      added: ${all.join(', ') || '(none)'}`);
    if (!hit) failed++;
  }
  return failed;
}

// ---------------------------------------------------------------------------
// The accepted invocations. Two of them, and every other argument vector is
// refused: a vector matching neither used to fall off the end of this module,
// and Node exited 0 having compared nothing. A caller read that as the check
// having passed.
// ---------------------------------------------------------------------------
const INVOCATIONS = `absorption-check accepts two invocations, and no other:
  --self-test                     run the built-in cases
  <source.md> <destination.md>    report what each source clause became`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === '--self-test') {
    process.exit(selfTest() === 0 ? 0 : 1);
  }

  if (args.length === 2) {
    const [archPath, reqPath] = args;
    const invariants = bullets(archPath, '## Invariants that hold across every layer');
    const destRows = rows(reqPath);
    console.log(`${invariants.length} source clauses, ${destRows.length} destination rows\n`);
    let orphaned = 0;
    for (const r of report(invariants, destRows)) {
      const head = r.source.slice(0, 84);
      if (r.matches.length === 0) {
        orphaned++;
        console.log(`NOT ABSORBED  ${head}\n`);
        continue;
      }
      console.log(`SOURCE  ${head}`);
      const more = r.absorbedBy > r.matches.length ? ` +${r.absorbedBy - r.matches.length} more` : '';
      console.log(`  became  ${r.matches.map((m) => `${m.id} (${m.s.toFixed(2)})`).join(', ')}${more}`);
      if (r.addedScope.length) console.log(`  WIDER?  added scope words: ${r.addedScope.join(', ')}`);
      if (r.droppedScope.length) console.log(`  NARROWER?  dropped scope words: ${r.droppedScope.join(', ')}`);
      if (r.dropped.length) console.log(`  DROPPED: ${r.dropped.join(', ')}`);
      if (r.droppedMechanism.length) console.log(`  (mechanism, expected: ${r.droppedMechanism.join(', ')})`);
      console.log('');
    }
    console.log(`${orphaned} clause(s) matched nothing.`);
    process.exit(orphaned === 0 ? 0 : 1);
  }

  console.error(`absorption-check: no such invocation: ${args.join(' ') || '(no arguments)'}`);
  console.error(INVOCATIONS);
  process.exit(2);
}
