<!-- ABOUTME: Records the G8 assertion correction after card 1466's Linux CI exposed a tracked scratch survivor. -->

# Card 1466 — scratch survivor recorder

CI run 45117327212's fast job 137503130064 failed the role-dispatch
scratch-survivor event assertion. Its L0 survivor.killed event named the correct
pid, dispatch d-role and card 1412, but carried no directory. The tracker can
end that descendant before the directory sweep. The complete failed output is
retained in 1466-ci-fast-failed.log in the external codex-1466-tmp directory.

The author revised acceptance to K7 f5f416c9b828 and granted G8 on
1466#issuecomment-7092670382. The assertion now requires exactly one L0 event
for the pid with the required event, dispatch and card. If the event carries a
directory, it must equal the scratch directory's real path. The fixture, title,
not-alive check and all other assertions remain unchanged.

The complete affected role-dispatch file passed after the correction, retained
as 1466-g8-role-green.log. The per-path consumer search and whole-head
scratch-event search are retained as 1466-g8-consumer-audit.txt and
1466-g8-directory-event-search.txt. No additional dependency needs an edit.
Final-head verification and head CI are recorded in PR #1475. Item 27 remains
pending the owner's ci:full sequence; no label or merge is performed here.
