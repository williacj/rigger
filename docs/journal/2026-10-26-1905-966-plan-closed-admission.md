ABOUTME: Journal for #966: the "Failure model" admission paragraph names what `plan` answers
under a closed or an unreadable admission.

# #966 — `plan` under a closed or unreadable admission

#940 added four sentences to "Failure model"'s admission paragraph, and the only verbs they name
are `once` and `run`. Under a closed admission those verbs name each closer and exit 0. Under an
unreadable one the verb exits non-zero naming each unreadable path. The paragraph named `plan` only
as reading the directory through the module before it prints. #962 built `plan`'s answer, and its
attack (962#6416985847) noted that adding `plan` to the paragraph is a one-clause `structure`
delta.

The delta adds `plan` beside the `once` and `run` sentences and leaves those sentences as they
were. Under a closed admission, `plan` names each closer's kind, reason and time. A closed
admission is no failure of `plan`, which exits as it would with admission open. Under an
unreadable admission, `plan` names each unreadable path and its cause, and exits non-zero.

The paragraph bounds where `plan` still reports refusals and escalated cards, following findings
1 and 2 of this card's attack (966#6430227835). At `db1243d`, `src/cli/plan.mjs` exits 1 and
reports no refusal where the config, the board or a card's facts cannot be read, whatever the
admission. So the sentence says `plan` reports them where it reads the board and each card's
facts, and the exit sentence compares with admission open rather than saying exit 0.

The paragraph cites `R-SCHED-18` for what `plan` must show and does not restate it. It says
nothing of how a closer's reason is escaped. That attack ruled escaping is the CLI's presentation,
which `src/cli/doctor.mjs` owns, and the ruling binds this card and #981. `doctor` stays out of
scope; `R-SCHED-17` binds it.
