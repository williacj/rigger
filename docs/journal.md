ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A form rule that nothing checks

`AGENTS.md` gained a rule about how a paragraph is written. The two passages that prompted it
broke no rule, and both were delivered by makers who had loaded the skills they were working
under: one in `.claude/skills/tdd/SKILL.md`, one an entry in this file.

`npm run lint:spec-style` prints the documents it reads, and they are `README.md`,
`ARCHITECTURE.md`, `docs/spec/decisions.md` and `docs/spec/requirements.md`. No skill and no
journal is among them, so neither passage was ever in front of it.

Of the four rules the lint's own skill states, it applies two.
`.claude/skills/spec-style/SKILL.md` says rules 3 and 4 are judgments an author applies and a
reviewer reads for, and `test/spec-style-lint.test.mjs` pins that silence: no finding about
voice, and none about whether prose should have been a list.

Nothing therefore checks the new rule on any document, and that is why it went into the file
every session loads rather than into a skill. A rule living in a skill reaches the sessions that
load that skill, and that is the set which produced both passages.

The root instruction file now measures 1,977 words against the 2,000 `ARCHITECTURE.md` allows,
so 23 words of headroom are left for every rule after this one.

## 2026-09-22 — Four sentences said the build reds, and no check did

`D17` had to settle what a requirement no test claims does to the build. Four places said CI
reds on one, `AGENTS.md` said it of a requirement being added, and the draft of `D17` repeated
that red as though a check performed it. Running the matrix generator over a scratch copy of the
register showed none of them is mechanical.

Adding an unclaimed requirement and regenerating the matrix leaves every check at exit 0. So
does deleting the test that claimed a requirement: the staleness check reds once, a regenerated
matrix clears it, and the row goes quietly back to a gap. Editing a row's `checked by` moves
the matrix's mark and never the count, and retiring an unclaimed row moves both numbers down by
one with no test written.

Three of those four were claims the draft made in prose and would have shipped unmeasured. Each
took about a minute to measure, and two of them came back the opposite of what the prose said.
The rule that a decision's claims about a tool get run rather than reasoned about is cheap
enough that there is no excuse for the reasoned version.
## 2026-09-22 — The architecture already held the config, so the validator had nothing to invent

The config core looked like a design job and turned out to be a transcription job.
`ARCHITECTURE.md` publishes a config shape under its extension-point table, and that shape is
the only place the corpus spells any of these keys. Taking it as the offer left nothing for this
card to name: the test runs that block as a module and compares its key paths against the
validator's, in both directions, so a key the architecture does not spell cannot be offered and
one it does spell cannot be missed.

What the shape does not spell is the interesting part. The table names three engine settings the
shape leaves out — the worktree root, the state directory and the topic rule — and two rows
marked `Yes` that it gives no key: document checking, which the config points at rather than
contains, and clock triggers, which nothing reads before M7. A config naming any of those five
is refused today, because Rigger offers no spelling for them yet. That is a real bound on the
refusal, not a completeness claim, and the card that lands each setting is what adds its key.

The generalisation that found the most also hid the most. Refusing a key nobody offers was
tested by growing every shape the config reaches, and a container key — `roles`, `kinds`,
`provisioning` — is never itself one of those shapes, so three sites went unwatched and each
crashed on a `null`. A site derivation that walks the values a config holds can only reach the
sites that config nests, and the class the test names is wider than that. Deriving the sites
from the shape table instead reaches every one of them, whatever a config happens to hold.

An exhaustive walk over a single probe is still a single probe. With every site reached, the
test grew a key nobody offers at each one and asserted a refusal — and the key it grew was
`fixedByRiggerAndNotTheConsumer`, which nothing can inherit. The check behind it asked
`key in shape`, which answers yes to every name `Object.prototype` carries, so `toString`,
`constructor` and nine others were offered as declarations at all twenty sites, and the
required-key check answered the same way: a config declaring nothing and inheriting all four
required keys was accepted outright. Changing that one expression moved no test either way.
The probe set is now every name the runtime says an object carries, asked for rather than
listed, plus the one name nothing carries as a control. Coverage of the sites and coverage of
the values are two separate questions, and a walk that is exhaustive in one direction reads as
though it were exhaustive in both.

The matrix is what made that expensive rather than merely wrong. The test carried
`// proves R-SCHED-10`, so a generated binding document recorded a requirement as proved by a
test that could not tell the two behaviours apart. A declaration is a claim about a test's
discriminating power, not about its subject, and nothing checks it: the cheapest thing that
does is to break the behaviour on purpose and watch that test, and only that test, go red.

Two claims in this card's own commit messages turned out not to match the code, in consecutive
rounds. One said a rule lived in the read itself when it did not, for three keys. The other
attached a refusal count to `roles: null`, where the count belongs to a string, a list or a
number — `null` throws without the guard the same commit added. Both were true of the substance
and wrong in the detail, and a detail in a commit message is read later as evidence. Running
the claim before writing it down costs one command.

Three tests could not have failed first, because each generalises a test that already had. Each
was instead watched failing with its own defect mutated into the validator: the required-key
refusal stubbed out, the unknown-key sweep stubbed out, and a key the architecture does not
publish added to this repository's config. A fourth test — that the validator accepts this
repository's own config — can only fail by that config changing, which is what it is for.

One fixture was wrong in a way that would have passed for the wrong reason. The owner-order test
named the kind's own maker among its judges, so it earned two refusals, and it would have gone
green off the maker-and-judge separation rule rather than the order rule it tests. Asserting the
refusal count rather than a match is what caught it.

## 2026-09-22 — A test that passed on the runtime's error message, not on ours

The event sink's reader refuses a torn line and names it. The test for that asserted `/line 1/`
and passed the moment it was written, which should have been the tell. What it matched was V8's
own JSON message, `Unterminated string in JSON at position 45 (line 1 column 46)`, and the line
V8 names is the line inside the fragment it was handed rather than the line in the stream.

So the assertion agreed with the runtime by coincidence. It would also have gone red on CI's
Node 20 leg, where the same failure reads `Unexpected end of JSON input` and names no line at
all. The fix was to give the reader its own message, naming the file and the line, and to assert
that text. A test whose expected value can be produced by something other than the code under
test is worth re-reading, even when it fails first for the right reason.

Five of the eleven tests here passed as soon as they were written, because the minimal code for
the first test already covered what they asked. Each was then checked by breaking the sink on
purpose — writing instead of appending, spreading the layer's fields ahead of the envelope,
appending asynchronously — and every one of them went red. That is cheap, and it is the only
thing that separates a test which holds a behaviour from one that describes it.

What the sink guarantees is smaller than "durable". Appends are synchronous, so a process killed
outright loses no event that had already returned, and that is measured by killing one. Nothing
is flushed to the disk, so power loss can still lose the tail, and two writers are not something
this code has been measured against.

## 2026-09-22 — The lint arrived after the corpus, and the corpus barely cleared it

Writing `spec-style-lint` against documents already written showed how little headroom the
sentence ceiling has: the longest sentence the lint reads is 39 words against a ceiling of 40.
The next compound sentence anyone writes into the README or the register reds the build.

Two of the four register rules turned out to be unlintable, and the reason is worth keeping.
Rule 3 asks whether an actor is genuinely unknown and rule 4 asks whether a structure fits its
meaning. Both are judgments about intent, and a lint that guessed at either would file findings
an author has to argue with rather than fix.

The sentence splitter asks the word after a full stop whether the stop ended a sentence, and it
is wrong both ways. A lowercase word keeps two sentences joined, as `v0 buys` does, and the
count comes out high. A capital after an abbreviation splits one sentence into two, the way
`e.g. Rigger` does, and the count comes out low.

The second of those cost a review round, because this entry first claimed it could not happen.
A bias in a check is worth disclosing, and a bias described as absent is worse than one nobody
mentioned: a reader then draws a conclusion the check cannot support. A green lint says no
sentence the splitter reads is past the ceiling, which is narrower than it sounds.

## 2026-09-22 — A guarantee that was only a convention

A test declares what it proves in a `// proves R-GROUP-#` comment, and the tool that builds the
test matrix reads those out of the test sources. Its own tests hand it fixture sources, so a
scan matching anywhere on a line would read every fixture as a claim by the file quoting it.
Anchoring a declaration to a whole line answers that for a fixture written as a single-line
string, which is every fixture this repository had, and three documents went on to state it as a
property of the scanner. It was a convention the fixtures kept. A fixture written as a template
literal spanning lines, and a call commented out under a live declaration, each produced a matrix
naming a test that did not exist, and neither said a word. Closing those brought the lesson round
again from the other side: the block-comment state added with them read a marker inside a string
as a marker, and dropped every declaration after it in silence. A missing claim reads like an
honest gap, which is worse than a false one in the document meant to tell them apart. What the
scan cannot read it now refuses by name, and the little it still cannot see is written down
beside it rather than claimed away.

## 2026-09-22 — A generated document and CRLF

The test matrix is compared with what its tool writes, byte for byte. Git hands a Windows
working tree CRLF and the tool writes LF, so on Windows the check called a freshly written file
stale. `.gitattributes` pins `docs/derived/` to LF, the way it already pins the hooks. Any
generated document that lands there inherits the pin.

## 2026-09-22 — The code stated two facts it did not own

Card #29 built `scripts/package-budget.mjs`, the check CI runs against the package line budget.
Two review rounds on PR #40 found two defects in it, and the gap both sat in had no rule.

The round 1 review found the scan entering block-comment state on a `/*` inside a string. The doc
comment above it bounded the cost at "an undercount of one line". Nobody had measured that bound:
the real undercount ran to the next `*/` or to the end of the file, in the check that decides
whether an over-budget package merges.

The round 2 review found the file excluding tests by a list of spellings it had thought of itself.
Three shapes `node --test` executes were charged to the production budget — `test.mjs`,
`test-*.mjs`, and every file under a `test` directory — where `ARCHITECTURE.md` puts tests outside
it. `npm test` is `node --test`, so what counts as a test was never that script's question.

What the two share is not the fix but the mistake: code asserting a fact it did not own. Both
passed a green suite, because an assertion the code derives from itself agrees with itself. The
second fix found the authority and read from it. The first measured the disagreement it had
guessed at, and stated what it really costs.

The second half is the one an author drops. Reading from an authority couples the code to that
authority's behaviour, including where that behaviour is undefined.

Measured on this repository's own checkout — Windows, Node v24.18.0 — `node --test` runs
`a.TEST.mjs` and declines `TEST.mjs`. The cause is in the runner, not on the disk. Node's own
`internal/fs/glob` folds case on the platform, `nocase: isMacOS || isWindows`, and its
`nocaseMagicOnly: true` leaves an alternative that is wholly literal to match exactly. The
runner's default pattern expands to a literal `test.mjs`, which `TEST.mjs` misses, and to a
`*[._-]test.mjs`, which `a.TEST.mjs` matches.

The exclusion on `main` is case-sensitive, so it charges `a.TEST.mjs` to the production budget
while the runner runs it as a test. The test that asks the runner does not catch it, because its
fixture is all lower case. `D16` records both halves: ask the authority, and record where the
authority can disagree with you.
