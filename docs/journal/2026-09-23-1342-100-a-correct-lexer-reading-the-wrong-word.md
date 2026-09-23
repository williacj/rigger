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
