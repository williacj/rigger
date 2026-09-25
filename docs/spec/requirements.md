ABOUTME: This is the core product requirements doc for Rigger. Each requirement states a condition, names no mechanism, and records what makes it true and what would catch a violation.

# Requirements

**Every row in this file binds**, so a reader never has to check a column before trusting one — a
row proposed and not yet ratified lives in its pull request, never here. Until M5, the owner
ratifies a proposed requirement by merging its pull request, and the row binds from that merge. A
merge by anyone else ratifies nothing. `D21` records this arrangement, and what M5 must settle in
its place.

A requirement states what must be true. It is observable from outside, and it names no mechanism;
`ARCHITECTURE.md` holds the structure that implements it. A requirement survives a redesign where
that structure may not. Requirements themselves still change over time, and are added and
withdrawn as what Rigger must do changes.

A decision states what was chosen among the structures that satisfy these requirements, and what
would reverse it. `docs/spec/decisions.md` holds those. Where a requirement follows from a
decision it cites it, and the decision is where the reasoning lives. A requirement citing nothing
originates here.

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
| R-CARD-26 | — a fenced code block closes at the next line indented at most three spaces that holds a run of its opening run's character, at least as long as its opening run, then only spaces or tabs (U+0009); | the engine | the test suite | D2 |
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
| R-SCHED-9 | Two cards never merge at the same moment. | the engine | the event record, by overlapping merge intervals | |
| R-SCHED-10 | Rigger refuses a configuration naming anything it does not offer, and says what it refused. | the config validator | the test suite | |
| R-SCHED-11 | Rigger never pulls a ready card no kind of work selects, never reports it as a card it refused, and leaves it on the board. Work the consumer marked as an epic is selected by no kind, so Rigger never pulls an epic and never reports one as refused. | the engine, and the consumer's configuration for what each kind selects | the test suite | |
| R-SCHED-12 | Rigger never pulls a ready card that two or more kinds of work select. It refuses the card, and the refusal names every kind that selects it, in the order the configuration declares them. | the engine | the test suite | |
| R-SCHED-13 | A kind of work selects a card that carries any one of the labels the consumer's configuration names for that kind, and never selects a card carrying none of them. | the engine | the test suite | |
| R-SCHED-14 | Rigger refuses a configuration in which a kind of work names an empty list of labels to select by, and the refusal names that kind. | the config validator | the test suite | |

## R-WORK — isolation and exclusivity

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-WORK-1 | A card's work happens in a workspace nothing else is using. No two dispatches share one, whether they are working one card or two. | the engine | the event record, by two dispatches naming one workspace | |
| R-WORK-2 | At most one actor mutates a card's board state or its workspace at any moment. | the engine | the event record, by two writers on one card | D11 |
| R-WORK-3 | A card's workspace and its line of work are derivable from the card, so the same card always yields the same ones. The rule that derives them is the consumer's. | the engine | the test suite | |
| R-WORK-4 | One engine at a time has sole control of a repository's board and its workspaces. Two engines never work one repository. | the consumer's configuration | nothing yet | |
| R-WORK-5 | Rigger keeps the board current as a card progresses, because the board is what a restart reads. | the engine | the event record, by a transition the board never received | D1 |
| R-WORK-6 | A card's work is delivered as a change a judge can read and rule on before it lands, never as a change already in place. | the engine | the repository's history, against the record | |

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

## R-EVIDENCE — what a judge is given

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-EVIDENCE-1 | Rigger gives a judge the facts of the work it is ruling on, so that the judge does not go and find them itself. | the engine | the event record, by what each judge was given | D9 |
| R-EVIDENCE-2 | A judge may look beyond what it was given. What it is given is a floor, never a limit. | the engine | the test suite | D9 |
| R-EVIDENCE-3 | What a judge is given identifies the card, its acceptance, the work under review, and what that work changed. On a second or later round it also identifies what changed since the round before. | the engine | the event record, by what each judge was given | D9 |
| R-EVIDENCE-4 | What a judge is given carries no other judge's findings or verdict, and no part of the maker's session. | the engine | the event record, by what each judge was given | D9, D6 |
| R-EVIDENCE-5 | Rigger records what each judge was given, so a later reader can tell whether two judges ruled on the same thing. | the engine | the event record | D9 |

## R-VERDICT — what a judge returns

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-VERDICT-1 | A verdict takes one of a set of values Rigger fixes. A consumer chooses none of them and adds none. | the engine | the gate | |
| R-VERDICT-2 | The set holds exactly three: the work is sound, the work needs revision, and the work has a fault that must not merge. | the engine | the test suite | |
| R-VERDICT-3 | A verdict that is not sound names what would make it sound. | the role prompt | the gate | |
| R-VERDICT-4 | A verdict leaving an acceptance item unmet is not sound. | the role prompt | the gate | D2 |
| R-VERDICT-5 | A verdict is bound to the work it ruled on and to the acceptance it ruled against, so a later reader can tell what it covered. | the engine | the event record, by what each verdict names | D2 |
| R-VERDICT-6 | A judge returns critical, the verdict for a fault that must not merge, only where no maker revision could resolve that fault without an owner decision. A fault a maker revision could resolve is needs revision. | the role prompt | nothing yet | D14 |

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
| R-GATE-8 | — the consumer's own checks have passed. | the gate | the test suite | |

## R-ESCALATE — what reaches the owner

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-ESCALATE-1 | Every escalation to the owner is one of the configured categories. A card escalated to the owner proceeds no further until the owner answers it. | the engine | the event record, by the category on each escalation | D3 |
| R-ESCALATE-2 | The set of categories is Rigger's. A consumer chooses which of them are the owner's to decide, and adds none. All are the owner's unless the consumer says otherwise. | the engine | the config validator | D3 |
| R-ESCALATE-3 | The set holds exactly three: a change to a recorded decision, a fault that must not merge — the same fault a verdict names — and an ambiguity no role could resolve. | the engine | the test suite | D3 |
| R-ESCALATE-4 | A maker or the loop raises an escalation. A judge does not; a judge returns a verdict. | the engine | the event record, by what raised each escalation | D3 |
| R-ESCALATE-5 | A kind of work naming the owner as its last judge is the loop running, not an escalation. | the engine | the event record, by owner dispatches against escalations | D3 |
| R-ESCALATE-6 | When a judge returns a fault that must not merge, the loop escalates the card in that category rather than spending its rounds. | the engine | the event record, by the category on each escalation | D3 |
| R-ESCALATE-7 | An escalation carries the card, the reason it escalated, and the work as it stands. | the engine | the event record, by what each escalation carried | D3 |

## R-STATE — what survives a restart

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-STATE-1 | The board is the truth for a card's workflow state. Rigger persists no card workflow state of its own. | the engine | the test suite | D1 |
| R-STATE-2 | A restart loses no card and completes no partial one. A card interrupted mid-flight is done again from the beginning. | the engine | the test suite | D1, D10 |
| R-STATE-3 | A card done again after an interruption is distinguishable afterwards from one done at the first attempt. | the engine | the event record | D1 |
| R-STATE-4 | Rigger persists only what it cannot rebuild from the board: whether admission is open and why it closed, the processes it must still clean up, and the record. Each survives a restart. | the engine | the test suite | D1 |
| R-STATE-5 | Rigger ends every process it started, and records any it had to end by force. A process that outlives its dispatch never changes a result. | the engine | the event record | |

## R-FAIL — infrastructure failure

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-FAIL-1 | Work that failed before the maker ran its first command is tried again rather than judged. Nothing about the work has been shown. | the engine | the event record, by whether a maker emitted anything | D12 |
| R-FAIL-2 | An infrastructure failure dispatches no maker, and the card is tried once more. | the engine | the event record, by attempts against starts | D12 |
| R-FAIL-3 | A second failure of the same kind, without a success between them, closes admission and records why. | the engine | the event record, by failures counted against the hold | D12 |
| R-FAIL-4 | An infrastructure failure never escalates to the owner as a fault in the work. | the engine | the event record, by the category on each escalation | D3, D12 |

## R-PROV — provisioning

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-PROV-1 | A provisioning step declares whether the work requires it. A step that does not declare it is optional. | the consumer's configuration | the config validator | D12 |
| R-PROV-2 | An optional step that fails is recorded, and the work proceeds. | the engine | the event record | D12 |
| R-PROV-3 | A required step that fails stops the card before any maker runs, so it is the environment that failed and not the work. | the engine | the event record, by whether a maker emitted anything | D12 |

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

## R-OPTION — what a consumer may leave out

| id | requirement | made true by | checked by | from |
|---|---|---|---|---|
| R-OPTION-1 | A consumer configures only what it uses. Leaving a capability unconfigured yields a Rigger that runs without it, and that absence is a tested state rather than a degraded one. | the engine | the test suite | |
