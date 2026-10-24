<!-- ABOUTME: The operating reference: where to look up each fact a person running Rigger needs, as links to
the documents that own it, and a short FAQ. -->

# Rigger reference

This reference is where you look a fact up while you operate Rigger. The [guide](guide.md) is how
you operate it, in order, and each section here links to its matching section there. This page
retypes none of the facts it points to: each section names the document that owns its fact, and
that document is the one to read. A part marked **Placeholder** is behaviour a later card writes;
it names that card.

## Verbs

The verbs, in order, with what each does, are the list in [`README.md`](../README.md#install-and-usage),
"Install and usage". That list is the CLI contract. How the verbs fit a working day is the guide's
[daily operation](guide.md#daily-operation).

## Config keys

Every key a consumer can set, and its shape, is declared in
[`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points): the table, and the
paragraphs below it that give each key's form. The order you set them in is the guide's
[setup](guide.md#setup).

## Board columns and labels

- **Columns.** Their display names are declared in the "Engine settings" row of
  [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points).
- **Kind and epic labels.** The consumer declares them, in the form the "Kinds of work" row of
  [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) gives.
- **The escalation label.** It is named in
  [`ARCHITECTURE.md`, "Escalation"](../ARCHITECTURE.md#escalation), and `D27` in
  [`docs/spec/decisions.md`](spec/decisions.md) records why it exists and who removes it.

What a card's column or labels tell you when it seems stuck is the guide's
[troubleshooting](guide.md#troubleshooting).

## Escalation categories and destinations

The categories are fixed by Rigger, and a consumer adds none (`R-ESCALATE-13`). The
"Escalation categories" row of [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points) names them, and
`R-ESCALATE-19` in [`docs/spec/requirements.md`](spec/requirements.md) defines what each one
covers. How you answer one is the guide's [answering escalations](guide.md#answering-escalations).

> **Placeholder.** Destinations: where each category goes, and how a consumer names it. Written by
> M6-19 and M6-20a.

## The marker vocabulary

Two places in `ARCHITECTURE.md` own this vocabulary, and this page retypes neither:

- **Markers.** [`ARCHITECTURE.md`, "The gate"](../ARCHITECTURE.md#the-gate), under
  ["Markers"](../ARCHITECTURE.md#markers).
- **Verdicts.** The "Verdict vocabulary" row of
  [`ARCHITECTURE.md`, "Extension points"](../ARCHITECTURE.md#extension-points).

Where markers sit in the loop is the guide's [how the loop works](guide.md#how-the-loop-works).

## FAQ

What Rigger is, at length, is the guide's [what Rigger is](guide.md#what-rigger-is).

**Can the agent that made a change also approve it?** No. No judge is the maker, and no
configuration removes that separation (`R-LOOP-3`).

**Does a new commit, or an edited acceptance, undo a verdict?** Yes, for the gate. It counts a
verdict only where it ruled on the work being merged and against the card's current acceptance
(`R-GATE-7`).

**Where does Rigger keep a card's state?** On the board. Rigger persists no card workflow state of
its own (`R-STATE-1`).

**What happens to a card no kind of work selects?** Rigger never pulls it, never reports it as
refused, and leaves it on the board (`R-SCHED-11`).

**Does Rigger store my credentials?** No. It uses the ones you have already given its tools
(`R-SAFE-1`).
