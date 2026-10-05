ABOUTME: Journal for #618: the architect's one-card review, its routing test, and the binding
home for a requirement row's dimensions table.

# #618 — the acceptance review has an owner and a routing test

The architect owns placement across cards, but an acceptance review examines one card before
dispatch. The role prompt now names that occasion separately and limits placement rulings from
it to questions shared by two or more cards. The architect returns missing cells and unbounded
absolutes to the card's author; the author keeps the acceptance.

The filer now chooses the reviewing agent from the card body. An item depending on a system
outside Rigger's code or the named conditions in "Lands in" selects the architect. Otherwise the
reviewer is the second agent. This uses the card's two stated dimensions directly, so no filer
has to guess whether a card is a "process, filesystem or structure card."

A dimension table left in a proposal pull request disappears as binding text after merge. The
requirements preamble therefore gives the ratified table a place below its group's row table,
with the row's id in its heading. It binds and retires with the row. Moving a cell in or out of
scope changes what must be true, so the row takes a new id.

At base `c621e7e`, `npm run budget:instructions` measured 14,538 live words against 14,600.
The test-first budget assertion failed because it read 14,600 where #618 proposes 15,000. The
architect's budget delta is limited to that sentence in `ARCHITECTURE.md`; the owner's merge
ratifies it.
