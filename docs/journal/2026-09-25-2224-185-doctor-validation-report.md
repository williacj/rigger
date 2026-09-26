<!-- ABOUTME: Records why doctor must contain exceptions raised while validating a consumer config. -->

# #185 — Report validation exceptions

`doctor` already reported exceptions raised while importing a consumer config. Validation runs
consumer-supplied getters and can itself throw, so an import-only guard let that exception escape
before the report was written. The board-sharing check validated the same config again and could
throw after the config validity check recovered.

The config validity check now reports the first line of a validation exception as a failed check.
The board-sharing check skips its read when validation cannot establish a usable config. A command
test covers both a BigInt default export and a throwing `repo` getter, including the report's
lines, streams, exit status, and absence of a board request.
