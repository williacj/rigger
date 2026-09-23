ABOUTME: A journal entry from card #100: A correct lexer reading the wrong word

## 2026-09-23 — A correct lexer reading the wrong word

Card #71 spent four rounds teaching the command gate's lexer where bash reads a command word, and
got it right. `{ git push --force; }` lexed correctly the whole time — into one command whose words
are `{`, `git`, `push`, `--force`. The rule that decides whether a command is git at all read word
one, found a brace, and stepped aside. Every construct in card #100's table failed that way, and
bash ran the reserved command in all six.

**The defect was in the consumer, not the lexer, and the two failure modes look nothing alike.**
Card #71's bypasses were the lexer skipping text bash goes on to run; this one is the lexer handing
over the right text and the rule asking the wrong question of it. Both present as "the gate
permitted a reserved command bash runs", so the presentation says nothing about where to look. What
distinguished them was reading how the words arrived rather than what the verdict was.

**The direction a change can go wrong is a property of the change, not of the file.** Card #71's
round-4 judge established that widening the here-document placement rule trades a refusal for a
bypass, so the rule was left narrow. Stepping over a leading word is the opposite shape: it can
only surface a program the gate was not reading, so it adds refusals and takes none away. The two
moves look like the same move — both widen what the gate reaches — and only one of them can hide a
command. Measured both ways: 144 commands the suite names, run through the gate at `origin/main`
and the gate on this branch, 43 moved from permitted to refused and none the other way.

**The card's table was six rows; the family was nineteen rules.** Enumerating from bash's
reserved-word list rather than from the reported cases turned up `elif` as a condition, `!`, `time`
with and without `-p` and `--`, `coproc`, `function`, `in` after a substituted `case` word, and a
`NAME()` function header — every one a live bypass on `main`, measured with `git` shadowed by a
marker. The same enumeration is what said which words to leave out, and leaving one out is also a
measurement: `[[` opens a conditional bash runs no command inside, and `for x in git push --force`
is a word list bash runs no git from. A table of the cases someone happened to hit is not the
family, in either direction.

**Two of the nineteen rules were in the code with nothing asserting them, and the payloads named
for them hid it.** The row called `if / elif / then` puts the push after `then`, so deleting `elif`
from the list leaves it green; the row called `select / do` puts it after `do`. A row named for a
keyword is not a test of that keyword — the same shape as #71's "a refusal by accident reads
exactly like a control", one step further in: a refusal by a *different rule* reads exactly like a
control too, and the row's name is what makes it invisible.

**One guarded mutation of nineteen changed no verdict, and it was the one that found something.**
Replacing the rule that steps over a `case` pattern whose `)` is its own word left the suite green.
The rule was not dead: in the first branch the `case` word is on the same command and the pattern
scan already ends at the `)`, but in a later branch it is not, and
`case x in a) :;; x ) git push --force;; esac` is a bypass bash runs. The mutation that reports
nothing is worth more attention than the eighteen that report a red, because a green there is
either dead code to delete or a payload missing — and this repository's habit is to read it as the
first.

**And the harness needed a control on the oracle, not only on the gate.** It refuses to print
unless the gate refuses a bare `git push --force` and permits a bare `git status` — the control that
caught a zero-byte gate file earlier in this milestone. That is only half of it: a `git` shim that
never reached `PATH` reports "did not run git" for every payload, and every bypass then reads as
inert. So the same two controls are asserted against bash as well, and the shim has to have run for
both before any row is printed.

## Round two — the enumeration was of the wrong thing

A judge found the rule this card rewrote stepping over only *some* of the words bash puts before a
program. A redirection was missing, and so was every prefix program but `env`; 59 payloads reached a
reserved command through them.

**The list above was enumerated from bash's reserved words, which was the wrong axis to exhaust.**
Bash's grammar for a simple command is assignments and redirections, then the program; the
construct introducers are a second axis, and the programs that exec another program are a third. I
enumerated one axis to its end, reported it as thorough, and never asked what *kind* of word I was
listing. `AGENTS.md`'s acceptance skill says exhausting one axis is not covering the card, and that
is what a complete-looking enumeration buys you: confidence proportional to the axis rather than to
the problem.

**The sharpest evidence was that the gap disabled step-overs the gate already had.**
`env git push --force` and `X=1 git push --force` were refused before this card; inserting
`>/dev/null` between the prefix and the program defeated both. A missing case that only fails to
add cover is one thing, and a missing case that switches off working cover is another — and reading
the rule rather than the diff is what would have shown it, because the redirection sits between two
clauses that both already worked.

**The direction argument held, and it was worth having had it in writing.** Stepping over a word,
and reading the words after a prefix, can each only surface a program the gate was not reading. So
round two widened freely where card #71 could not, and the 0 in "refused to permitted, over 214
commands, twice" is what let it. The one place that argument did not cover was the lexer, where the
change was to *narrow* the operator set — and there the honest move was to write down the one side
effect (`2>&1<<EOF` becomes a here-document the gate refuses rather than honours) and show it lands
on the safe side.

**Then three separate green mutations, all found by a guard rather than by reading.** The runner now
treats a mutation that leaves the suite green as a guard failure, in the same breath as a mutation
that fails to apply. It stopped three times. Once because a payload named for a rule reached it
through a different rule — the lesson from round one, repeated. Twice because the rule element was
genuinely redundant: two `REDIRECTION` members nothing can reach, and `time` held in both the
keyword list and the prefix list, which let `TIME_OPTIONS` and its loop be deleted outright. **The
mutation that reports nothing is the one carrying information**, and the only way to stop reading
past it is to make green fail loudly.

**And the runner's own failure path was leaving the repository mutated.** `die()` exited before the
restore, so the first green mutation left a mutant on disk — and the next three measurements I took
were against it, which is how `bash -c 'nohup bash -c "…"'` came to look permitted when it is
refused. Nothing in the output said so; the contradiction with a trace I had done by hand is what
caught it. A harness that can leave the thing under test modified has to restore on every exit, not
only the happy one.

## Round three — a figure nobody re-measured, and the third program of a kind

Round two moved `time` out of the keyword list and into the prefix list, and the prefix list reads
every word rather than a modelled option grammar. That change made `time --portability git push
--force` refused. A table three sections away still said it was permitted, and the sentence beside
a correct tool-produced line count still did arithmetic on a figure from before a deletion. Both
were true when they were written. **A commit that moves what a figure counts stales every figure
downstream of it, and nothing in a green suite says which ones.** The rule that follows is narrow
and cheap: a number or a verdict in the pull request is re-measured at the head it is reported at,
not carried forward from the round that first measured it.

**The scan was of words, and the family is of programs that do not put the command in a word.** The
gate held that shape twice before this round — a shell's `-c` argument, and `eval`, which joins its
arguments and runs the result as text. `env -S` is the third, and it was on the prefix list the
whole time: `env` was named, the scan ran over every word after it, and the command was inside one
of those words rather than spread across them. **Being on the list is not the same as being read.**
An enumeration answers "is this program a prefix" and says nothing about how that program finds the
command it runs, so each name on it can still carry its own way of hiding one.

**And the list being a list is itself a limit.** Seventeen names close seventeen ways in; a prefix
program not named there is fail-open, whatever the rule around it does. That is worth stating at
the list rather than leaving the next reader to infer a closed family from a long one.

## Round four — complete at its own level, four times

Each round of this card enumerated something to exhaustion and was then defeated one level down.

| round | enumerated to exhaustion | what defeated it |
|---|---|---|
| one | bash's reserved words | redirections, and programs that run a named command |
| two | the names of those programs | an *option* of a listed name, carrying the command in one word |
| three | that option's spellings | `getopt_long`'s abbreviation rule, so `--s=` is `--split-string=` |
| four | that rule, and the second program holding it | — |

No round was careless and every fix was correct; each closed more than it was asked to. What the
sequence says is about the method rather than about any round of it. **A gate that reads command
text has to model bash's grammar *and* the option grammar of every program bash can be asked to
run a command through, and the second of those is not a closed set** — it is one grammar per
program, each with its own abbreviation rule, and a program absent from the list is fail-open
whatever the rule around it does. Card #117's closing paragraph already puts that question to the
owner. This entry records that four rounds of measurement are the evidence for it, because nothing
else will.

**Two rules came out of it that are worth keeping whatever the answer.** A figure or a verdict is
re-measured at the head it is reported at; carrying one forward is how round 2 came to assert a
`time` row that a commit of its own had already made false. And a green mutation is read rather
than passed over: it fired four times across the card, three times finding a redundant rule element
and once, in round 4, finding an element that was load-bearing but pinned by no test — every long
option name begins with the empty string, so a bare `--` would have matched the option and left the
real one further along unread.
