<!-- ABOUTME: Records the measured Claude Code folder name and the dispatch-scoped sweep for card #629. -->

# Card #629: Claude Code session folder

Claude Code 2.1.303 saved a large Bash result under a folder named from the dispatch's real working directory. The live long-path run in `test/claude-folder-live.test.mjs` measured a name with a 200-character sanitized prefix and a base-36 suffix. Reading the installed 2.1.303 binary showed that the suffix is the absolute value of a signed 32-bit Java string hash of the real path. The adapter now names that folder and the home selected by `CLAUDE_CONFIG_DIR` or `HOME`.

L1 lists that one folder before L0 starts the command. After L0 settles, it removes only paths absent from the listing, checks the listed directory's real path, device and inode before removal, and does not follow symbolic links. A refusal leaves the CLI folder untouched and names the reason on `dispatch.end`. This preserves entries from an earlier session whose path collides with the new one.

The live Read probe on 2.1.303 measured a 353 KB file refused without `allow_large` and a clipped inline result with it. Neither result named a saved file. The live Bash and directory MCP probes did name saved files. The gated tests record those observations and check the projects folder and the former `/tmp` route after each dispatch.

In a later 2.1.303 run, the CLI rotated `backups/.claude.json.backup.1792445531427` to `backups/.claude.json.backup.1792445954172` while the configuration home was listed. The live assertion permits only that measured removal pattern; the stand-in test leaves a backup file with that name unchanged while sweeping F. The final gated run also passed against Claude Code 2.1.304.
