ABOUTME: This is the core product requirements doc for Rigger. Each requirement states a condition, names no mechanism, and records what makes it true and what would catch a violation.

# Requirements

**Every row in this file binds**, so a reader never has to check a column before trusting one — a
row proposed and not yet ratified lives in its pull request, never here. The owner ratifies a
proposed requirement by writing a sound owner marker on its pull request, and the row binds from
that pull request's merge (`D25` rule 4).

A requirement states what must be true. It is observable from outside, and it names no mechanism;
`ARCHITECTURE.md` holds the structure that implements it. A requirement survives a redesign where
that structure may not. Requirements themselves still change over time, and are added and
withdrawn as what Rigger must do changes.

A decision states what was chosen among the structures that satisfy these requirements, and what
would reverse it. `docs/spec/decisions.md` holds those. Where a requirement follows from a
decision it cites it, and the decision is where the reasoning lives. A requirement citing nothing
originates here.

A row may bound its scope with a dimensions table. Put that table under the row's group, directly
after the group's row table. Give it a level-three heading beginning with the row's id, for
example `### R-TABLEEXAMPLE-1 — Example states`; the row cites its id and that heading. The
table binds as its row does.

**Scope.** These bind a Rigger deployment: the engine, the gate, the roles and configuration a
consumer supplies, and the machine they run on. Some conditions Rigger checks; others it can only
instruct a role to honour. Rules that bind work in this repository, rather than the product, are
not requirements: `docs/spec/decisions.md` holds the ones about building Rigger, and `AGENTS.md`
holds the ones about working in it.

What a requirement binds and where a violation is caught are separate questions. A requirement
here binds the product; the thing that catches a violation may be Rigger's own test suite, which
no deployment contains.

**Two columns, and the difference between them matters.** `made true by` names who or what is
supposed to satisfy the requirement. `checked by` names what would catch a violation, and takes
one of five forms:

1. **A named observer**, with the observation it makes — `the gate`, `the config validator`, `the
   event record, by <the derivation>`, `the operating system`, `the engine, at admission`. Naming
   the artifact without the derivation says nothing, so the derivation is part of the entry.
   Partial coverage says so: `the gate, for omitted items only`.
2. **A judge**, named with the row that obliges it. A judge is a role reading a prompt, not a
   mechanism, and the difference between the two is what this column exists to show.
3. **`the test suite`** — caught in Rigger's own development rather than in a deployment. This one
   needs no derivation, because the row's own text is what the test asserts.
4. **`nothing yet`** — an observation exists and nothing performs it.
5. **`nothing could`**, *and the reason* — no observation exists even in principle. A
   `nothing could` carrying no reason is read as `nothing yet`, because the recoverable state is
   the safer default.

The actor in `made true by` is never the entry in `checked by`. Rigger doing a thing is not a
check that Rigger did it.

`checked by` names what *would* catch a violation. Which tests actually do is
`docs/derived/test-matrix.md`, which a tool builds from the tests themselves. `D17` states which
requirement with no test is a counted gap, and who is obliged to close it. Editing a row's
`checked by` moves no requirement into that set or out of it.

**Ids and lifespan.** Ids group by subject, and an id is never reused. A new requirement takes a
new id in its group.

One test decides whether an edit keeps an id: **does it change what must be true of Rigger, read
across the whole document?** If it does not, the id stays, however much the words moved. If it
does, the edit takes a new id and withdraws the old one. The test is deliberately about Rigger and
not about the row, so removing a sentence another row already states keeps the id. A change to
`made true by` or to `checked by` is never a change to what must be true, and never takes a new
id.

Splitting and merging follow from the same test. A row split into two withdraws and allocates a new
id for each part. Rows merged into one withdraw and allocate a single new id.

A withdrawn requirement leaves this document, and only the owner withdraws one. Its row moves to
`docs/spec/requirements-retired.md`, which binds nothing and exists so that a citation to a
withdrawn id still resolves and so that the id is never allocated again. The duplicate-id check
reads both files. A group with no requirements yet is not written until it has one.

A withdrawn row's dimensions table moves with it to `docs/spec/requirements-retired.md`. Editing
the table to move any cell in or out of scope changes what must be true, so the row takes a new id
under the test above.

## R-CARD — what a card states

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-CARD-1 | A card states its acceptance — what done means — before any work on it starts. | the card's author | the engine, at admission | D2 |
| R-CARD-2 | Each acceptance item states one condition, and a judge can test it without asking the author. | the card's author | a judge, under R-LOOP-6 | D2 |
| R-CARD-3 | The card's author writes the acceptance: the owner for a card the owner files, the decomposing role for a card it produced. | the card's author | the event record, by who first set it | D2 |
| R-CARD-4 | An author writing an acceptance loads the skill the consumer supplies for it. | the role prompt | nothing yet | D2 |
| R-CARD-5 | Only the card's author changes an acceptance after admission. A maker never changes the acceptance it is judged against. | the role prompt | the event record, by who changed it | D2 |
| R-CARD-6 | Rigger records each change to a card's acceptance and who made it, so a later reader can tell that it changed, when, and by whom. | the engine | the event record | D2 |
| R-CARD-7 | A card with no acceptance is refused. Rigger names the card and the reason rather than pulling it. | the engine | the test suite | D2 |
| R-CARD-8 | A card whose acceptance only restates the card's title is refused. Those two are the whole of the check on an acceptance's form. | the engine | the test suite | D2 |
| R-CARD-9 | A spike card's acceptance states what a complete answer contains, never what the answer is. | the card's author | a judge, under R-LOOP-6 | D2 |
| R-CARD-10 | A follow-up card may only cover work outside the filing card's acceptance. An acceptance item left undone means the card is not done, and never becomes a follow-up. | the role prompt | a judge, under R-LOOP-5 | D2 |
| R-CARD-11 | Work found during a card and outside its acceptance becomes its own card, and is not added to the acceptance of the card that found it. | the role prompt | the event record, by an acceptance that grew after admission | D2 |
| R-CARD-12 | Rigger reads a card's acceptance from the source text of the card's body, never from a rendering of it, as follows: | the engine | the test suite | D2 |
| R-CARD-13 | — the body splits into lines at each line feed, and at each carriage return directly followed by a line feed, and nowhere else; | the engine | the test suite | D2 |
| R-CARD-34 | — a space is the character U+0020, and no other character is one; | the engine | the test suite | D2 |
| R-CARD-14 | — a line's indentation is the run of space characters at its start, and what the line opens with is what follows that run; | the engine | the test suite | D2 |
| R-CARD-27 | — a whitespace character is any of U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF; | the engine | the test suite | D2 |
| R-CARD-28 | — text trimmed is that text with every whitespace character at its start and at its end removed; | the engine | the test suite | D2 |
| R-CARD-35 | — a fenced code block opens at a line outside every fenced code block, indented at most three spaces, that opens with a run of three or more backticks or of three or more tildes, its opening run; | the engine | the test suite | D2 |
| R-CARD-26 | — a fenced code block closes at the next line indented at most three spaces that opens with a run of its opening run's character, at least as long as its opening run, then holds only spaces or tabs (U+0009); | the engine | the test suite | D2 |
| R-CARD-17 | — a fenced code block never closed runs to the end of the body; | the engine | the test suite | D2 |
| R-CARD-18 | — every line from a fenced code block's opening line to its closing line is inside it, and no line inside it is an item; | the engine | the test suite | D2 |
| R-CARD-19 | — an ATX heading line is a line outside every fenced code block, indented at most three spaces, that opens with one to six `#`, then a space or the line's end; | the engine | the test suite | D2 |
| R-CARD-20 | — an ATX heading line's level is its count of `#`, and its text is the rest of the line, trimmed, stripped of any closing run of `#`, and trimmed again; | the engine | the test suite | D2 |
| R-CARD-21 | — the acceptance is every item in every section that opens at an ATX heading line whose text is exactly `Acceptance`; | the engine | the test suite | D2 |
| R-CARD-22 | — a section ends at the next ATX heading line of the same level or higher, meaning one with as many `#` or fewer; | the engine | the test suite | D2 |
| R-CARD-36 | — a list marker is one of `-`, `*` or `+`; | the engine | the test suite | D2 |
| R-CARD-23 | — a list line is a line in a section, indented at most three spaces, that opens with a list marker and a space; | the engine | the test suite | D2 |
| R-CARD-24 | — a list line's text is the rest of the line after its list marker and the one space that follows it; | the engine | the test suite | D2 |
| R-CARD-37 | — a task-list line, a list line whose text opens with `[ ]`, `[x]` or `[X]`, is never an item; | the engine | the test suite | D2 |
| R-CARD-38 | — a list line whose text is empty or only whitespace characters is never an item; | the engine | the test suite | D2 |
| R-CARD-39 | — an HTML comment is text running from `<!--` to the first `-->` that starts after that `<!--` ends; | the engine | the test suite | D2 |
| R-CARD-29 | — a list line whose text, trimmed, is one or more HTML comments with only whitespace characters between them is never an item; | the engine | the test suite | D2 |
| R-CARD-30 | — a list line's text never takes in a line below it, even where that line holds the `-->` that closes a `<!--` in the list line's text; | the engine | the test suite | D2 |
| R-CARD-31 | — a list line holding nothing but spaces and three or more of one list marker is never an item; | the engine | the test suite | D2 |
| R-CARD-40 | — every other list line is an item, and an item's text is its list line's text; | the engine | the test suite | D2 |
| R-CARD-32 | — a text's compared form is that text lowercased by Unicode's full default case conversion, final sigma included, stripped of every character in Unicode's punctuation and symbol categories, then with each run of whitespace characters made one space, then trimmed; | the engine | the test suite | D2 |
| R-CARD-33 | — an acceptance only restates the card's title, as `R-CARD-8` uses the phrase, exactly when every item's text has the same compared form as the title. | the engine | the test suite | D2 |

## R-SCHED — what runs, and when

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-SCHED-1 | Rigger pulls ready cards in priority order, so an owner changes what runs next by changing a card's priority. | the engine | the test suite | |
| R-SCHED-2 | How many cards run at once is the consumer's to set, three unless the consumer says otherwise, and Rigger never exceeds it. | the engine | the event record, by overlapping dispatch intervals | |
| R-SCHED-3 | Closing admission stops Rigger pulling new cards. Cards already running finish. | the engine | the event record, by a pull after the hold | |
| R-SCHED-4 | The owner closes admission, and Rigger closes it on a repeated infrastructure failure. Only the owner reopens it, and nothing else closes it. | the engine | the event record, by what raised each change of admission | |
| R-SCHED-5 | A trigger declares whether its work is a card. Work declared a card goes on the board and runs the same loop as any other. Nothing runs without a card unless a trigger declared it, or it is Rigger's own reporting or stale-card sweep. | the engine | the event record, by a dispatch carrying no card its trigger declared | |
| R-SCHED-6 | Rigger starts work on three occasions: a card is ready and a slot is free, nothing is in flight, or a schedule the consumer set comes due. | the engine | the test suite | |
| R-SCHED-7 | When Rigger closes admission itself, it tells the owner without being asked. A stopped engine never waits in silence. | the engine | the test suite | |
| R-SCHED-8 | A trigger missed while Rigger was down fires once when it returns, or not at all, as that trigger's own catch-up setting says. It never fires once for each occurrence missed. | the engine | the event record, by firings after a restart | |
| R-SCHED-10 | Rigger refuses a configuration naming anything it does not offer, and says what it refused. | the config validator | the test suite | |
| R-SCHED-11 | Rigger never pulls a ready card no kind of work selects, never reports it as a card it refused, and leaves it on the board. Work the consumer marked as an epic is selected by no kind, so Rigger never pulls an epic and never reports one as refused. | the engine, and the consumer's configuration for what each kind selects | the test suite | |
| R-SCHED-12 | Rigger never pulls a ready card that two or more kinds of work select. It refuses the card, and the refusal names every kind that selects it, in the order the configuration declares them. | the engine | the test suite | |
| R-SCHED-13 | A kind of work selects a card that carries any one of the labels the consumer's configuration names for that kind, and never selects a card carrying none of them. | the engine | the test suite | |
| R-SCHED-14 | Rigger refuses a configuration in which a kind of work names an empty list of labels to select by, and the refusal names that kind. | the config validator | the test suite | |
| R-SCHED-15 | Rigger never makes two merges at the same moment. Its bound is in `### R-SCHED-15 — Merges Rigger serializes`. | the engine | the event record, by overlapping merge intervals | |
| R-SCHED-16 | A card Rigger has not claimed is a new card under `R-SCHED-3`, whatever its column, under `rigger once` as under `rigger run`. | the engine | the test suite | |
| R-SCHED-17 | `rigger doctor` reports admission as open, as closed with what closed it and why, or as a record it cannot read. A closed admission leaves `doctor`'s exit status as it is, and an unreadable record fails it. | the engine | the test suite | |
| R-SCHED-18 | While admission is closed, or its record cannot be read, `rigger plan` shows no card the next run would pull, and says why. | the engine | the test suite | |
| R-SCHED-19 | Rigger refuses a configuration in which a kind of work selects by a label Rigger fixes, or names one as the epic label, in any letter case, and the refusal names both. A role's or a step's labels are outside this row, since they select nothing on a card Rigger will not work. | the config validator | the test suite | |
| R-SCHED-20 | When Rigger closes admission itself, it opens an issue titled `Rigger closed admission` in the owner's column, carrying the status label Rigger fixes. It opens none where an open issue carrying that label exists. The issue names the reason, the evidence and the card whose failures closed admission. | the engine | the test suite | |
| R-SCHED-27 | Rigger never works an item carrying the status label as a card: it never claims it, dispatches nothing for it, and never reports it as refused. An issue a person or `rigger resume` removes the label from is no longer the status issue. | the engine | the test suite | |
| R-SCHED-22 | The card whose second failure closed admission stays in its column. | the engine | the event record, by that card's transitions while admission is closed | |
| R-SCHED-23 | Admission that Rigger closed reopens when the owner runs `rigger resume` while the admission record can be read, or when the status issue is closed. Any close of the issue but `resume`'s counts as the owner's under `R-SCHED-4`, whoever or whatever made it. Closing the issue never lifts the owner's own `rigger pause`: only `rigger resume` does. Admission reopens on nothing else, except that losing Rigger's state directory leaves it open. Its states are in `### R-SCHED-23 — The status issue and admission`. | the engine | the test suite | |
| R-SCHED-24 | When `rigger resume` reopens admission, it closes every open issue carrying the status label. | the engine | the test suite | |
| R-SCHED-25 | Where an open issue carrying the status label exists when Rigger closes admission, Rigger comments on it, naming the reason and the card whose failures closed admission. | the engine | the test suite | |
| R-SCHED-26 | Before Rigger's lane gives up on a merge because the forge reads the pull request's mergeability as unknown, Rigger reads that mergeability again. It reads again 5 seconds after each read that answers unknown. It gives up only at an unknown read made 60 seconds or more after the first. Its states are in `### R-SCHED-26 — Unknown mergeability at a merge`. | the engine | the test suite | |

### R-SCHED-23 — The status issue and admission

| What closed admission | The status issue | What follows | Scope |
|---|---|---|---|
| Rigger | open | admission stays closed | in |
| Rigger | closed by the owner | admission reopens, and Rigger records the issue's close as what reopened it | in |
| Rigger | closed by another account with write or triage access | admission reopens, as the owner's act | in |
| Rigger | closed by a closing keyword in a merged pull request | admission reopens, as the owner's act | in |
| Rigger | closed by a board workflow, such as "Auto-close issue" | admission reopens, as the owner's act | in |
| Rigger | deleted, transferred to another repository, or never opened | admission stays closed, and Rigger opens another | in |
| Rigger | unreadable, or its read timed out | admission stays closed; Rigger claims nothing, names the issue, and reads again at the next trigger | in |
| Rigger | its opening refused, or timed out | admission stays closed; Rigger names the failure in its output and its event, and tries again at the next trigger | in |
| Rigger | opened, and adding it to the board or setting its column refused | admission stays closed; Rigger names the failure, and places it again at the next trigger | in |
| Rigger | the status label missing from the repository | — | out: these rows hold only where the repository has the status label, however it came to lack it |
| Rigger, then the owner runs `rigger resume` | open | admission reopens, and Rigger closes the issue | in |
| Rigger, then `rigger resume`, whose close of the issue is refused | open | admission reopens; `rigger resume` exits non-zero, naming the issue left open | in |
| Rigger, then `rigger resume` while the admission record cannot be read | open | admission stays closed; `rigger resume` names the record and changes nothing, and the issue stays open | in |
| Rigger, then the owner's `rigger pause` | open | admission stays closed until `rigger resume`; closing the issue alone reopens nothing | in |
| the owner's `rigger pause`, then a card's second failure the same way | opened, naming that card | admission stays closed by the owner; closing the issue reopens nothing; `rigger resume` reopens it and closes the issue | in |
| Rigger, then a second card's hold | open | admission stays closed; Rigger comments on the open issue, naming the second card | in |
| Rigger, and Rigger's state directory then lost | open | admission is open; the issue is stale, and a later hold comments on it, naming the new card | in |
| any, and an issue reopened by a person while admission is open | open | a reopened issue changes nothing while admission is open | in |
| any, and the status label copied onto another issue by a person | open | that issue is never worked, and `rigger resume` closes it too | in |
| the owner's `rigger pause` | none is opened | admission stays closed until `rigger resume` | in |
| any, and a board workflow setting the issue's column after Rigger set Owner | — | — | out: the consumer's board setting |
| any, and a notification beside the issue | — | — | out: optional, M6-11d |

### R-SCHED-15 — Merges Rigger serializes

| Merge | Scope |
|---|---|
| two merges the engine's lane makes | in |
| a person's merge while the lane merges | out: P5. The forge serializes ref updates, and Rigger cannot |
| merges by two engines on one repository | out: `D11`, `R-WORK-4` |

### R-SCHED-26 — Unknown mergeability at a merge

In this table, "not merged" is the outcome Rigger records for the merge's end, `not merged`.

| The lane's reads of the pull request's mergeability, from the first | Scope |
|---|---|
| the first answers mergeable | in: Rigger reads it no more, and the merge goes on |
| the first answers conflicting | in: Rigger reads it no more, and the card's maker continues on it, under `R-CONFLICT-1` |
| unknown, then mergeable at any later read, the last included | in: the merge goes on at the pull request and head Rigger pulled |
| unknown, then conflicting at any later read, the last included | in: the card's maker continues on it, under `R-CONFLICT-1` |
| unknown on every read until one made 60 seconds or more after the first | in: not merged, and the card stays where it is |
| unknown, then a read on which Rigger answers other than a merge for another reason | in: not merged; `R-RECORD-10` names the answer |
| unknown, then a read that fails | in: not merged, and the card stays where it is |
| unknown, then the pull request at another head | in: not merged, and the card stays where it is |
| unknown, then the pull request merged | in: not merged; a later pull reads the merge, under `R-WORK-33` |
| the forge refuses the merge call because the mergeability is unknown | in: Rigger counts the refusal as a read that answers unknown. Where that read is the last, the merge ends `refused`, naming the refusal |
| another merge queued behind this one | in: it waits until this merge ends, under `R-SCHED-15` |
| unknown at a pull, before any merge starts | out: no merge starts, and a later pull reads it again |
| a merge a person makes | out: Rigger makes no merge call |

## R-WORK — isolation and exclusivity

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-WORK-2 | At most one actor mutates a card's board state or its workspace at any moment. | the engine | the event record, by two writers on one card | D11 |
| R-WORK-3 | A card's workspace and its line of work are derivable from the card, so the same card always yields the same ones. The rule that derives them is the consumer's. | the engine | the test suite | |
| R-WORK-4 | One engine at a time has sole control of a repository's board and its workspaces. Two engines never work one repository. | the consumer's configuration | nothing yet | |
| R-WORK-5 | Rigger keeps the board current as a card progresses, because the board is what a restart reads. | the engine | the event record, by a transition the board never received | D1 |
| R-WORK-6 | A card's work is delivered as a change a judge can read and rule on before it lands, never as a change already in place. | the engine | the repository's history, against the record | |
| R-WORK-7 | Rigger works the board the consumer's configuration names, and no other, whichever user or organisation owns it. | the engine | the test suite | |
| R-WORK-8 | Two engines never share one board. A board Rigger works holds no issue or pull request of any repository but the one Rigger works, whether or not an engine works that other repository. | the consumer's configuration | `rigger doctor`, by an issue or pull request of another repository on the board | |
| R-WORK-9 | Rigger refuses a configuration whose rule could derive one workspace, or one line of work, for two different cards. The refusal names the rule. | the config validator | the test suite | |
| R-WORK-10 | An attempt that starts a card's work from the beginning runs in a workspace holding the repository's main line as the forge held it when the workspace was made. That workspace holds nothing an earlier attempt left. | the engine | the test suite | D1 |
| R-WORK-12 | No two dispatches use one workspace at once, whether they work one card or two. | the engine | the event record, by two dispatches naming one workspace over overlapping intervals | |
| R-WORK-13 | Where a directory is at a card's workspace path and any condition below does not hold, Rigger fails the attempt, names the path, and changes nothing. Rigger replaces that directory only when all of these hold: | the engine | the test suite | |
| R-WORK-14 | — the directory is a worktree added to the repository Rigger works, and not that repository's main worktree, the one its added worktrees belong to; | the engine | the test suite | |
| R-WORK-15 | — the line of work the worktree holds is exactly the card's; | the engine | the test suite | |
| R-WORK-16 | — it is not the worktree Rigger was handed as the repository, whatever line of work that worktree holds; | the engine | the test suite | |
| R-WORK-17 | — no other worktree of the repository, the handed one included, lies inside it. | the engine | the test suite | |
| R-WORK-18 | Rigger moves a card to review only once its maker has exited successfully and the forge holds an open pull request from the card's line of work. A maker that exits successfully with no such pull request leaves the card where it was, and Rigger names the card and why. | the engine | the test suite | |
| R-WORK-19 | Rigger never starts a card's work from the beginning while the forge holds the card's line of work, or a merged pull request from it. It refuses the card, naming it and what the forge holds. | the engine | the test suite | D10 |
| R-WORK-20 | Where a directory is at the path of the directory Rigger makes for a judge's dispatch, and any condition below does not hold, Rigger dispatches no judge there, names the path, and changes nothing. Rigger replaces that directory only when all of these hold: | the engine | the test suite | |
| R-WORK-21 | — everything in it is a worktree added to the repository Rigger works, each at a detached commit; | the engine | the test suite | |
| R-WORK-22 | — none of them is the worktree Rigger was handed as the repository; | the engine | the test suite | |
| R-WORK-23 | — no other worktree of the repository lies inside it. | the engine | the test suite | |
| R-WORK-24 | Rigger does a card in review again from the beginning where the forge holds no pull request from the card's line of work, open or merged, and not the line of work itself. The card shows coding while it is done again. | the engine | the test suite | D1 |
| R-WORK-25 | An attempt that continues a card's work, rather than starting it from the beginning, runs in a workspace holding the card's line of work as the forge held it when the workspace was made. That workspace holds nothing an earlier attempt left that the forge does not hold. The states it covers are in `### R-WORK-25 — Continuing workspace states`. | the engine | the test suite | |
| R-WORK-26 | Where a directory is at the path of a role's scratch directory for a card, and any condition below does not hold, Rigger dispatches no role with that directory, names the path, and changes nothing. Rigger replaces that directory only when all of these hold: | the engine | the test suite | |
| R-WORK-27 | — it is a directory and not a symbolic link, and so are the card's directory above it and the directory named `scratch` under the worktree root; | the engine | the test suite | |
| R-WORK-28 | — it lies in no git checkout, and no git checkout lies in it; | the engine | the test suite | |
| R-WORK-29 | — it is no worktree of the repository Rigger works, lies in none, and holds none. | the engine | the test suite | |
| R-WORK-31 | A session Rigger dispatches leaves no file of its own outside its dispatch's directory and its scratch directory, read on real paths once the session's process has ended. Its bound is in `### R-WORK-31 — Where a dispatched session's files land`. | the engine | the test suite | |
| R-WORK-32 | Where a directory is at the path Rigger makes for the dispatch of a role an escalation goes to, Rigger replaces it only when `R-WORK-21` to `R-WORK-23` all hold of it. Otherwise Rigger dispatches no role there, names the path, and changes nothing. | the engine | the test suite | |
| R-WORK-33 | Before Rigger moves a card to Done for its merged pull request, whoever merged it, Rigger removes the card's directories. They are its workspace and each directory under `judges/<topic>`, `escalations/<topic>` and `scratch/<topic>` for the card's topic, whichever role it is named for. Rigger removes each only where `R-WORK-13`, `R-WORK-20`, `R-WORK-26` or `R-WORK-32` lets Rigger replace it, and otherwise names the path and leaves it. Rigger moves the card to Done only once no removal failed, and a path left under those rows is no failure. Where a removal failed, the card stays where it is, and Rigger names each path that remains. The states it covers are in `### R-WORK-33 — When a merged card's directories are removed`. | the engine | the test suite | |
| R-WORK-34 | After an attempt that continues a card's work, where the maker exits successfully, Rigger moves the card to review and decides its judges only at the head the maker left. That head is the commit at the tip of the card's line of work in its workspace when the maker exits. Rigger reads the card's pull request again 5 seconds after each read showing another head, until a read made 60 seconds or more after the first. Where no read shows the head the maker left, the card stays in coding. Rigger then names the card, the head the maker left, and the head the forge last showed. Its states are in `### R-WORK-34 — The head a continuing attempt is judged at`. | the engine | the test suite | |

### R-WORK-25 — Continuing workspace states

| What is at the workspace path | Line of work on the forge | Scope |
|---|---|---|
| nothing | at the head L2 read | in |
| the card's earlier worktree, clean | at the head | in |
| the card's earlier worktree, with uncommitted changes | at the head | in: none remains |
| the card's earlier worktree, with untracked and ignored files | at the head | in: none remains |
| the card's earlier worktree, with local commits not on the forge | at the head | in: none remains |
| nothing, but a local branch of the card's name holds commits not on the forge | at the head | in: none remains |
| any | force-moved, so the earlier worktree's commits are not its ancestors | in: the workspace holds the forge's tip |
| any | moved since L2 read the head | in: refused, naming both SHAs; nothing changed |
| a worktree on another line of work, or a detached `HEAD` | any | in: refused under `R-WORK-13`; path named; nothing changed |
| a directory `R-WORK-13` refuses | any | in: refused; path named; nothing changed |
| the card's branch checked out in a worktree elsewhere | at the head | in: refused, naming that worktree |
| any | deleted after L2 read it | in: refused, naming it |
| any | the fetch fails, or times out | in: refused as an environment failure, path named |
| any | deleted before L2 read it | out: the forge closes the pull request, and `R-WORK-24` answers a start from the beginning |

### R-WORK-33 — When a merged card's directories are removed

| Situation | Scope |
|---|---|
| a merge the engine's lane makes, answered merged or already merged | in: removed before the Done move |
| a merge the engine's lane makes, answered refused or not merged | in: nothing removed; removed once a later pull reads the pull request as merged |
| a merge the engine's lane makes that fails | in: nothing removed; removed once a later pull reads the pull request as merged |
| Rigger cannot record the end of a merge the engine's lane makes | in: nothing removed; removed once a later pull reads the merge |
| merged by a person while the engine runs, or while it is stopped | in: removed at the next pull that reads the merge |
| the engine killed between the merge and the removal | in: the card stays where it is; removed at a later pull that reads the merge |
| a removal failing after another of the card's directories was removed | in: the card stays where it is; each remaining path named; a later pull removes them |
| a removal failing partway through one directory | in: the card stays where it is; the path named; a later pull removes it where its row still lets Rigger replace it, and otherwise leaves and names it |
| a check `R-WORK-13`, `R-WORK-20`, `R-WORK-26` or `R-WORK-32` asks for that Rigger cannot make, because git or the file system gives no answer to it, or does not answer in time | in: a failed removal, not a refusal: the path left and named; the card stays where it is; a later pull removes again |
| a check `R-WORK-13`, `R-WORK-20`, `R-WORK-26` or `R-WORK-32` asks for that git or the file system answers, finding that the condition does not hold | in: a refusal: the path left and named; it does not hold back the Done move |
| a workspace directory whose `.git` entry is still there after git dropped its registration, as a removal failing partway leaves it | in: a refusal under `R-WORK-13`: the path left and named; it does not hold back the Done move |
| Rigger cannot record an event of the removal | in: the card stays where it is; Rigger says what went unrecorded; a later pull removes again |
| a second removal pass over a card already removed | in: nothing changes, and nothing fails |
| none of the card's directories exists | in: nothing changes, and nothing fails |
| a directory of the card already gone, with or without its registration | in: nothing fails; git then lists no registration of the card's whose directory is gone, unless a person locked it |
| a worktree of the card's that a person locked | in: left as it is, its lock kept, and named; the card stays where it is until the lock is lifted |
| a person moved the card to Done before Rigger read the merge | out: Rigger reads no Done card, and its directories stay |
| a Ready or Coding card whose pull request is merged | out: Rigger refuses it under `R-WORK-19`, and its directories stay |
| a pull request closed without merging | in: nothing removed |
| a dispatch of the card by a judge, or by a role an escalation goes to, still running when its pull request merges | in: removed at the first pull that reads the merge once no dispatch of the card runs |
| a process Rigger did not start working in a directory | out: removal proceeds, as it does when Rigger replaces the directory |
| a process Rigger started and could not end, working in a directory | out: removal proceeds, as for a process Rigger did not start |
| a workspace with uncommitted changes or commits not on the forge | in: removed, as `R-WORK-13` replaces it |
| a workspace path named through a symbolic link to the card's worktree, or anything else `R-WORK-13` refuses | in: as `R-WORK-13` answers it: the worktree and the link removed, or the path left and named |
| a symbolic link at the path of a judge's directory, of a scratch directory, or of the directory of a role an escalation goes to, or anything else `R-WORK-20`, `R-WORK-26` or `R-WORK-32` refuses | in: left and named |
| `judges/<topic>`, `escalations/<topic>` and `scratch/<topic>`, once empty | in: removed where each is a directory and not a symbolic link, and so is `judges`, `escalations` or `scratch` above it; otherwise left and named |
| the card's local branch | out: kept |
| output an agent CLI other than Claude Code writes outside the scratch base | out: until that adapter's spike measures it. Claude Code's lies under the dispatch's directory |

### R-WORK-31 — Where a dispatched session's files land

Claude Code's configuration home is `~/.claude` unless the consumer moves it. Each row below writes that home as `<home>`, and names each path under it from there. Each in-scope row holds for a maker in its workspace, for a judge in its `main` reaching `head`, and for a role dispatched to answer an escalation.

| What the session writes | Agent CLI | Scope |
|---|---|---|
| a tool result too large to return inline, from `Bash`, `Read` or a tool of the directory's own MCP server | Claude Code | in |
| its transcript under `<home>/projects/`, in the entry for the directory the session runs in | Claude Code | in |
| files under `/tmp/claude-<uid>/` named for the directory the session runs in | Claude Code | in |
| a background task's output | Claude Code | in |
| any other path under `<home>` that a session creates or changes | Claude Code | in |
| the automatic memory under the session's entry in `<home>/projects/` | Claude Code | out: Rigger dispatches no session with automatic memory |
| `<home>/session-env/<session id>/` | Claude Code | out: until a card measures a route that confines it |
| a file under `<home>`, or `~/.claude.json` beside it, that every session shares and no session id or directory names, of which `~/.claude.json`, `<home>/backups/`, `<home>/history.jsonl`, `<home>/.last-cleanup` and `<home>/.last-update-result.json` are instances | Claude Code | out: no test can attribute a write to it while other sessions run |
| a file a command the agent runs writes, rather than the agent CLI itself, such as `npm`'s cache | any | out: the command's own behaviour, outside the adapter |
| a write through a symbolic link inside the dispatch's directory to a target outside it | any | out: the link is the work's, and Rigger cannot confine where it points |
| anything a session that persists writes | Claude Code | out: Rigger dispatches no session that persists |
| output from `WebFetch` or `WebSearch` | Claude Code | out: no live run here reaches the public web |
| output from `Grep`, `Glob`, the agent tool or `Workflow` | Claude Code | out: Rigger does not offer them |
| `Edit`, `Write` or `NotebookEdit` | Claude Code | out: they return no command or file output |
| what a session killed at its timeout writes | Claude Code | out: the file's place is fixed before the session ends, a judgment |
| anything | Codex | out: no claiming card yet; the home Codex keeps for the dispatch, written `<Codex home>`, lies under its scratch directory, and its linked `<Codex home>/auth.json` (#646) is the known path outside |
| anything | a Claude Code version other than the one the claiming test names | out |

### R-WORK-34 — The head a continuing attempt is judged at

| The maker | What Rigger reads after the maker exits | Scope |
|---|---|---|
| exits successfully | the pull request at the head the maker left, at the first read | in: moved to review; judges decided at that head |
| exits successfully, having added no commit to the line of work | the pull request at the head the attempt started from, which is the head the maker left | in: moved to review; judges decided at that head |
| exits successfully | the pull request at another head, then at the head the maker left at any later read, the last included | in: moved to review; judges decided at the head the maker left |
| exits successfully | the pull request at another head on every read until one made 60 seconds or more after the first | in: stays in coding; Rigger names the card and both heads |
| exits successfully | no tip of the card's line of work Rigger can read in its workspace | in: stays in coding; Rigger names the card and why |
| exits successfully | no open pull request from the card's line of work, or more than one | in: stays in coding, under `R-WORK-18` |
| exits successfully | a read of the card's pull requests that fails | in: stays in coding; Rigger names the card and the read |
| exits unsuccessfully, or never starts | nothing | out: the forge is not read, and the card stays in coding |
| starts the card's work from the beginning | any | out: `R-WORK-18` alone governs it |

## R-LOOP — maker, judges, and rounds

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-LOOP-1 | The maker finishes against the acceptance, not against its own reading of the card. | the role prompt | a judge, under R-LOOP-5 | D2 |
| R-LOOP-2 | A maker that cannot meet an acceptance item escalates the card as ambiguous, naming the item. It never closes the card. | the role prompt | the event record, by a card closed by its maker | D2, D3 |
| R-LOOP-3 | No judge is the maker, and no configuration removes that separation. | the engine | the config validator | D6 |
| R-LOOP-4 | No judge is given another judge's verdict, and no judge is given the maker's session. | the engine | the event record, by what each dispatch carried | D6, D9 |
| R-LOOP-5 | Every judge rules on every acceptance item, recording each as met or unmet. | the role prompt | the gate, for omitted items only | D2 |
| R-LOOP-6 | Every judge rules on whether the acceptance covered what the card asked. A judge finding it did not returns the card to its author with the reason, and never rewrites the acceptance. | the role prompt, and the engine for the return | the gate, for an omitted coverage ruling | D2 |
| R-LOOP-7 | The agent judges for a card rule without waiting for each other. | the engine | the event record, by overlapping judge dispatches | D6 |
| R-LOOP-8 | A change to the work, or to the acceptance, sends every judge back. Either spends one round. | the engine | the event record, by rounds against changes | D2, D3 |
| R-LOOP-9 | A disagreement is bounded. The consumer sets how many rounds each kind of work gets, three unless the consumer says otherwise. Exhausting them escalates the card as ambiguous. | the engine | the event record, by rounds against the configured bound | D3, D4 |
| R-LOOP-10 | No role settles a disagreement between a maker and a judge. | the consumer's configuration | the config validator | D4 |
| R-LOOP-11 | The owner, when named as a judge, judges last and is asked only once every agent judge is satisfied. The owner is never dispatched. | the engine | the event record, by a dispatch naming the owner | D3 |
| R-LOOP-12 | A role runs at the tier the consumer declares for it, unless the card carries a label the consumer declares as selecting another tier for that role. The role then runs at the tier that label selects. | the engine | the event record, by the tier each dispatch names | |
| R-LOOP-13 | Rigger never dispatches a role for a card carrying two or more labels that select different tiers for that role. It refuses the card, and the refusal names the role and every such label. | the engine | the test suite | |
| R-LOOP-14 | A judge takes its role's instructions, and every setting and tool declaration its agent loads, from the repository's main line as the forge held it when Rigger made the judge's directory. It never takes them from the work it judges. | the engine | the test suite | D6 |
| R-LOOP-15 | A role's dispatch runs no longer than the consumer allows that role, four hours unless the consumer says otherwise. A dispatch that runs past its time has failed. | the engine | the test suite | |
| R-LOOP-16 | A role runs on the provider the consumer declares for it, unless a card label the consumer declares selects another provider for that role. Rigger refuses a card carrying two labels that select different providers for one role, naming the role and each label. | the engine | the test suite | D24 |
| R-LOOP-17 | An agent judge whose entry carries a provider rule runs on the provider that rule gives: the fixed provider, or the one the rule names for the provider its maker runs on. | the engine | the test suite | D24 |
| R-LOOP-18 | Rigger dispatches no maker again, in the invocation that ran it, for a card whose maker ran, exited non-zero, and left the forge holding nothing of the card's line of work. The next invocation dispatches the card as it would any other. | the engine | the test suite | |

## R-EVIDENCE — what a judge is given

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-EVIDENCE-1 | Rigger gives a judge the facts of the work it is ruling on, so that the judge does not go and find them itself. | the engine | the event record, by what each judge was given | D9 |
| R-EVIDENCE-2 | A judge may look beyond what it was given. What it is given is a floor, never a limit. | the engine | the test suite | D9 |
| R-EVIDENCE-3 | What a judge is given identifies the card, its acceptance, the work under review, and what that work changed. On a second or later round it also identifies what changed since the round before. | the engine | the event record, by what each judge was given | D9 |
| R-EVIDENCE-4 | What a judge is given carries no other judge's findings or verdict, and no part of the maker's session. | the engine | the event record, by what each judge was given | D9, D6 |
| R-EVIDENCE-5 | Rigger records what each judge was given, so a later reader can tell whether two judges ruled on the same thing. | the engine | the event record | D9 |
| R-EVIDENCE-6 | Rigger gives a judge the work it judges as the pull request's head, provisioned by the steps the card's kind selects, in a directory apart from where the judge's instructions are read. | the engine | the test suite | D9 |

## R-VERDICT — what a judge returns

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-VERDICT-1 | A verdict takes one of a set of values Rigger fixes. A consumer chooses none of them and adds none. | the engine | the gate | |
| R-VERDICT-2 | The set holds exactly three: the work is sound, the work needs revision, and the work has a fault that must not merge. | the engine | the test suite | |
| R-VERDICT-3 | A verdict that is not sound names what would make it sound. | the role prompt | the gate | |
| R-VERDICT-4 | A verdict leaving an acceptance item unmet is not sound. | the role prompt | the gate | D2 |
| R-VERDICT-5 | A verdict is bound to the work it ruled on and to the acceptance it ruled against, so a later reader can tell what it covered. | the engine | the event record, by what each verdict names | D2 |
| R-VERDICT-6 | A judge returns critical, the verdict for a fault that must not merge, only where no maker revision could resolve that fault without an owner decision. A fault a maker revision could resolve is needs revision. | the role prompt | nothing yet | D14 |
| R-VERDICT-7 | An agent judge's verdict names the provider it ran on. | the engine, through the judge's instruction | the event record, by the provider each marker.read event names | D24 |
| R-VERDICT-8 | `rigger verdict` posts the owner's verdict on a pull request, in the form the gate rule reads as an owner's marker. The verdict rules on every acceptance item and on coverage, against the head and the acceptance standing when the owner runs it. | the engine | the test suite | D25 |
| R-VERDICT-9 | `rigger verdict` shows the owner the whole verdict, with each acceptance item beside its ruling, and posts it only once the owner confirms it. No argument or setting skips that confirmation. | the engine | the test suite | D25 |
| R-VERDICT-10 | `rigger verdict` asks for that confirmation on a terminal at its standard input, and posts nothing where its standard input is no terminal. Its edges are in `### R-VERDICT-10 — Who can confirm the owner's verdict`. | the engine | the test suite | D25 |
| R-VERDICT-11 | Nothing Rigger dispatches or runs, with the standard input Rigger started it with, posts the owner's verdict through `rigger verdict`. Rigger never runs that verb itself. A process under a dispatch that opens a terminal of its own lies outside this row (`D25` rule 2). | the engine | the test suite | D25 |
| R-VERDICT-12 | `rigger verdict` posts each verdict as one new comment, at most once for each confirmation. It never edits or deletes a comment on the forge. | the engine | the test suite | D25 |
| R-VERDICT-13 | `rigger verdict` posts nothing, and names the reason, where the owner's input or the forge's state cannot make a verdict the gate reads at the pull request's head. The cases are in `### R-VERDICT-13 — When the owner's verdict is posted`. | the engine | the test suite | D25 |

### R-VERDICT-10 — Who can confirm the owner's verdict

| Who runs the verb | Its standard input | What follows | Scope |
|---|---|---|---|
| the owner, at a shell in a terminal | that terminal | the verb shows the verdict, asks, and posts it once the owner confirms | in |
| the owner, with standard input from a file or a pipe | no terminal | the verb posts nothing, and says it has no terminal to ask on | in |
| a job a scheduler starts, such as launchd or cron | no terminal | the verb posts nothing, and says it has no terminal to ask on | in |
| a role Rigger dispatched, or a process under it, with the standard input Rigger started it with | no terminal | the verb posts nothing, and says it has no terminal to ask on | in |
| a provisioning step Rigger runs, or a process under it, with the standard input Rigger started it with | no terminal | the verb posts nothing, and says it has no terminal to ask on | in |
| a process under a Rigger dispatch that opens a terminal of its own | that terminal | — | out: `D25` rule 2 |
| an agent session the owner started, which Rigger did not dispatch, running the verb with its tool's standard input | no terminal | the verb posts nothing, and says it has no terminal to ask on | in |
| that agent session opening a terminal of its own and running the verb there | that terminal | — | out: `D25` rule 2 |
| an agent session the owner started, which Rigger did not dispatch, handed the owner's terminal | that terminal | — | out: `D25` rule 2, and the question still appears on the owner's terminal |
| any process posting a verdict with `gh` itself | — | — | out: `D25` rule 2 |

### R-VERDICT-13 — When the owner's verdict is posted

| Case | What follows | Scope |
|---|---|---|
| a sound verdict ruling an item unmet | nothing posted, naming `R-VERDICT-4` | in |
| a sound verdict given a line naming what would make it sound | nothing posted | in |
| a verdict other than sound given no line naming what would make it sound | nothing posted, naming `R-VERDICT-3` | in |
| that line, or the reason for an insufficient coverage ruling, empty or holding a line break | nothing posted | in |
| an insufficient coverage ruling given no reason | nothing posted | in |
| a verdict outside the three `R-VERDICT-2` fixes | nothing posted | in |
| a ruling on an item number the acceptance does not hold, or on one item twice | nothing posted | in |
| no consumer config in the directory the verb runs in | nothing posted, naming the missing config | in |
| a consumer config there that Rigger refuses | nothing posted, naming the refusal | in |
| that config naming a repository other than the one the default branch's config names | nothing posted, naming both | in |
| no pull request at the number given, or one closed or merged | nothing posted | in |
| a pull request whose head is in another repository | nothing posted | in |
| a pull request whose branch names no card, or names a number that is no issue | nothing posted | in |
| a card whose acceptance holds no item the form check counts (`R-CARD-7`) | nothing posted | in |
| a read of the forge failing | nothing posted, naming the read | in |
| the head or the acceptance changed between the verb showing the verdict and posting it | nothing posted, naming the change | in |
| the post failing | the verb says the post failed, and posts no second time | in |
| a card whose kind names no owner judge | posted, as on any other card | in |
| a card no kind selects, or one carrying the epic label | posted, as on any other card | in |
| an owner's verdict already posted at the same head and acceptance | posted as a new verdict, leaving the earlier one as it was | in |
| the head or the acceptance changed after the verb last read them, before its comment landed | — | out: `R-GATE-7` |
| the Rigger the gate or the self-hosting check runs reading the card's acceptance differently from the Rigger the owner installed | — | out: `ARCHITECTURE.md`'s "The gate", `AGENTS.md`'s "Self-hosting" and `D25` rule 7 |
| an owner's account without write access to the repository | — | out: `ARCHITECTURE.md`'s "The gate" |

## R-GATE — what admits a merge

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-GATE-1 | Work reaches the repository's main line only by passing the gate, whatever started the attempt and whoever started it. | the gate | the repository's history, against the record | |
| R-GATE-2 | The gate fails closed. Evidence that is missing, unreadable or stale refuses the attempt. | the gate | the test suite | |
| R-GATE-3 | The gate exercises no judgement and takes no instruction. Nothing a role says changes what it admits. | the gate | the test suite | |
| R-GATE-4 | The gate admits an attempt only on positive evidence. All of these hold, or it refuses: | the gate | the test suite | |
| R-GATE-5 | — every configured judge has returned a verdict; | the gate | the test suite | |
| R-GATE-6 | — every one of those verdicts is sound; | the gate | the test suite | |
| R-GATE-7 | — every one of those verdicts ruled on the work now being merged, and against the card's current acceptance; | the gate | the test suite | D2 |
| R-GATE-8 | — the consumer's own checks have passed; | the gate | the test suite | |
| R-GATE-9 | — every configured agent judge's verdict names the provider the configuration requires of that judge for the card, and the owner's verdict names none. | the gate | the test suite | D24 |

## R-ESCALATE — where an escalation goes

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-ESCALATE-4 | A maker or the loop raises an escalation. A judge does not; a judge returns a verdict. | the engine | the event record, by what raised each escalation | D3 |
| R-ESCALATE-5 | A kind of work naming the owner as its last judge is the loop running, not an escalation. | the engine | the event record, by owner dispatches against escalations | D3 |
| R-ESCALATE-6 | When a judge returns a fault that must not merge, the loop escalates the card in that category rather than spending its rounds. | the engine | the event record, by the category on each escalation | D3 |
| R-ESCALATE-7 | An escalation carries the card, the reason it escalated, and the work as it stands. | the engine | the event record, by what each escalation carried | D3 |
| R-ESCALATE-8 | A card Rigger escalates to the owner moves to the owner's column and carries the escalation label, a label Rigger fixes. | the engine | the test suite | D3 |
| R-ESCALATE-9 | Rigger posts each escalation to the owner as a comment on the card's issue, carrying what `R-ESCALATE-7` lists, and never leaves the escalation label on a card without that comment. A retried escalation may post the comment again, each copy naming the same category and reason. Its edges are in `### R-ESCALATE-9 — An escalation partly written`. | the engine | the test suite | D3 |
| R-ESCALATE-10 | Rigger dispatches nothing for a card carrying the escalation label, in any column, and escalates it no further, whoever added the label. A card whose pull request the forge holds as merged is the exception, which `R-WORK-33` answers. `rigger plan` names a labelled card as escalated, never as refused. | the engine | the test suite | D3 |
| R-ESCALATE-11 | Rigger reads an escalation as answered once the escalation label is gone from the card, and never removes that label itself. | the engine | the test suite | D3 |
| R-ESCALATE-12 | Rigger escalates a card to the owner as ambiguous, naming the refusal, where it refuses the card for what its workspace, a judge's directory, a scratch directory or the forge's hold on its line of work shows. It escalates at the attempt or pull where the refusal happens, with no second attempt. The refusals are the card-local rows of `### R-FAIL-7 — Environment failures and the hold`. | the engine | the test suite | D3 |
| R-ESCALATE-13 | The set of categories is Rigger's, and a consumer adds none. A consumer may name each category's destination, the owner or one of its roles. Its bound is in `### R-ESCALATE-13 — Escalation destinations`. | the engine | the config validator, for the destinations it refuses | D3, D26 |
| R-ESCALATE-14 | Rigger refuses a configuration naming a role as the destination of a recorded-decision change or of critical, and the refusal names the category. | the config validator | the test suite | D14, D26 |
| R-ESCALATE-15 | Only an ambiguous escalation a maker raises goes to a role, where its category's destination is a role. Rigger sends every escalation the loop raises to the owner, whatever its configured destination. | the engine | the test suite | D26 |
| R-ESCALATE-16 | A card already sent to a role, as its issue shows, goes to the owner when it escalates as ambiguous again. A card whose issue no longer shows it, because a person deleted that record, may go to a role again. | the engine | the test suite | D26 |
| R-ESCALATE-17 | A card whose kind names, as its maker or as one of its judges, the role its ambiguous escalation would go to goes to the owner instead. | the engine | the test suite | D26 |
| R-ESCALATE-18 | Rigger hands a role an escalation goes to the card, its acceptance and the maker's reason, and hands it no judge's verdict. What the maker's reason quotes, and what the role reads through the forge itself, are outside this row. | the engine | the event record, by what each dispatch carried | D26, D18 |
| R-ESCALATE-19 | The set holds exactly three: a change to a recorded decision, a fault that must not merge — the same fault a verdict names — and an ambiguity neither the maker nor its judges could resolve. | the engine | the test suite | D3 |
| R-ESCALATE-20 | Every escalation is one of Rigger's categories. A card escalated to the owner proceeds no further until the owner answers it. A card whose pull request the forge holds as merged is the exception, which `R-WORK-33` answers. | the engine | the event record, by the category on each escalation | D3 |
| R-ESCALATE-22 | A category given no destination goes to the owner. | the engine | the test suite | D3, D26 |
| R-ESCALATE-23 | While a role works on a card, the card keeps its column and carries no escalation label. | the engine | the test suite | D26 |
| R-ESCALATE-21 | Rigger sends a card to the owner, after it went to a role, where any one of these holds: | the engine | the test suite | D26 |
| R-ESCALATE-24 | — the role writes an escalation note of its own, in any category; | the engine | the test suite | D26 |
| R-ESCALATE-25 | — the role exits non-zero; | the engine | the test suite | D26 |
| R-ESCALATE-26 | — the role's dispatch fails to start twice. A role's dispatch that fails to start never closes admission. | the engine | the test suite | D26 |

### R-ESCALATE-9 — An escalation partly written

| What the forge refused | What the board then shows | What follows | Scope |
|---|---|---|---|
| nothing, on the card's first escalation | the card in the owner's column, labelled, with one comment | — | in |
| nothing, on an escalation retried after a refused move or label | the card in the owner's column, labelled, with one copy of the comment for each invocation that posted it, each naming the same category and reason | — | in |
| the comment | nothing changed | a later invocation escalates the card again | in |
| the move, after the comment | the comment, the card in its column, no label | a later invocation escalates again, and the comment may repeat | in |
| the label, after the comment and the move | the comment, the card in the owner's column, no label | a later invocation escalates again, and the comment may repeat | in |

### R-ESCALATE-13 — Escalation destinations

| What the configuration says | What Rigger does | Scope |
|---|---|---|
| no `escalate` key | every category goes to the owner | in |
| a category's key absent | that category goes to the owner | in |
| a category's destination `owner` | it goes to the owner | in |
| `ambiguous` to a declared role | a maker-raised ambiguity goes to that role; every other goes to the owner | in |
| `ambiguous` to the kind's maker or one of its judges | the card goes to the owner | in |
| `critical` or `recorded-decision` to a declared role | refused, naming the category | in |
| any category to a role the configuration does not declare | refused, naming the role | in |
| any category to a value that is not a string | refused, naming the category | in |
| a key that is no category | refused, naming the key | in |
| `escalate` as a list of categories | refused, naming the key | in |

## R-STATE — what survives a restart

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-STATE-1 | The board is the truth for a card's workflow state. Rigger persists no card workflow state of its own. | the engine | the test suite | D1 |
| R-STATE-2 | A restart loses no card and completes no partial one. A card interrupted mid-flight is done again from the beginning, except where `R-WORK-19` refuses to start that card's work again. | the engine | the test suite | D1, D10 |
| R-STATE-3 | A card done again after an interruption is distinguishable afterwards from one done at the first attempt. | the engine | the event record | D1 |
| R-STATE-4 | Rigger persists only what it cannot rebuild from the board: whether admission is open and why it closed, the processes it must still clean up, and the record. Each survives a restart. | the engine | the test suite | D1 |
| R-STATE-17 | A process works in a directory when its working directory is that directory or lies under it. A process outside every process group Rigger created, and working in no directory Rigger made for a dispatch, is outside this rule. Except as `R-STATE-19` allows, Rigger ends every process in a process group it created, and every process of its own user working in a dispatch's directory, whenever any of these holds: | the engine | the test suite | |
| R-STATE-7 | — the command Rigger ran in that group returns; | the engine | the test suite | |
| R-STATE-8 | — that command runs past its time; | the engine | the test suite | |
| R-STATE-9 | — Rigger itself exits, unless it is killed outright: ended by a signal that no process can catch or that Rigger cannot safely handle, by an abort, or by a fatal runtime error. | the engine | the test suite | |
| R-STATE-19 | Where Rigger cannot end a process `R-STATE-17` or `R-STATE-10` obliges it to end, it records the process by name and command line as not ended, and waits on it no further. That holds only where Rigger may not signal the process, or where the process outlives Rigger's kill for a bound Rigger sets. Except as `R-STATE-26` allows, where Rigger cannot read which processes a group or a dispatch's directory held, it records that group or directory in their place, and waits on it no further. | the engine | the test suite | |
| R-STATE-10 | If Rigger is itself killed outright, its next start ends what remains of each dispatch whose process group it recorded, except as `R-STATE-11` and `R-STATE-19` allow. | the engine | the test suite | |
| R-STATE-11 | A start that cannot read its record of process groups ends nothing, starts no work, and names the record. A start that cannot tell whether a recorded group is still the one Rigger recorded ends nothing in it, starts no work, and names the group. A later start ends such a group only once it confirms the group is still Rigger's. | the engine | the test suite | |
| R-STATE-12 | Except as `R-STATE-26` allows, Rigger records every process it had to end by force. Where it cannot read which processes a group held, it records the group it ended in their place. | the engine | the event record, by the kill events it holds | |
| R-STATE-13 | Where Rigger ends without having settled which repository it serves, it reports each process it ended by force on standard error instead of recording it, except as `R-STATE-26` allows. It writes nothing under its target. | the engine | standard error, by the forced ends a Rigger that never settled its repository reports there | |
| R-STATE-26 | Rigger's record of forced ends holds only what its reads of the process table can show. Before Rigger kills a process group, its reads may list none of the group's processes for as long as it reads while the system still reports the group present. Rigger then cannot read which processes the group held, as `R-STATE-12` and `R-STATE-19` put it. After the kill, a read shows the processes it lists, because a process Rigger killed can still be reported present while it exits. A process that no read of its group or of a dispatch's directory showed, while those reads showed which processes the group or directory held, is outside `R-STATE-12`, `R-STATE-13` and `R-STATE-19`, and Rigger need not record it. | the engine | the test suite | |
| R-STATE-14 | A command's result is its exit code and what reached its output until Rigger stopped reading that output. | the engine | the test suite | |
| R-STATE-15 | A command that returns on its own gives its result's exit code, and no process that outlives it changes that code. | the engine | the test suite | |
| R-STATE-16 | A command that Rigger ended at its time has a result that never reads as success, whatever it exited with. The same holds for a command whose ending Rigger saw was by a signal. | the engine | the test suite | |
| R-STATE-18 | Rigger leaves no process stopped that it stopped, whether or not the process is still in a process group Rigger created. This holds unless Rigger is killed outright, as `R-STATE-9` defines it. | the engine | the test suite | |

## R-FAIL — infrastructure failure

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-FAIL-1 | Work that failed before the maker ran its first command is tried again rather than judged. Nothing about the work has been shown. | the engine | the event record, by whether a maker emitted anything | D12 |
| R-FAIL-2 | An infrastructure failure dispatches no maker, and the card is tried once more. | the engine | the event record, by attempts against starts | D12 |
| R-FAIL-4 | An infrastructure failure never escalates to the owner as a fault in the work. | the engine | the event record, by the category on each escalation | D3, D12 |
| R-FAIL-7 | Rigger closes admission, and records why, when a card's second attempt fails in its environment the same way its first did. The ways are in `### R-FAIL-7 — Environment failures and the hold`. | the engine | the event record, by failures counted against the hold | D12 |

### R-FAIL-7 — Environment failures and the hold

Each failure is one of three classes:

- **a host failure:** a second attempt that fails the same way closes admission;
- **card-local:** it escalates under `R-ESCALATE-12` at once, and an attempt pair that includes one escalates rather than stops;
- **out:** neither.

| Failure | Class | The same way when | Scope |
|---|---|---|---|
| the workspace not made, because git or the file system gave no answer, or none in time | host | always | in |
| a continuing workspace's fetch failing or timing out (`R-WORK-25`) | host | always | in |
| a required provisioning step that never started | host | it is the same step | in |
| a required step that exited non-zero or ran past its time | host | it is the same step | in |
| the maker's dispatch never started, its scratch directory made, or its scratch directory not made because the file system gave no answer, or none in time | host | always | in |
| the directory at the card's workspace path, refused under `R-WORK-13` | card-local | — | in: `R-ESCALATE-12` |
| a role's scratch directory refused under `R-WORK-26`, the maker's or a judge's | card-local | — | in: `R-ESCALATE-12` |
| a judge's directory refused under `R-WORK-20` | card-local | — | in: `R-ESCALATE-12` |
| the card's branch checked out in a worktree elsewhere (`R-WORK-25`) | card-local | — | in: `R-ESCALATE-12` |
| the forge holding the card's line of work, or a merged pull request from it, under `R-WORK-19` | card-local | — | in: `R-ESCALATE-12` |
| more than one open pull request from the card's line of work | card-local | — | in: `R-ESCALATE-12` |
| a card in the owner's column with no pull request from its line of work | card-local | — | in: `R-ESCALATE-12` |
| a host failure on one attempt and a card-local refusal on the other | card-local | — | in: `R-ESCALATE-12`, never a hold |
| the line of work moved, or deleted, since L2 read it (`R-WORK-25`) | out | — | out: the next pull reads the forge again |
| two attempts failing in different host ways | out | — | out: the card stops, and admission stays open |
| a derived branch name git refuses | out | — | out: the card stops at the attempt that meets it, with no second attempt, and admission stays open |
| a worktree root that is not an absolute path | out | — | out: the card stops at the attempt that meets it, with no second attempt, and admission stays open |
| an optional step that failed or never started | out | — | out: `R-PROV-2` |
| a judge's directory not made, or a required step in a judge's `head` that failed or never started | out | — | out: no second attempt is made in that invocation, and the next invocation tries again |
| a judge's scratch directory not made because the file system gave no answer, or none in time | out | — | out: no second attempt is made in that invocation, and the next invocation tries again |
| a maker that ran its first command and then failed | out | — | out: the work's failure, not the environment's |
| two cards each failing once | out | — | out: counted per card |
| a card refused for its acceptance's form (`R-CARD-7`, `R-CARD-8`) | out | — | out: it stays a refusal `rigger plan` reports |
| a card refused for its kinds (`R-SCHED-12`) | out | — | out: it stays a refusal `rigger plan` reports |
| a card refused for its labels' tiers or providers (`R-LOOP-13`, `R-LOOP-16`) | out | — | out: it stays a refusal `rigger plan` reports |

## R-PROV — provisioning

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-PROV-1 | A provisioning step declares whether the work requires it. A step that does not declare it is optional. | the consumer's configuration | the config validator | D12 |
| R-PROV-2 | An optional step that fails is recorded, and the work proceeds. | the engine | the event record | D12 |
| R-PROV-3 | A required step that fails stops the card before any maker runs, so it is the environment that failed and not the work. | the engine | the event record, by whether a maker emitted anything | D12 |
| R-PROV-4 | Rigger runs a card's provisioning steps one at a time, in the order its kind of work lists them, each in the card's workspace. Every one of them ends before the maker that follows them starts. | the engine | the test suite | D12 |
| R-PROV-5 | A provisioning step that runs past its time has failed, as a step exiting non-zero has. | the engine | the test suite | D12 |

## R-CONFLICT — two cards touching one thing

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-CONFLICT-1 | Two cards changing the same thing never silently overwrite each other. One of them is stopped and returned to its maker. | the engine | the repository's history, by a change silently lost | D5 |

## R-RECORD — what Rigger records

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-RECORD-1 | Rigger records what it did from its first dispatch, without the consumer turning anything on. | the engine | the test suite | |
| R-RECORD-2 | The record yields signals for how work ran: how long it took, how often a host fault interrupted it, how often a process outlived its dispatch, and what the queue was carrying. | the engine | the test suite | |
| R-RECORD-3 | It yields signals for how work turned out: rounds per kind of work, how much came back, how often a tier was corrected, how often work escalated and why, and which proposals were taken. | the engine | the test suite | |
| R-RECORD-4 | An owner can read those signals back without reading the raw record. | the engine | the test suite | |
| R-RECORD-5 | Rigger never rewrites what it already recorded. | the engine | the test suite | |
| R-RECORD-6 | The record loses no event. What Rigger emitted is what a later reader finds. | the engine | the test suite | |
| R-RECORD-7 | Every event says when it happened, which run it belongs to, and which card and dispatch it concerns, so a reader can put two events beside each other. | the engine | the test suite | |
| R-RECORD-8 | A copy of the record placed anywhere else holds every event the original holds. | the engine | the test suite | |
| R-RECORD-9 | When Rigger cannot record an event, it says what went unrecorded and starts no further work until it can. | the engine | the test suite | |
| R-RECORD-10 | Rigger's record of the end of every merge its lane starts names why the pull request was not merged, whatever the outcome other than merged. What each outcome names is in `### R-RECORD-10 — Why a merge ended unmerged`. | the engine | the test suite | |
| R-RECORD-11 | After an attempt that continues a card's work, where the maker exits successfully, Rigger's record names the head of the card's pull request that Rigger last read under `R-WORK-34`. | the engine | the test suite | |
| R-RECORD-12 | Where Rigger read the forge again under `R-SCHED-26` or `R-WORK-34`, its record of the merge's end, or of the card's move to review or stay in coding, names how many reads it made. It also names how long after the first read the last one came. | the engine | the test suite | |

### R-RECORD-10 — Why a merge ended unmerged

| How the merge ended | Outcome recorded | Why it names |
|---|---|---|
| the forge merged the pull request | merged | out: none is required |
| the forge held the pull request as merged before the merge call | already merged | that the forge held it as merged already |
| the forge refused the merge call | refused | the refusal, and the check the refusal names where it names one |
| the merge call failed | failed | the failure |
| Rigger could not read the card again before the merge call | not merged | why it could not |
| on reading the card again, Rigger answered other than a merge, giving a reason | not merged | the answer, and the reason it gave |
| on reading the card again, Rigger answered other than a merge, giving no reason | not merged | the answer, and what the answer names |
| on reading the card again, Rigger answered a merge at another pull request or head | not merged | the pull request and head it answered, and the ones it pulled |

## R-IMPROVE — what the loops may do

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-IMPROVE-1 | No improvement loop changes code. A loop that acts on its own changes data alone: what runs next, and at what tier. | the engine | the gate | |
| R-IMPROVE-2 | A loop that acts on its own acts without asking. Anything it would change that the owner recorded as a decision becomes a proposal instead. | the engine | the event record, by what each move touched | |
| R-IMPROVE-3 | A proposal cites the signal it would improve, taken from the telemetry of the thing it proposes to change. | the role prompt | the engine, when it refuses a proposal | |
| R-IMPROVE-4 | A proposal that would push Rigger past a budget names the budget and is refused. | the engine | the test suite | |
| R-IMPROVE-5 | A proposal that survives those checks goes to the owner, whether it targets Rigger or the consumer's own roles and procedures. | the engine | the event record, by proposals against owner answers | |
| R-IMPROVE-6 | A proposal is recorded like anything else, so the record shows which were taken and whether they helped. | the engine | the event record | |

## R-SAFE — credentials, telemetry, and the network

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-SAFE-1 | Rigger stores no credentials. It uses the ones the owner has already given its tools. | the engine | the test suite | |
| R-SAFE-2 | Rigger makes no network call except through those same tools. | the engine | the test suite | |
| R-SAFE-3 | The record is sent to nobody. Copying it anywhere beyond the consumer's own machine is off until the owner turns it on. | the engine | the test suite | |
| R-SAFE-4 | An agent Rigger dispatches has the access of the account Rigger runs under, and no more. | the operating system | the operating system | |
| R-SAFE-5 | Rigger never runs against the source tree it is running from. | the engine | the test suite | |
| R-SAFE-6 | The role prompts, skills and hooks a consumer uses live in the consumer's repository. Rigger reads none of them from its own package at run time. | the engine | the test suite | |
| R-SAFE-7 | An agent Rigger dispatches can use only the tools and connectors the consumer's repository declares. A tool in these rows is an action the agent CLI offers the agent. A connector is an outside service, such as mail or a shop, that the agent acts on through the owner's own sessions or login. What counts as declared: | the engine | the test suite | |
| R-SAFE-8 | — a tool built into the agent CLI counts as declared unless the repository withholds it, except a tool `R-SAFE-9` names; | the engine | the test suite | |
| R-SAFE-9 | — a connector, and a built-in tool that acts through the owner's own sessions or login, count as declared only where the repository declares them. Such a tool, for example, drives the owner's browser or desktop, or publishes as the owner. The agent never uses one the repository does not declare, even a connector the owner connected to their own account. | the engine | the test suite | |

## R-OPTION — what a consumer may leave out

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-OPTION-1 | A consumer configures only what it uses. Leaving a capability unconfigured yields a Rigger that runs without it, and that absence is a tested state rather than a degraded one. | the engine | the test suite | |
