<!-- ABOUTME: Records why this repository uses maker-dependent judge providers while the starter config remains consumer-neutral. -->

# Judge providers in this repository

Card #682 applies the P39 provider rule to this repository's L4 config. The engineer role reads
`maker:codex`; each agent judge's provider follows the maker through its entry's map. The owner
entries remain plain names. The starter template keeps its Claude-only roles and judge names, so
consumers choose their own provider policy.

The init comparison now checks every planned `.claude/` asset and leaves the repository's live
config and hooks out of that comparison. Its byte-change test keeps the comparison sensitive to
an asset edit on either side. Doctor checks both CLI authentication answers against the live
config. The maker's two baseline failures and their open root-cause cards are recorded on #682;
neither failure led to a change outside this card's acceptance.
