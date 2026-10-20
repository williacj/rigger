<!-- ABOUTME: Records why card #827 corrects ARCHITECTURE.md's claims about required-context pins and what doctor checks. -->

# Card #827: the required-context pins

`ARCHITECTURE.md` said every required context on `main` is pinned to the gate App's id, and that `doctor` reads each one's pin against `GATE_APP_ID`. Neither held. The pin read taken at 2026-10-20T13:03:54Z with `gh api` shows four required contexts: `rigger/gate` and `self-hosting` pinned to 5291719, which is `GATE_APP_ID`'s value, and `check (20)` and `check (24)` pinned to GitHub Actions' integration, 15368. Classic protection on `main` answered 404, "Branch not protected".

The reason for the change is the owner's ruling U17, decision D (#816), which holds that the `check` jobs' pin to 15368 is right and that the document must say what the pins are. Ruling K33 (#740) places the forge-check sentences of "The required check on the forge" and the `doctor` paragraph within that decision. No reason of this card's own is offered for 15368 being acceptable for the `check` jobs.

`src/cli/doctor.mjs` keeps only `rigger/gate` from the effective rules, so the `doctor` paragraph now names that context alone as the one it checks.
