ABOUTME: A journal entry from card #31: The architecture already held the config, so the validator had nothing to invent

## 2026-09-22 — The architecture already held the config, so the validator had nothing to invent

The config core looked like a design job and turned out to be a transcription job.
`ARCHITECTURE.md` publishes a config shape under its extension-point table, and that shape is the
only place the binding documents spell any of these keys. Taking it as the offer left nothing for
this card to name: the test runs that block as a module and compares its key paths against the
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
