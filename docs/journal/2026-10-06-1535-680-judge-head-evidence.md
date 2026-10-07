ABOUTME: Records the round-two evidence corrections for card #680's judge instruction and live test.

# Judge command evidence after review

Round-one review found that two tests matched a command and its location in separate parts of the instruction. A judge could have read the diff in `head`, or used `cd ../head; <command>`, while those tests stayed green. The appended assertions bind each command to its location or one-line shape. Guarded m3 and m5 mutations now fail their respective tests. Removing the separate-call rule also fails a test for shell status probes and substitutions.

The live test now requires an actual successful `tool_result` for the diff and rejects every Bash permission denial. Its teardown inventories the session's encoded `~/.claude/projects/` directory, removes it, and checks that every path it found is absent. Three runs at the head on Claude Code 2.1.292 passed; none created a path there. A guarded base-instruction run failed because it produced no successful Bash diff with both pull request SHAs.

The PR's older Node 20 directory-census failure belongs to #611. The earlier PR body linked #615, which addresses other process-census cases.
