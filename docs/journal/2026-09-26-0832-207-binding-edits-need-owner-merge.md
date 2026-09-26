ABOUTME: Why the pre-M5 merge rule now reserves authored binding-document edits for the owner.

# Binding edits need the owner's merge

Card #207 identified a route from a `type:change` card to an unratified binding edit. The
`change` kind names only a reviewer, while D19 allowed its maker to merge after the configured
judges were sound. The register preambles say only the owner's merge ratifies a proposal.

The owner chose a process rule until M5. A card changing an authored document in `AGENTS.md`'s
"What binds" table now needs a kind whose judges include `owner`, and only the owner merges it.
A card that changes none of those documents keeps its existing judges and merge route.

D22 supersedes D19 because it narrows D19's maker permission. D21's references to that live
permission now point to D22; its rule about the owner's merge has not changed. This proposal
adds no product requirement: it governs sessions working in this repository.

The rule is carried by the sessions and the owner before M5. A pre-M5 pull request has no trusted
receipt tying it to the card and kind whose judges would authorize the merge. The M5 gate must
settle that boundary, as D21's deferred table already requires.
