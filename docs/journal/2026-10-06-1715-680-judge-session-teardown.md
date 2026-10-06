ABOUTME: Records the failed-session teardown fix and host cleanup for card #680.

# Judge session teardown after incomplete output

Round-three review found that the gated judge test registered its cleanup only after parsing Claude's output. A missing result record gave it no session id, and a malformed line could throw before teardown existed. Two stand-in runs reproduced surviving `session-env/<id>` directories in a private home under `TMPDIR`.

The test now registers teardown before starting Claude. It reads the first session id in the returned stream even if another line is malformed, removes paths named by that id, and checks them after removal. A run with no usable id fails explicitly. Birth-time inspection of unrelated paths follows deletion and tolerates a path another session removed meanwhile.

Four empty `session-env/` directories from the maker's round-one live runs were removed by their recorded full ids with `rmdir`; each was confirmed absent. The PR records those paths and the verification output.
