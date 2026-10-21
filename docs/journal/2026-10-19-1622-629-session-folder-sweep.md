<!-- ABOUTME: Records the measured Claude Code folder name and the dispatch-scoped sweep for card #629. -->

# Card #629: Claude Code session folder

Claude Code 2.1.303 saved a large Bash result under a folder named from the dispatch's real working directory. The live long-path run in `test/claude-folder-live.test.mjs` measured a name with a 200-character sanitized prefix and a base-36 suffix. Reading the installed 2.1.303 binary showed that the suffix is the absolute value of a signed 32-bit Java string hash of the real path. The adapter now names that folder and the home selected by `CLAUDE_CONFIG_DIR` or `HOME`.

L1 lists that one folder before L0 starts the command. After L0 settles, it removes only paths absent from the listing, checks the listed directory's real path, device and inode before removal, and does not follow symbolic links. A refusal leaves the CLI folder untouched and names the reason on `dispatch.end`. This preserves entries from an earlier session whose path collides with the new one.

The live Read probe on 2.1.303 measured a 353 KB file refused without `allow_large` and a clipped inline result with it. Neither result named a saved file. The live Bash and directory MCP probes did name saved files. The gated tests record those observations and check the projects folder and the former `/tmp` route after each dispatch.

In a later 2.1.303 run, the CLI rotated `backups/.claude.json.backup.1792445531427` to `backups/.claude.json.backup.1792445954172` while the configuration home was listed. The live assertion permits only that measured removal pattern; the stand-in test leaves a backup file with that name unchanged while sweeping F. The final gated run also passed against Claude Code 2.1.304.

The revision's gated sessions on Claude Code 2.1.306 list every direct entry under `<home>/projects/` before the session and after its recorded end. The over-limit linked-path session on the base source left one new entry in that listing; the same session on the head left none. A refusal before L1 can list the folder now records why no sweep ran. The default test suite creates a disposable Claude home and rejects a folder listing outside its temporary root, so stand-in dispatches cannot reach the owner's home through the sweep.

The next review found that the suite stopped making that home when the live flag was set, and that the guard belonged in the test harness rather than L1. The suite now makes its home with either flag value. Its preloaded test-side audit refuses and records a listing outside the suite's temporary root before a file read; the gated live file explicitly selects the owner's configuration home. The audit test itself does not claim `R-WORK-31`, because refusing a listing does not prove that a sweep removed a session's files. The live cell and the stand-in removal cells retain that proof claim.

The other gated Claude live files also select the owner's configuration home. The test-side audit recognizes each `test/*-live.test.mjs` worker when the live flag is set; the audit test checks that exception and keeps the non-gated refusal.
