ABOUTME: Spike findings for card #212 on which ways of adding a Status option through `gh` keep
every item's Status value.

# Adding a Status option through `gh`

## Question and method

Card #212 asks which ways of adding an option to a Projects v2 board's `Status` field through `gh`
keep every card's column. #235 (M1-21) needs the answer before it adds `Owner` to board 6. This
report hands over evidence; it changes no code, requirement or recorded decision.

I ran everything on 2026-09-24 on macOS with `gh version 2.99.0 (2026-09-01)`, against a throwaway
board the owner allowed under U13. Board 6 was never read or written. The throwaway scripts stay
under the gitignored `/spikes/` directory and are not in this pull request.

## Token and writes

Before any write, `gh auth status` printed this for the token in use:

```
github.com
  ✓ Logged in to github.com account williacj (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'project', 'read:org', 'repo', 'workflow'
```

Before creating the board, I listed every write on #212
([comment](https://github.com/williacj/rigger/issues/212#issuecomment-5826717280)). The writes
below are all the writes made, and each falls inside that list:

- two comments on #212, one before the board existed and one after it was deleted;
- `gh project create`, `gh project item-create` for nine draft items, and `gh project item-edit`
  to set or restore their `Status`;
- the four ways under test, A to D, with way B run twice;
- `gh project delete`;
- the push of this branch and the pull request.

## The throwaway board

It was **project 7**, titled **`THROWAWAY rigger#212 spike - delete me`**.

```
$ gh project create --owner williacj --title "THROWAWAY rigger#212 spike - delete me" --format json
{"closed":false,"fields":{"totalCount":13},"id":"PVT_kwHOBzomGc4Bkn7f","items":{"totalCount":0},"number":7,"owner":{"login":"williacj","type":"User"},"public":false,"readme":"","shortDescription":"","title":"THROWAWAY rigger#212 spike - delete me","url":"https://github.com/users/williacj/projects/7"}
```

The new board's `Status` field was `PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc`, with the default options
`Todo` (`f75ad846`), `In Progress` (`47fc9ee4`) and `Done` (`98236657`). All items were draft
issues made with `gh project item-create 7 --owner williacj --title <title>`. Each had its
`Status` set with `gh project item-edit --id <item> --project-id PVT_kwHOBzomGc4Bkn7f --field-id
PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc --single-select-option-id <option>`.

```
$ gh project delete 7 --owner williacj --format json
{"closed":false,"fields":{"totalCount":13},"id":"PVT_kwHOBzomGc4Bkn7f","items":{"totalCount":9},"number":7,"owner":{"login":"williacj","type":"User"},"public":false,"readme":"","shortDescription":"","title":"THROWAWAY rigger#212 spike - delete me","url":"https://github.com/users/williacj/projects/7"}
$ gh project view 7 --owner williacj
GraphQL: Could not resolve to a ProjectV2 with the number 7. (user.projectV2)
```

After the delete, `gh project list --owner williacj` listed only projects 6, 3, 2 and 1.

## How each reading was taken

Every reading comes from two `gh` reads, taken after the write had returned:

- `gh project item-list 7 --owner williacj --format json`, which gives each item's title and
  `status` name;
- `gh api graphql` over the project's items, which gives each item's `Status` value as
  `fieldValueByName(name:"Status") { name optionId }`.

The two reads agreed in every reading below. The option list came from
`gh project field-list 7 --owner williacj --format json`.

## The ways tried

| Way | Command | What `gh` returned | Option added? |
|---|---|---|---|
| A | `gh project field-create 7 --owner williacj --name Status --data-type SINGLE_SELECT --single-select-options "Todo,In Progress,Done,Owner"` | `GraphQL: Name cannot have a reserved value, Name has already been taken (createProjectV2Field)`, exit 1 | No |
| B | `gh api graphql -F query=@way-b.graphql`: `updateProjectV2Field` with every existing option **with its `id`**, plus the new option without one | exit 0; the existing option ids unchanged and one new id | Yes |
| C | `gh api graphql -F query=@way-c.graphql`: `updateProjectV2Field` with every existing option by name, colour and description **without an `id`**, plus the new option | exit 0; **every** option given a new id | Yes |
| D | `gh project field-delete --id PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc`, then `gh project field-create 7 --owner williacj --name Status --data-type SINGLE_SELECT --single-select-options "Todo,In Progress,Done,Owner,Parked,Review"` | `GraphQL: Only custom fields can be deleted. (deleteProjectV2Field)` exit 1; then the same error as A, exit 1 | No |

`gh project` has no subcommand that edits an existing field (`gh project --help` lists
`field-create`, `field-delete` and `field-list` only). So A and D are the only `gh project field-*`
routes, and both are refused for `Status`.

The mutation way B sent the first time:

```graphql
mutation {
  updateProjectV2Field(input: {
    fieldId: "PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc"
    singleSelectOptions: [
      {id: "f75ad846", name: "Todo", color: GREEN, description: "This item hasn't been started"}
      {id: "47fc9ee4", name: "In Progress", color: YELLOW, description: "This is actively being worked on"}
      {id: "98236657", name: "Done", color: PURPLE, description: "This has been completed"}
      {name: "Owner", color: RED, description: "Waiting on the owner"}
    ]
  }) { projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } }
}
```

Way C sent the same shape with no `id` on any option, and added `Parked`. Way B's second run
passed the five options with their ids, inserted `Review` between `In Progress` and `Owner`, and
also moved `Owner` ahead of `Done`, which is where board 6's config puts it.

The schema documents the `id` input. Introspecting `ProjectV2SingleSelectFieldOptionInput` gives
`id` this description: "The ID of an existing single select option. Include this to preserve the
option's identity during updates, preventing item field values from being cleared." The
`singleSelectOptions` input says "provided values overwrite existing options". Both input fields
`color` and `description` are non-null, so a caller must send each existing option's colour and
description back to keep them.

## Readings

Each row is `title: Status (optionId)`. Before every write, each option then on the board held at
least one item. The `nostatus-1` item was created with no `Status`, and the board's default
workflow set it to `Todo` on arrival. It counts as a `Todo` item.

**Way A.** Options before: `Todo`, `In Progress`, `Done`.

| Item | Before | After |
|---|---|---|
| todo-1 | Todo | Todo |
| todo-2 | Todo | Todo |
| nostatus-1 | Todo | Todo |
| prog-1 | In Progress | In Progress |
| prog-2 | In Progress | In Progress |
| done-1 | Done | Done |
| done-2 | Done | Done |

Every item kept its column, and the option list was unchanged. The write was refused, so nothing
was added.

**Way B, first run.** Options before: `Todo` (`f75ad846`), `In Progress` (`47fc9ee4`), `Done`
(`98236657`). After: the same three ids and `Owner` (`484ad454`).

| Item | Before | After |
|---|---|---|
| todo-1 | Todo (f75ad846) | Todo (f75ad846) |
| todo-2 | Todo (f75ad846) | Todo (f75ad846) |
| nostatus-1 | Todo (f75ad846) | Todo (f75ad846) |
| prog-1 | In Progress (47fc9ee4) | In Progress (47fc9ee4) |
| prog-2 | In Progress (47fc9ee4) | In Progress (47fc9ee4) |
| done-1 | Done (98236657) | Done (98236657) |
| done-2 | Done (98236657) | Done (98236657) |

Every item kept its column, and its option id too. A re-read gave the same values.

**Way C.** Before this run I added `owner-1` in `Owner`. Options before: `Todo` (`f75ad846`),
`In Progress` (`47fc9ee4`), `Done` (`98236657`), `Owner` (`484ad454`). After: `Todo`
(`1fcd5b3b`), `In Progress` (`d3a29731`), `Done` (`a5a7fb44`), `Owner` (`157fdb29`), `Parked`
(`331b72d7`).

| Item | Before | After |
|---|---|---|
| todo-1 | Todo (f75ad846) | no Status |
| todo-2 | Todo (f75ad846) | no Status |
| nostatus-1 | Todo (f75ad846) | no Status |
| prog-1 | In Progress (47fc9ee4) | no Status |
| prog-2 | In Progress (47fc9ee4) | no Status |
| done-1 | Done (98236657) | no Status |
| done-2 | Done (98236657) | no Status |
| owner-1 | Owner (484ad454) | no Status |

Every item lost its column. A re-read gave the same values. The options kept their names but were
given new ids, and no item points at them.

**Way D.** Before this run I put every item back in its column under the new ids with `gh project
item-edit`, and added `parked-1` in `Parked`. Options before: `Todo` (`1fcd5b3b`), `In Progress`
(`d3a29731`), `Done` (`a5a7fb44`), `Owner` (`157fdb29`), `Parked` (`331b72d7`).

| Item | Before | After |
|---|---|---|
| todo-1 | Todo (1fcd5b3b) | Todo (1fcd5b3b) |
| todo-2 | Todo (1fcd5b3b) | Todo (1fcd5b3b) |
| nostatus-1 | Todo (1fcd5b3b) | Todo (1fcd5b3b) |
| prog-1 | In Progress (d3a29731) | In Progress (d3a29731) |
| prog-2 | In Progress (d3a29731) | In Progress (d3a29731) |
| done-1 | Done (a5a7fb44) | Done (a5a7fb44) |
| done-2 | Done (a5a7fb44) | Done (a5a7fb44) |
| owner-1 | Owner (157fdb29) | Owner (157fdb29) |
| parked-1 | Parked (331b72d7) | Parked (331b72d7) |

Every item kept its column, and the option list was unchanged. Both writes were refused, so
nothing was added.

**Way B, second run.** Options and items before are way D's "After" column. After, the options
were: `Todo` (`1fcd5b3b`), `In Progress` (`d3a29731`), `Review` (`87ecd56c`), `Owner`
(`157fdb29`), `Done` (`a5a7fb44`), `Parked` (`331b72d7`). Every item's "After" value equals its
way D "After" value above, option id included. Every item kept its column, including the one in
`Owner`, whose option moved position.

## Conclusion

**Way B keeps every item's column.** It is `gh api graphql` with `updateProjectV2Field`, sending
every existing option with its `id`, name, colour and description, plus the new option without an
`id`. It added an option and kept every item's `Status` option id in both runs, once appending
and once inserting mid-list.

Way C adds the option but clears every item's `Status`. Ways A and D are refused for `Status` and
add nothing.

## What #235 should do, and must not assume

The steps for #235:

1. Read the `Status` field's options with their `id`, `name`, `color` and `description`.
2. Send `updateProjectV2Field` with all of them, each with its `id`, plus `Owner` without one.
3. Read every item's `Status` option id before the write and again after it, and fail on any
   difference.

What #235 must not assume:

- **That `gh project field-*` can add an option.** It cannot, for `Status`.
- **That a name match preserves identity.** Way C shows it does not: an option sent without its
  `id` is a new option, even under the same name.
- **That omitting an option is harmless.** I did not test dropping an existing option from the
  list. The `singleSelectOptions` description says provided values overwrite existing options.
- **That a read straight after a write shows it.** See the incidental finding below.
- **That colour and description survive when they are left out.** Both are required inputs, so
  the caller must echo them back.

I did not settle whether the result holds for items that are issues or pull requests rather than
draft issues. Board 6 holds issues, and every item here was a draft issue. The values live on the
project item whatever its content, so I expect the same result, but that is a judgment and not a
measurement. #235's before-and-after check on board 6 would settle it on the real board.

## What would reverse this

The conclusion reverses if any item's `Status` option id differs after a way-B write, in either
of two places:

- a rerun of way B, on this `gh` and API version or a later one;
- #235's own before-and-after check on board 6.

That reading would mean the `id` input no longer preserves identity, or does not preserve it for
issue items.

## Incidental finding

A read straight after a write sometimes missed it, on two occasions:

- Just after `nostatus-1` was created, `gh project item-list` returned six items, not seven. The
  next call returned seven, with `nostatus-1` in `Todo`.
- Just after `owner-1` was created and set to `Owner`, the GraphQL items read did not include it.
  The next call did.

So the Projects v2 read-back after a write is eventually consistent here. A board client that
verifies a write by reading straight back can see a stale board. That matters for #235's
before-and-after check and for any M1 read that follows a claim. I did not chase it further. It is
named here and in the pull request for the coordinator to file, because the brief bars makers from
filing cards.
