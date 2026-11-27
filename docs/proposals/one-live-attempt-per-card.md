ABOUTME: Card #1461's design, a proposal for the owner: how a later attempt at a card is kept from
starting on a host beside a process of an earlier attempt that Rigger found or has a sign of.

# One live attempt per card, on one host

This is card #1461's design, for the owner to ratify or reject. It changes no binding document.
A change it needs to `ARCHITECTURE.md` or to a decision is named as a proposal for the owner
(`D18` rule 1). A requirement it touches is named as input to the PM's proposal on #1455, never as
a requirement proposal of its own (`D18` rules 3 and 7).

The card covers one host. The fence against a stale attempt's writes, on this host or another, is
#1474's, and this design uses nothing #1474 supplies.

Each figure is marked **measured**, with its source, or **judgment**, with its premise. "What was
opened" names what this proposal cites, at which ref, and what it did not open. An **assumption**
or an **open question** is marked where it appears. I ran nothing.

## The answer

Each attempt announces itself on the host before it looks, and looks before it starts.

1. **Announce.** Before Rigger starts any process for an attempt, its supervisor makes one entry for
   it in the state directory. The entry's name carries the attempt's place in the card's order.
2. **Look.** It then lists the card's entries. Where it finds a later attempt's, it stands down.
   Where it finds an earlier attempt's, it starts only once that attempt's tree is shown gone.
3. **One actor per tree.** While the earlier attempt's supervisor is alive, that supervisor ends its
   own tree, because it lists the entries too. Once that supervisor is shown dead, or its dispatch
   has settled, the later check takes the entry and ends the tree through E1's kill.
4. **An entry outlives its dispatch** until its tree is shown gone. A settle that left a process
   alive, or a read that failed, leaves the entry standing, and a standing entry refuses the next
   attempt.

Because each side announces before it lists, at least one of two attempts sees the other. The
design holds no lock.

## The problem, and its evidence

- **A second tree runs beside the first.** On macOS and Linux an orphan lived 293 s to 311 s after
  `kill -9` of its worker. The next attempt's tree ran beside it (measured,
  `docs/spikes/temporal-dispatch-under-failure.md`, "The worker killed outright, mid-dispatch"). On
  Windows, in the one run, the first tree died with its worker (the same section).
- **v0 has the path with no restart.** The architect read it and did not run it
  ([1453#7090420413](https://github.com/williacj/rigger/issues/1453#issuecomment-7090420413)). A
  dispatch settles with a process alive, and `dispatch` in `src/execution/run.mjs` removes its
  entry. A required step then fails, and L2 answers `again`. Attempt 2 starts with nothing checking
  for that process. I read the same code again at 3e325ab8, and it is as that comment says.

The owner ruled that Rigger refuses to start a later attempt on a sign
([1453#7104432562](https://github.com/williacj/rigger/issues/1453#issuecomment-7104432562),
[1453#7106926111](https://github.com/williacj/rigger/issues/1453#issuecomment-7106926111)).

## The guarantee

This is **input to the PM's requirement proposal on #1455, and not a requirement proposal.** On one
host:

1. Rigger starts a process of a later attempt at a card only where every earlier attempt's tree its
   check found is shown gone, and no sign of an earlier attempt's process stands.
2. Rigger starts no process of an earlier attempt once it has started one of a later attempt.

The signs are the owner's three: a process recorded as not ended and not yet shown gone, a
process-table read that failed, and a missing or unreadable record.

The guarantee is observable from the host's entries, the event record and the process table. It
says nothing of a process that left no sign ("The residual"), nothing of another host, and nothing
of what a process wrote to the forge (#1474).

### What counts as an attempt

**Assumption 1.** An attempt is one dispatch: a step, a maker, a judge or an escalation's role. The
rulings do not define it. A ruling that an attempt is a whole claim would falsify it.

**Assumption 2.** The first process of an attempt is the git command that makes its directory.
Rigger's own `gh` calls are not an attempt's processes. A ruling that they are would move the check
ahead of the claim.

**Assumption 3.** Dispatches L3 makes at once from one judge answer are a **panel**. Each judge of a
panel, with the steps in its own `head`, is one **thread**. Two dispatches of one panel in different
threads are neither earlier nor later than each other. For every other pair of one card's
dispatches, the one scheduled first is earlier. The rulings say nothing of dispatches made together,
and #1455 puts this reading to the owner.

| Earlier | Later | Does the later one's check end the earlier one's tree? |
|---|---|---|
| step | step, maker, judge or escalation's role, not in another thread of its panel | Yes |
| maker | step, maker, judge or escalation's role | Yes |
| judge | step or maker of a later round, escalation's role, or a judge of a later round | Yes |
| judge, or a step in its `head` | the same thread's later step, or the same judge dispatched again | Yes |
| judge, or a step in its `head` | a judge or step in another thread of one panel | No: neither is earlier |
| escalation's role | step, maker, judge or escalation's role | Yes |

"Yes" means the check ends it, or has its live supervisor end it, as "The check" says.

## The check

### What the host holds

The **register** is one directory in the state directory. It holds one directory per card, and in
it one **entry** per attempt. An entry is a directory. Its name carries:

- the attempt's order, panel and thread, from whatever schedules attempts;
- the dispatch id;
- the supervisor's identity: the host's boot identity, the supervisor's pid, and its start time.

One `mkdir` of a name no other attempt uses announces an attempt, so an announcement is never torn.

An entry holds **notes**. A note is a file written under a name starting with `.` and then linked to
its own name, as admission's closers are (`ARCHITECTURE.md`, "Failure model"). No note's content
changes after its link, and no reader opens a name starting with `.`.

| Note | What it says | Written |
|---|---|---|
| `starting` | the dispatch's process is about to start | before the process starts |
| `held` | where its process is: the unit's name, or the group's id and leader start | once the process is there, before it runs its command where E1 has a gate |
| `tracked` | one descendant outside the group, by pid and start time | as the tracker adds it (`R-STATE-29`) |
| `unread` | one read that failed, and why | as it fails |
| `unended` | one process not ended, by pid and start time, and why | at the settle |
| `settled` | no code of this dispatch acts on this tree any more | at a settle that leaves the entry standing, and only once every `unended` and `unread` note it owes is linked |
| `taken` | who took the entry: its supervisor's identity. Numbered, so one link wins each number | by a check or a reap |
| `returned` | the taker of that number acts on it no more | by that taker |
| `ended` | the tree is shown gone, or the attempt started nothing | last |

E1's builds own the unit's record, which is what `held` and `tracked` hold (ruling 1). This design
needs six things of it, and leaves its form to E1:

1. An entry's change loses no other entry's. Today the record is one file, read and rewritten
   whole, so two workers on one host could lose each other's entry (`src/execution/groups.mjs`,
   `addGroup`). That they would is judgment, from reading it.
2. It names the supervisor. Today's entry does not (`isEntry` in the same file).
3. It names the dispatch, so that an entry here and a unit there are one attempt's.
4. It stays until the tree is shown gone, and not only until the dispatch settles.
5. Its kill and its reap act only under a take, as "One actor per tree" says.
6. Where E1 has no unit, as on macOS, it holds today's entry and `R-STATE-29`'s tracked set.

A **record event** stands beside the register. L1 appends `attempt.starting` before it writes
`starting`, and `attempt.cleared` once a tree is shown gone and before it links `ended`. Each carries
the entry's order, panel and thread. They are the evidence outside the record by which a missing
record is told from a first attempt.

### The order of a start

1. The supervisor establishes that it sees every attempt this host runs (below).
2. It makes its entry.
3. It reads the card's `attempt.starting` and `attempt.cleared` events, and then lists the card's
   entries. In that order, an earlier attempt's `attempt.starting` it read has its entry in the list,
   because the entry came first. It ignores the events of an attempt that is not earlier. Where an
   entry is missing, it reads the events once more before it says so.
4. Where an entry that is not its panel's other thread carries a higher order, whatever that entry
   holds, it links its own `ended` and starts nothing.
5. For each entry of a lower order without `ended`, it has the tree ended and shown gone, as "One
   actor per tree" says. Where one is not, or a sign stands, it is **refused**: it links its own
   `ended`, records why, and starts nothing.
6. It has L1 make the attempt's directory. It appends `attempt.starting`, links `starting`, starts
   the process and links `held`. Where its start fails before a process was started, it links its own
   `ended`, after an `attempt.cleared` where it had appended `attempt.starting`.

While it waits in step 5, and while its tree runs, the supervisor lists the card's entries once a
period. A higher order, or its own entry gone, tells it that it is superseded.

### One actor per tree

| The earlier entry | Who ends its tree |
|---|---|
| its supervisor is alive and it has no `settled` | That supervisor. It lists the entries once a period, sees the later order, ends its own tree, and links `ended`. The later check waits |
| it has `settled` | Whoever takes the entry |
| its supervisor is shown dead | Whoever takes the entry |
| its supervisor's liveness cannot be read | Nobody. The later attempt is refused |
| it is taken, not returned, and the taker is not shown dead | The taker. The later check waits |

So an earlier attempt's running supervisor does end its own tree when it learns it is superseded, and
it learns it on this host, with no word from the scheduler.

A supervisor is **shown dead** where its entry's boot identity is not this boot's. It is also shown
dead where a process-table read that succeeded lists no live process of its pid, or lists one with
another start time. A zombie is dead. A read that failed shows nothing.

A tree is **shown gone** in exactly these cases:

- its entry's boot identity is not this boot's, because no process outlives its boot;
- its entry has no `starting` and its supervisor is shown dead, because the process starts only
  after `starting` is linked;
- its entry has `held`, no `unread` stands, and every process is read as gone:
  - **macOS:** each recorded process and group, and each directory's census, by reads that
    succeeded. A pid whose process has another start time is another process;
  - **Linux, with E1's cgroup:** the cgroup reads `populated 0`, or is absent;
  - **Windows, with E1's job:** the job was opened and read as holding no process. A name that does
    not open shows nothing by itself.

### What each state answers

Every state below answers the same on macOS, Linux and Windows, except where a cell says otherwise.
macOS has no measured whole-tree kill today.

| State | Does the later attempt start? | macOS | Linux | Windows |
|---|---|---|---|---|
| earlier tree found | Only once it is shown gone | The tree is the group, the tracked set and the directories' census | With E1's cgroup, its members. Until then as macOS | With E1's job, its members. Until then no host (`D13`) |
| none found | Yes, where no sign stands | — | — | — |
| record absent, with no evidence outside it | Yes: a first attempt, or a clean settle | — | — | — |
| record absent, with evidence outside it | No: the third sign | — | — | — |
| record unreadable | No: the third sign, naming the path | — | — | — |
| identity unconfirmed: the start time or the unit cannot be read | No: the second sign | — | — | A job whose name does not open is here |
| process read failed | No: the second sign | — | — | — |
| kill left a member alive | No: the first sign | — | — | — |
| no answer within the bound | No | — | — | — |
| the supervisor cannot establish that it sees every attempt this host runs | No | — | — | — |

An identity that a read answers and that does not match is not "unconfirmed". The recorded process
is gone, and the process now at that pid is never signalled. Today's rows differ: #1467's rows R5
and R12 record both as `recorded.unended`. This design needs the two told apart.

### The bound

A check ends within **120 s** (judgment). Its premise is the longest one dispatch's ending can take.
I added the deadlines in `src/substrate/process.mjs` at 3e325ab8 and in "Failure model", each of them
a judgment there: 96 s.

| Part | Deadline (judgment, derived from the source's own) |
|---|---|
| one period until the earlier supervisor lists the entries | 1 s |
| the tracked set: the final read, the kill's wait, the read after it | 5 s + 10 s + 5 s |
| the group: census, reads before the kill and their spare, kill, read after, names | 5 s + 5 s + 5 s + 10 s + 5 s + 5 s |
| two directories: each swept, then waited on | 2 × (5 s + 10 s + 5 s) |

The rest of the 120 s is room for the check's own reads. The check makes its file reads
asynchronously, so the bound covers a read that never answers. At the bound the attempt is refused.
A check that holds a take links `returned` first. Whether these deadlines hold under load is
unmeasured ("Unmeasured claims").

### Seeing every attempt this host runs

A supervisor sees every attempt only where it and every other supervisor for the repository use one
register, one account and one process table. It establishes each, and a failure of any is the last
row of the table above:

1. **One register.** A **pin** lies in the account's home directory, read from the account and never
   from the environment, at a path the repository's name gives. It is linked once, and names the
   register by real path, device and inode, with the next item's identities. A supervisor whose
   register differs from the pin is refused. Where the pin is absent, it links one.
2. **One installation, account and process table.** The pin holds the installation's identity, the
   user's id and, on Linux, the process-namespace identity. The supervisor compares its own.
3. **A process table it can read.** It reads the table, and finds itself there by pid and start time.

A worker under another account, or in a container with a process table of its own, is refused or is
another host (#1461, "The same host"). **Assumption 4:** nothing in an environment changes the
account's home directory. Two accounts naming one home would falsify it.

## The signs

This section is input to the PM's proposal on #1455. What clears a sign is **an open question for the
owner**, for each row. The fourth column is what the design can support. Until the owner answers, the
design clears a sign only where the process is shown gone.

| Sign | Read or record it comes from | Told from a clean settle and a first attempt | What could clear it, as a question |
|---|---|---|---|
| 1. A process recorded as not ended, not shown gone | An `unended` note, or the entry itself standing after its settle | A clean settle links `ended`. A first attempt has no entry | A read that succeeds and lists no such pid, or lists it with another start time; or another boot. The owner may also rule that a person can clear it |
| 2. A process-table read that failed | An `unread` note; or the check's own read | The same | **The check's own read:** the next check's read, if it succeeds. **A read recorded in an `unread` note:** it names no process, so on macOS no later read shows anything gone. Another boot clears it, or nothing does. With E1's unit, the unit read as empty could clear it |
| 3a. A missing record | `attempt.starting` with no `attempt.cleared` and no entry; or an entry with `starting`, no `held`, and a supervisor shown dead | A clean settle and a first attempt leave neither. Both evidences are written before the process starts | Another boot. On Linux or Windows, E1's unit of that name read as empty, where E1 also shows that no process was started outside it |
| 3b. An unreadable record | A note, an entry name, the pin or the event record that cannot be read | Only a file that exists can be unreadable | A person mending or removing it; or another boot, where the entry's name can still be read |

**Open question for the owner:** whether a failed read that names no process may stall a card until
the host's next boot. The owner was told that a card can stall on a leftover process. This stall has
no process to find. With the tracker, one failed read in a dispatch is enough.

**Which reads count, assumption 5.** The owner ruled that a failed process-table read is a sign, and
not which reads. The design counts all four, because each can hide a process of the attempt:

| Read | Counts? |
|---|---|
| a tracker read during the dispatch | Yes |
| a directory `R-STATE-19` could not read | Yes, though it is a census of working directories |
| a group `R-STATE-26` has reads list nothing of while the system reports it present | Yes |
| the check's own read | Yes, for this attempt only: it leaves no note |

A directory skipped because it is no longer the one recorded is an answer, and does not count. One
skipped because its identity cannot be read counts. A ruling that a read which a later read in the
same dispatch makes good does not count would falsify this assumption, and would remove most of row
2's stalls.

**Assumption 6.** The event record is evidence. Where L3 cannot read it, the check cannot tell a
missing record from a first attempt, so it counts as an unreadable record and the attempt is
refused. A ruling that only the register is "the record" would falsify this.

**A missing record whose outside evidence is lost too.** Three losses differ:

- **One entry is lost.** The event record shows the missing record, and the attempt is refused.
- **The whole register is lost.** The pin names a register that is not there, so the attempt is
  refused.
- **The register, the event record and the pin are lost together.** The host looks like one that
  never ran the card, and the attempt starts. **Open question for the owner:** whether that start is
  accepted. Refusing it would refuse every first attempt.

## The residual

A process of an earlier attempt that left no sign may be alive when a later attempt starts, and the
later attempt starts. The guarantee covers none of these. The known ways, by operating system:

| Operating system | How a process can be alive with no sign |
|---|---|
| **macOS**, and Linux until E1's cgroup | The immediate double fork, and any other descendant no read showed with its parent in the group or tracked, where no read failed (`R-STATE-29`'s table). One that started after the last read before the group was ended (the same table). One a dead engine had not yet recorded (the same table). |
| **Linux, with E1's cgroup** | A process the agent has another manager start, through `systemd-run --user` or D-Bus activation. A member moved out on purpose. #1430 says not to assume the cgroup holds either ("Linux under WSL2: a delegated cgroup per dispatch, ended by cgroup.kill"), and measured neither |
| **Windows, with E1's job** | A process started with `CREATE_BREAKAWAY_FROM_JOB` under a job that allows it (#1430, "Native Windows: a Job Object per dispatch, with kill-on-job-close"). One that a service of the system starts for the agent: judgment, with no source |
| **Each** | A process that every read of the table consistently leaves out, which `startsIn` in `src/substrate/process.mjs` records as a case no read can find. A command that is not a dispatch, such as L1's git or an adapter's command, orphaned when Rigger is killed outright: L1 records only dispatches. A read that failed where Rigger was killed before it noted it, on an entry whose every recorded process is then shown gone. On macOS and Linux, one the agent asked a scheduler or launcher of the system to start: judgment |

**Open question for the owner, not blocking:** whether an orphaned git command in a card's directory
is an accepted residual. An entry could name one more phase, at the cost of refusing the next
attempt after every outright kill during a fetch.

## How the refusal fits today's rows

This section is input to the PM's proposal on #1455.

- **`R-STATE-11`, "starts no work".** It binds a whole start of Rigger, over a record of groups. The
  refusal here binds one card's next attempt. Where Rigger starts and cannot read the record or
  confirm a recorded group, `R-STATE-11` still stops all work, and no check is reached.
- **`R-STATE-19`, "waits on it no further".** It ends the wait of the dispatch that is settling. That
  dispatch still settles. The later attempt does not wait on the process either: it looks, within
  the bound, and is refused. The row says nothing of the next start of that card, and needs a clause
  that does.
- **The next start #1467 builds.** It ends what it can confirm, and records the rest as not ended.
  Nothing there refuses later work, which is right for M8. The reap also drops the entry of a group
  in which it could not end a process: `killEntries` in `src/execution/run.mjs` keeps only entries it
  could not confirm. This design needs that entry kept.
- **`R-STATE-29`'s table.** Its row "cannot confirm the process at that pid is still the one
  recorded" covers a mismatch and an unreadable start time alike. The design needs the second to be
  a sign and the first not.

### Whether a refused attempt can close admission

**As `R-FAIL-8`'s table reads today, yes.** "The maker's dispatch never started" and "a required
provisioning step that never started" are host failures. A refused maker or step meets those words.
So does a refused judge, under "any other error the host reported while Rigger started a process".
A second refusal the same way would close admission, so one leftover process would stop every card.

**As this design has it, no.** L1 reports a refused attempt as its own outcome, apart from a command
that never started. L2 answers neither `again` nor `hold` for it, and L3 sets the card aside for the
invocation. That needs a row of its own in `R-FAIL-8`'s table, which is the PM's to propose. The
design takes card-local or out, and works with either. What the owner is shown, whether Rigger looks
again by itself, and what lets the card continue are the PM's (#1455, "What done means").

## How identities are told apart

| What | How | Where it can be wrong |
|---|---|---|
| a recorded process, its group's leader, a tracked process | pid and start time, within the entry's boot. E1 and L0 supply it, as `recorded` and `startOf` in `src/substrate/process.mjs` do today, and as "Failure model" has the tracker do | Two processes given one pid within the start time's resolution, which `startOf` records as whole seconds on macOS (measured there) |
| a containment unit | its name carries the dispatch id, which no other dispatch has | E1's, for how it names a unit |
| a supervisor, and a take's holder | the host's boot identity, pid and start time | the same resolution, which makes a dead supervisor look alive, and so refuses |
| another boot | the host's boot identity, read from the operating system | unmeasured on each host |

The design uses no lock, so no lock's holder is told apart. A take's holder is, as a supervisor is.

## Who carries which part

| Part | Carried by |
|---|---|
| Ending a recorded unit; the unit's durable record; the reap at a worker's or engine's start; the start gate where there is one | E1's containment builds (ruling 1 as corrected: the reap ends only units of a supervisor shown dead) |
| The announcement, the check before each attempt, which attempt is current on this host, the take, the pin, and the two `attempt` events | This card, E2 |
| The fence against a stale attempt's writes, on this host or another | #1474 |

What happens where E1's reap finds a supervisor it cannot show dead is open for E1's proposals
(#1454, "Depends on"). This design needs only that the reap then leaves the entry as it was.

## What the check needs from whatever schedules attempts

| Property | v0's engine | E3's workflow | Does the part that uses it depend on Temporal? |
|---|---|---|---|
| For any two dispatches of a card, which was scheduled first | L3 numbers them. It reads the highest order among the card's entries and hands the next, which is sound because one engine is the only allocator (`D11`, `R-WORK-4`) | The pair of a counter the card's workflow keeps and the activity's attempt number, compared in that order | No |
| Which dispatches are one panel, and which thread each is in | L3, as it makes the panel | The workflow, as it schedules the judges | No |
| A dispatch id no other dispatch has | L3's, as today | The activity's own, from the workflow | No |
| It may give an attempt up without its tree having ended, and says so to nobody | It never does: L3 dispatches again only once a dispatch settles | A heartbeat or schedule timeout | No: the host needs no word from it |
| A refused attempt is not scheduled again at once | L2's answer and L3's set-aside memory | The workflow's handling of that failure | No |

**Assumption 7.** Under E3 a workflow can hand an activity its counter, and the activity can read its
own attempt number. #1429's activity heartbeated its attempt number ("What ran"), so the second half
is seen. The first is judgment.

## The actors and their steps

A step is one read, write, rename, process start, kill, forge call, scheduler call, handle close or
process exit. The check, the settle and the reap make no rename. A note is two steps, .w writing it
under a hidden name and .l linking it. A read of the process table or a census runs a tool, whose
process is no attempt's. A step that names "one" is taken once for each thing it names.

| Actor | Steps |
|---|---|
| **S*n***, attempt *n*'s supervisor: before its check | a1 scheduler call: receive the order, panel, thread and dispatch id. a2 read the pin. a3 write the pin, where absent: a3.w, a3.l. a4 read the register's identity. a5 read the installation's identity. a6 read the process-namespace identity, on Linux. a7 read the boot identity. a8 read the process table and find itself |
| **S*n***: its check | b1 write: make the entry. c2 read the event record. c1 read: list the card's entries. c3 read one note. c4 read the process table. c5 read one unit. d1 `taken`.w, d1.l. d2 kill: one signal, or one unit's kill. d3 read what is left of a process or unit. d4 write: remove an emptied unit. d5 write: append `attempt.cleared`. d6 `ended`.w, d6.l on the entry it took. d7 `unended` or `unread`.w, d7.l. d8 `returned`.w, d8.l. x1 `ended`.w, x1.l on its own entry: to stand down, when refused, or when its start failed |
| **S*n***: its start | p1 process start: a command that is not the dispatch, such as git. p2 read that command's exit. f1 write: append `attempt.starting`. f2 `starting`.w, f2.l. f3 write: make the unit, on Linux and Windows. f4 process start: the dispatch's command, held at E1's gate where there is one. f5 read its start time. f6 write: place it in the unit. f7 `held`.w, f7.l. f8 write: release the gate |
| **S*n***: while its tree runs | g1 read the process table, for the tracker. g2 `tracked`.w, g2.l. g3 `unread`.w, g3.l. g4 read: list the card's entries |
| **S*n***: its settle | h1 read the process table. h2 kill. h3 read what is left. h4 `unended`.w, h4.l. h5 `unread`.w, h5.l. h6 `settled`.w, h6.l. h7 write: remove the emptied unit. h8 write: append `attempt.cleared`. h9 `ended`.w, h9.l. h10 write: remove one file of an older ended entry. h11 write: remove that entry's directory. j1 scheduler call: give its result |
| **T*n***, attempt *n*'s agent tree | t1 process start, a descendant's. t2 process exit. t3 write, in its directory. t4 forge call |
| **Whatever schedules attempts** | s1 scheduler call: schedule an attempt. s2 scheduler call: give an attempt up |
| **R**, the reap at a worker's or engine's start | ra2 and ra4 to ra8: the reads a2 and a4 to a8 name. r2 read: list every card's entries. r3 read one note. r4 read the process table. r5 `taken`.w, r5.l. r6 kill. r7 read what is left. r8 `unended` or `unread`.w, r8.l. r9 write: remove an emptied unit. r10 write: append `attempt.cleared`. r11 `ended`.w, r11.l. r12 `returned`.w, r12.l |
| **The operating system** | o1 process exit: a supervisor's, with everything it held. o2 handle close: a job's last. o3 kill: a job's members at that close. o4 process start: one that takes a pid an earlier process had. o5 process exit: every process, at a reboot or a power loss |
| **G**, E1's start gate, where there is one | k1 read: its supervisor's release, or the end of the channel. k2 process exit, at the end of the channel |

T*n*'s t3 and t4 change no process and no entry, so they are in no row. What refuses them is #1474's.

## Interleavings

Attempt 1 is the earlier and 2 the later, on one host, unless a row says otherwise. "Refused" means
attempt 2 starts nothing. **v0** and **E3** name the dispatch model under which a row arises.

### The required rows

| Row | Ordering | Required outcome | Arises under |
|---|---|---|---|
| S1a | The host sleeps with T1 alive. s2, s1 for 2. The host wakes. S2 b1, c1. S1 g4 | S1 sees order 2, ends T1 and links `ended`. S2 then starts. If S1 does not within the bound, 2 is refused | E3 |
| S1b | S1 stalls, alive. s2, s1. S2 b1, c1, c4 | S1 is alive and has no `settled`, so S2 ends nothing, and is refused at the bound | E3 |
| S1c | S1 is cut off from the scheduler, alive. s2, s1. S2 b1. S1 g4 | As S1a: S1 learns it from the register | E3 |
| S1d | As S1b, and S1 resumes after 2 was refused. S1 g4 | 2's entry has `ended`, and its order is higher. S1 ends T1 and links `ended`. Attempt 3 finds nothing to end | E3 |
| S2a | T1 alive, S1 alive. 1's entry is removed. S2 b1, c1, c2 | `attempt.starting` with no `attempt.cleared` and no entry: a missing record, so 2 is refused. S1's g4 does not find its own entry, so it ends T1 and appends `attempt.cleared` | both |
| S2b | As S2a, with S1 dead | Refused. Nothing on the host clears it but another boot, or E1's unit | both |
| S2c | 1 settled with a process not ended, so its entry stands, with no `attempt.cleared`. The entry is removed. S2 c1, c2 | Refused: a missing record | both |
| S2d | The register is removed whole, T1 alive. S2 a2, a4 | The pin names another register or none, so 2 is refused | both |
| S2e | The check, the reap or S1 links `ended` with T1 alive | Cannot happen through the steps: each links it only after d3, r7 or h3 shows the tree gone. A process no read showed is S11 | both |
| S3a | S1 b1, c1. S2 b1, c1. S1 f4 | S2's c1 lists 1's entry, because S1's b1 came before S1's c1. S2 waits for `ended`, so S1's f4 comes before S2's start. S1 g4 then ends T1 | E3 |
| S3b | S2 b1, c1. S1 b1, c1 | S1's c1 lists order 2, so S1 starts nothing. S2's c1 may or may not list 1. If it does, S2 waits for `ended` | E3 |
| S4a | s1 for 1, which has started nothing. S2 checks and starts. S1 b1, c1 | S1 lists order 2, stands down by x1, and ends nothing | E3. Not v0: L3 schedules 2 only once 1 settled |
| S4b | As S4a, and T2 has ended cleanly before S1's c1 | 2's entry is still there, with `ended`, so S1 stands down. An ended entry is removed only where a higher order of another panel is there (h10) | E3 |
| S4c | As S4a, and S1 announces while S2 has not yet started | S2 waits for 1's `ended`, which S1 links as it stands down | E3 |
| S5 | 1 runs here. 2 runs on another host. 3 is scheduled here, T1 maybe alive | 3's c1 lists 1. Whether 1 is ended or 3 is refused is as rows S1a to S1d and X1 have it. 2 has no entry here and no part in it. What refuses 1's or 2's writes is #1474's | E3 |
| S6a | T2 and S2 alive. A second worker's R: r2 to r4 | S2 is alive, so R takes nothing of 2's and ends nothing | both. In v0, a second engine on one state directory, which `R-WORK-4` forbids |
| S6b | T2 alive, S2 dead. R | T2 is the tree of a dead supervisor, so ending it is what the reap is for. No process of a live attempt is ended | both |
| S6c | 1's entry stands with S1 dead, and shares a directory with T2 | Cannot happen: 2 started only once 1's entry had `ended`, and R acts on no entry that has it | both |
| S7a | R r5.l. S2 d1.l | One link wins the number. The other finds it taken by a live taker. S2 waits, within the bound. R skips the entry | both |
| S7b | R r5.l, then R is killed at any step to r11.l. S2 c3, c4 | R is shown dead, so S2 takes the next number and ends what is left. A process R left stopped is still listed, and is ended | both |
| S7c | R r5.l. R stalls. S2 waits | Refused at the bound. R alone acts on the tree when it resumes | both |
| S7d | S2 takes and is killed. R then runs | R takes the next number, as S7b | both |
| S8a | A reboot with 1's entry standing. Its pid is reused. S2 a7, c1 | The entry's boot is not this one, so T1 is shown gone. Nothing is signalled. `ended` is linked, and no sign stands | both |
| S8b | The same boot. T1's process exits, and its pid is reused. S2 c4 | The start time differs, so the recorded process is gone. The new one is not signalled, and keeps no sign standing | both |
| S8c | The supervisor's, or a taker's, pid is reused | The start time differs, so it is shown dead. Where it matches within the resolution, it reads as alive, and 2 is refused | both |
| S8d | A unit's name is found on another process set | Names carry the dispatch id, which is never reused. One whose identity E1 cannot confirm is unconfirmed, and 2 is refused | E3, with E1 |
| S8e | Power is lost after b1 and before a note reached the disk | The entry's name carries the boot, so a torn or absent note is not read: T1 is shown gone. An entry the disk lost names a process that also ended | both |
| S8f | Power is lost, and the pin is torn | Unreadable, so refused. A person mends or removes the pin | both |
| S9a | **macOS.** S1 exits outright (o1), T1 alive. S2's check | No effect of the death is awaited: there is no job and no gate. T1 is ended under a take, through `held` | both |
| S9b | **Linux or Windows.** S1 dies after f4 and before f7, so G has not yet read the end of the channel (k1, k2 to come). S2 c3 | `starting` with no `held`: a missing record, so refused, until E1 shows that no process of that start is left | E3, with E1 |
| S9c | **Windows.** S1 dead, o2 or o3 yet to come. S2 c5 opens the job | The job's members are read. S2 takes the entry, ends them, and reads until none is left | E3, with E1 |
| S9d | **Windows.** The same, and the name does not open. A member may still be ending | Unconfirmed, so refused. What would show the members gone after the last handle closed waits on #1460 | E3, with E1 |
| S10a | 1 settled with a process not ended (`R-STATE-19`). 2 due, no restart | h4 and h6: the entry stands with `settled`. S2 takes it, kills again, and starts only if the process is then shown gone | v0, E3 |
| S10b | As S10a, after a clean restart | The same. The entry is in the register, not in memory | both |
| S10c | 1's tracker, group or directory read failed, so `unread` stands. 2 due, with or without a restart | Refused, whatever is shown gone, until the owner's answer says what clears it, or another boot | both |
| S10d | A start's reap could not end a process. 2 due | R links `unended` and `returned`. S2 takes the entry, kills again, and starts only if it is then shown gone | both |
| S10e | R declined the unit: its supervisor was not shown dead. 2 due | No sign of the owner's three stands by that alone. The entry stands, so a tree the check found is not shown gone: 2 waits, then is refused | both |
| S10f | The sink refused `survivor.unended`, or `attempt.cleared` | Of `survivor.unended`: the entry stands with its `unended` note, the first sign. Of `attempt.cleared`: no sign stands, and h6 follows, so the entry stands until a check whose append is accepted. While the sink refuses, the halt starts no work (`ARCHITECTURE.md`, "Failure model") | both |
| S10g | The file system refused an `unended` or `unread` note, S1 alive | S1 links no `ended` for that dispatch, so the entry stands. S10a's outcome for a process. For a read that failed, no sign stands once S1 is dead and every recorded process is shown gone: it is in "The residual" | both |
| S11 | A process of 1 left its group, was in no read, and no read failed. 1's entry has `ended`. 2 due | 2 starts: the stated residual | both |

### The other rows

| Row | Ordering | Required outcome | Arises under |
|---|---|---|---|
| X1 | S1 killed outright (o1) with T1 alive and `held` linked. S2's check | S2 takes 1's entry, ends T1 through E1's kill, reads it gone, then starts. On macOS the kill is today's route with the tracked set | both |
| X2 | S1 killed after f2.l and before f7.l, on macOS | `starting` with no `held`: a missing record, refused until another boot | both |
| X3 | S1 killed after b1 and before f2.l | Nothing of the dispatch started, so the tree is shown gone. S2 takes the entry, appends `attempt.cleared` where `attempt.starting` was appended, and links `ended`. An orphan of p1 is the residual's | both |
| X4 | S2 c4 fails | Refused. 1's entry is as it was | both |
| X5 | S2 d2, and a member outlives it | d7, d8. Refused: the first sign | both |
| X6 | S2 waits. s1 for 3. S3 b1. S2 c1 | S2 stands down: d8 where it holds a take, then x1. S3 waits for 2's `ended`, then takes 1's entry | E3 |
| X7 | S2 is killed while it holds 1's take. S3's check | S3 takes the next number of 1's entry, and shows 2's tree gone (X3) | E3 |
| X8 | S1 settles cleanly (h9.l) while S2 waits | S2 reads `ended` and starts | E3 |
| X9 | S1 g2 for a process it has just seen, as S2 announces | S1 is alive, so S1 alone ends T1, from its memory as well as its notes. `ended` follows | E3 |
| X10 | Two judges of one panel announce, look and start at once | Neither is earlier, so neither ends the other or waits for it | both |
| X11 | A judge of a panel is dispatched again while the panel's others run | It is in its own thread: it waits for that thread's earlier entry alone | both |
| X12 | R's r2 lists an entry that S1 ends at once (h9.l). R r5.l | R reads `ended` after its take, and acts on nothing; r12 | both |
| X13 | S1's t1 starts a descendant between S1's last read and its group's kill | No read could show it (`R-STATE-29`'s table): the residual, as S11 | both |
| X14 | Two supervisors a3.l at once | One link wins. The other reads it, and compares | both |

### A kill at each step

"As before" means the state is the one the step before it left. A kill during a read, a link, a
signal, an append or a `mkdir` is as the kill before it or the kill after it, because each takes
effect whole or not at all. That is judgment for each operating system ("Unmeasured claims").

| Step | Killed during or after it |
|---|---|
| a1 to a8 | Nothing of the attempt is on the host. A torn a3.w is a hidden file nobody opens. After a3.l, the pin stands, as X14 |
| b1 | X3 |
| c1 to c5, d3 | Reads change nothing. With no take held, X3. With one, X7 |
| d1.w | A hidden file. X3. **After d1.l:** X7 |
| d2 | T1 partly ended, the take held: X7 |
| d4 | The unit is gone and the entry stands. The next check reads the unit absent, and shows it gone: X7 |
| d5 | `attempt.cleared` is in the record and the entry stands: X7. The event is true, because d3 came first |
| d6.w, d6.l | Before the link, X7. After it, 1 is ended, and 2 is X3 |
| d7.w, d7.l | Before the link, the note is lost and the entry stands. The next check kills and reads again: X7, and X5 |
| d8.w, d8.l | Before the link, X7. After it, the entry is free to take |
| x1.w, x1.l | Before the link, X3. After it, 2 is ended |
| p1, p2 | X3, with the orphaned command the residual's |
| f1 | The event is in the record, with an entry and no `starting`: X3, whose check appends `attempt.cleared` |
| f2.w | X3. **After f2.l:** X2 on macOS, S9b elsewhere, though nothing may have started |
| f3 to f6 | X2 on macOS, S9b elsewhere. During f4, a process that has not yet run its command is as one that has |
| f7.w | X2, S9b. **After f7.l:** X1. Where a gate still holds the process, X1 ends it there |
| f8 | X1 |
| g1, g4 | X1. A descendant no read had yet shown is the residual's |
| g2.w, g2.l | Before the link, a descendant a dead engine never recorded: the residual (`R-STATE-29`'s table). After it, X1 ends it |
| g3.w, g3.l | Before the link, the read's failure is lost: the residual. After it, S10c |
| h1 to h3 | X1. The tree is partly ended |
| h4.w to h6.l | Before a link, X1, whose taker kills and reads again. After it, S10a or S10c |
| h7, h8 | The entry stands: X1, which finds nothing left |
| h9.w, h9.l | Before the link, as h8. After it, ended |
| h10, h11 | An older ended entry partly removed. h10 removes its `starting` before its `ended`, so what is left reads as X3 or as ended, and a higher order stands |
| j1 | Ended, or standing as S10a |
| ra2 to ra8, r2 to r4, r7 | With no take, nothing changed. With one, S7b |
| r5.w | Nothing. **After r5.l:** S7b |
| r6, r8 to r11 | S7b. After r11.l, ended |
| r12.w, r12.l | Before the link, S7b. After it, free to take |

### Orderings the tables leave out

| Ordering | Equivalent to, or why it changes nothing |
|---|---|
| Three or more attempts | Orders are total outside a panel. Each earlier attempt meets the newest as a pair does, and X6 and X7 are the triples in which a waiter is itself superseded |
| S1's steps a1 to a8 against any of S2's | S1 has announced nothing and started nothing. Its next step is b1, which is S3b or S4 |
| S1 before b1 against S2's whole life | S4a to S4c |
| S2's c1 between S1's b1 and c1 | S3a |
| S2 between any two of S1's f1 to f8 | S3a: S2 waits for 1's `ended` throughout |
| S2 between any two of S1's h1 to h9 | X8, and S2 acts only after `ended` or `settled` |
| S2 after S1's h6.l | S10a and S10c |
| S1's g1 to g3 against S2 | X9 |
| A panel sibling's b1 and f1 between S2's c2 and c1, or before both | X10: a sibling's entries and events are not earlier |
| R against S1 alive | S6a: R takes nothing |
| R against another R, or a check against a check | S7a: one link wins |
| R between any two of S2's check steps, on an entry of 1 | S7a or X12 |
| o1 between any two of S1's steps | "A kill at each step" |
| o2, o3 and k1, k2 against S2's check | S9b to S9d. Before S1's death they do not occur. After the members have ended they change nothing |
| o4 against a signal | Each signal follows a start time read while the process is stopped ("Failure model"), so a reused pid is S8b. A pid reused between that read and the signal cannot be the stopped process's |
| o5 against anything | S8a, S8e and S8f |
| t1 and t2 against any step of the check | A descendant a read shows is ended. One no read shows is S11 or X13. An exit only helps |
| s1 and s2 against any step | s1 is a1's other end. s2 changes nothing on the host |

## What it needs against ruling 3

Ruling 3 gives the PM's proposals on #1455 the amendments to `R-WORK-2` and `R-WORK-4` and the
proposal of `D11`'s successor.

- **`R-WORK-2`:** needed. "At most one actor mutates a card's board state or its workspace at any
  moment" has no words for a process that may be alive, nor for dispatches made together. The same-host
  proposal amends it.
- **`R-WORK-4`:** nothing. As it stands, it makes v0's one engine the only allocator of orders.
- **`D11`'s successor:** nothing, on one reading, which is **an open question for the owner**. `D11`
  rule 1 "builds no lease, no fencing token". The order here refuses no write and excludes no second
  engine. It says which of one host's attempts is later. Were the owner to read it as a fencing
  token, the same-host part would wait for the successor, which #1455 puts after #1474 and the go.

The design makes no departure from ruling 3. It assigns no row that ruling 3 gives E3.

## Where each part would live

| Part | Layer |
|---|---|
| The entry, its notes, the check, the take, the pin, and the refusal as an outcome of its own | L1, beside `src/execution/groups.mjs` and `src/execution/run.mjs`. The register and the pin become entry points of L1's under "Boundary rules", rule 4 |
| Ending a unit, reading the process table, the boot identity, start times and units | L0's process adapter, through E1's builds |
| The order, the panel and the thread; handing L1 the card's `attempt` events unread; the set-aside | L3. It reads the event record through L5's sink, as it does for a judge's failure ("Failure model") |
| What a refusal is, and what L2 answers | L2, as it classes every failure |
| The `attempt` events | L1's event family |
| The same parts under a Temporal worker | The E3 placement proposal, the planned line "Proposal (architect): where the side-by-side Temporal package lives" on #1456, not filed |

No extension point carries any of it, and no consumer declares anything.

## Proposed changes to `ARCHITECTURE.md` and the decisions

Each is a proposal for the owner, to be made in the delta #1455 plans. None is made here.

| Where | What would change |
|---|---|
| "The layers" | L1's and L3's rows gain the check, and the order |
| "Boundary rules" | Rule 2: what L3 hands L1 and L1 hands L2. Rule 4: L1's entry points |
| "Failure model", the entry of a group | It stays until its tree is shown gone. "A dispatch ends only once L0 has terminated the group's processes" disagrees with the settle of a process L0 could not end, and the delta says which holds |
| "Failure model", what the state directory holds | The register |
| "Failure model", the order of an attempt, the set-aside table and L2's classes | The check, and a refused attempt |
| "Failure model", "a start that cannot confirm" | The reap under a take, keeping an entry it could not end |
| "Telemetry" | `attempt.starting`, `attempt.cleared` and a refusal's event |
| "Budgets" | L1's row, if the check does not fit it. The package held 10,021 production lines against 12,000 (measured, `node scripts/package-budget.mjs`, this branch's merge of 3e325ab8, 2026-11-23) |
| `D11` | None, on the reading above |
| `D10` | None. The check continues no card, reattaches to no dispatch and reclaims no workspace |

**Open question for the owner:** "Failure model" says recovery machinery enters L1 only after a
recorded production incident. The design reads a refusal to start as no recovery.

## Requirements the PM's proposal may change

As input to it:

- `R-WORK-2`, as above. `R-WORK-12` is another one-actor row. Adding it to the same-host proposal
  waits for the owner ([1453#7107002907](https://github.com/williacj/rigger/issues/1453#issuecomment-7107002907)).
- `R-STATE-4`: the register, the pin and a card's highest order persist.
- `R-STATE-10`, `R-STATE-11`, `R-STATE-19` and `R-STATE-29`'s table, as "How the refusal fits today's
  rows" says.
- `R-STATE-26`, if a group read that listed nothing is a sign.
- `R-FAIL-8`'s table, and `R-FAIL-2`, whose "tried once more" a refusal must not spend.
- `R-ESCALATE-12`, if a refusal escalates.
- `R-STATE-28`: an exit past its budget keeps the entry, and that entry refuses until the next start
  ends what remains.

## Unmeasured claims, and the spike for each

| Claim | Question | Host | Measurement |
|---|---|---|---|
| Of two processes that each make a directory and then list, at least one sees the other | Does a list that starts after a `mkdir` returned always show it? | macOS on APFS, WSL2 on ext4, Windows on NTFS | Repeated races of two processes; the count in which neither saw the other |
| A link of one name has one winner, and a note is whole or absent after a kill | Do two links of one name ever both succeed, and can a killed writer leave a partial linked note? | The same three | Repeated races and kills; the count of each |
| v0's second attempt starts beside a survivor | Does a step that leaves an unkillable process, then fails, have its retry start beside it? | macOS | One run through a fixture, with the process table before and after |
| A boot identity changes at each boot and at nothing else | Does it hold across sleep, and change at a restart, at Windows' fast startup and at WSL's stop? | macOS, WSL2, Windows | The value before and after each |
| A process's start time reads the same for its life | Does a clock change or a sleep move it? | The same three | The read before and after a set clock and a sleep |
| A supervisor that is dead is read as dead, and a live one as alive | What does the table show of a killed worker, a zombie, a worker in another session, and an elevated one? | The same three | The read in each case |
| A listing finds every attempt: the pin refuses another account, container and register | Does each differ from the pin in what it compares? | macOS, WSL2 with a container, Windows | The compared values in each |
| A check ends within 120 s under load | How long do the check and an ending take at suite-level load? | macOS, WSL2 | The distribution over repeated runs |
| A gate's process exits when its supervisor dies, and something shows it gone | How long after, and by what read? | Linux, Windows, once E1 has a gate | The time, over repeated kills between start and release |
| A Windows job's members are gone once its last handle closes | Is there a moment when the name does not open and a member is alive? | Windows | Repeated kills with the name opened and the table read together |
| Reading the event record at each dispatch costs little | What share of a dispatch's start is that read, at the record's real size? | macOS | The read's time against the record's size |
| How often a sign arises, and so a stall | How many dispatches record a failed read or a process not ended? | Hosts running Rigger | The count over the event record, once #1466 and #1467 have merged |

## Results that would change it

| Result | How |
|---|---|
| #1458 finds no job for a non-elevated supervisor | Windows has no unit. It is then as macOS, and the Windows cells fall back with it |
| #1459 finds no delegated cgroup without a login session | Linux falls back to macOS's route for a worker run as a service |
| #1460 reports | It decides S9d, and what clears a missing record on Windows. Waiting |
| E1's macOS spike finds a whole-tree kill, or the double fork caught | macOS's tree becomes that unit, and the residual's first row shrinks |
| E1's real-agent spike finds an escape | That route joins the residual of that operating system |
| E1 makes no per-attempt record, or none that names a supervisor | The entry here must carry what it would have. Ruling 1's split would be ruled on again |
| E1 builds a gate on macOS | X2's stall shortens to S9b's |
| #1466 merges | The tracker's failed-read record is what an `unread` note takes. If it records a failed read a later read makes good, row 2's stalls follow assumption 5 |
| #1467 merges | Its entry's tracked set is what `tracked` takes. Its `recorded.unended` for a mismatch must be told from one for an unreadable start time, and the entry of a group not emptied must be kept |

## What would reverse it

- A listing shown to miss an announcement already made: the design would need a lock, with S8's
  holder question.
- A signal, a take or a link shown to act twice.
- Start times shown to change for a live process: "another start time" would no longer show a
  process gone, and only another boot would.
- Signs shown to arise so often that refused cards cost more than double starts do.
- An owner's ruling that a later attempt may start beside a tree the check found, which reverses the
  rulings this rests on.
- A second register for one repository on one host that the pin does not refuse.

## Out of scope

- **What any attempt writes to the forge**, on this host or another: #1474.
- **Building it**, and its requirement's rows: #1455.
- **E1's containment**, its record's form and its gate: #1454.
- **What the owner is shown, and what lets a refused card continue:** the PM's same-host proposal.
- **A way for a person to clear a sign.** The owner has not answered whether one exists.

## What it costs

- **A card can stall**, as the owner was told, and on a failed read it can stall with nothing to
  find.
- **A worker that is alive but stalled holds its card.** The check never ends a live supervisor's
  tree.
- **A listing a period, and a read of the event record per dispatch.**
- **Persistent state:** a register, a pin outside the state directory, and at least one ended entry
  per card.
- **Moving the repository or its state directory refuses every card**, because the pin names another
  register. Who may change the pin, and how, is **an open question for the owner**.
- **A later attempt that is refused still supersedes the earlier one**, which then ends its own tree.
- **E1 is a prerequisite** for Linux and Windows, as #1455 has it.

## What was opened

On the default branch at 3e325ab8, unless named: the requirement rows and decisions cited here; `AGENTS.md`;
`ARCHITECTURE.md`'s sections up to "Telemetry", "Budgets", and the parts of "Telemetry" that give
the sink, the torn tail and L0's call events; `src/execution/run.mjs` and `src/execution/groups.mjs`
whole; of `src/substrate/process.mjs`, the bounds, the containment and recorded-group functions and
the comments cited; of `src/scheduling/loop.mjs` and `src/workflow/next-action.mjs`, the claim, the
attempt, the judge and the failed-attempt code. #1429's report, whole. Of #1430's report: "The
answer", its Linux and Windows ending sections, "macOS, the baseline", "The table",
"Recommendations" and its open questions. The bodies of #1454, #1455, #1458 to #1461 (the opening of
#1458 to #1460), #1466, #1467 and #1474, and the linked comments, on 2026-11-23.

Not opened: the rest of "Telemetry"; the rest of the source; #1429's and #1430's evidence
directories and the rest of #1430's report; #1431's report; the M8 rulings behind `R-STATE-29`,
which are cited only as `ARCHITECTURE.md` gives them; `docs/v0-build-plan.md`; the pull requests of
#1458 to #1460 and #1466, for this revision; any documentation of an operating system or of
Temporal. Statements about those rest on judgment, and are marked so or listed as unmeasured.

Earlier revisions of this proposal said every citation was opened. That was not true: #1431's report
and the Windows ending section of #1430's had not been, nor all of `ARCHITECTURE.md`. Round 2 also
rested on #1460's unmerged report. Nothing here rests on that statement or on that report.

## Acceptance map

| Item, in the card's order | Where |
|---|---|
| 1, the guarantee | "The guarantee" |
| 2, how a later attempt establishes whether a tree is alive | "The order of a start", "One actor per tree" |
| 3, starts only where shown gone and no sign stands | "The guarantee", "The order of a start" |
| 4 and 5, attempts, earlier, and each pair of roles | "What counts as an attempt" |
| 6, seeing every attempt | "Seeing every attempt this host runs" |
| 7 and 8, each state, and the bound | "What each state answers", "The bound" |
| 9 and 10, the signs, and lost evidence | "The signs" |
| 11, the residual | "The residual" |
| 12 and 13, fitting today's rows, and admission | "How the refusal fits today's rows" |
| 14, identities | "How identities are told apart" |
| 15 and 16, who carries what, and a superseded supervisor | "Who carries which part", "One actor per tree" |
| 17 and 19, nothing cross-host, nothing of #1474's | "The answer", row S5, "Out of scope" |
| 18, the scheduler's properties | "What the check needs from whatever schedules attempts" |
| 20 to 24, actors, kills, rows, required rows, omissions | "The actors and their steps", "Interleavings" |
| 25, the dispatch model | the last column of each row's table |
| 26, ruling 3 | "What it needs against ruling 3" |
| 27 to 29, placement, `ARCHITECTURE.md` and decisions, requirements | The three sections of those names |
| 32 and 33, unmeasured claims, and results that would change it | The two sections of those names |
| 34 and 35, figures, and reversal | Where each figure stands; "What would reverse it" |
