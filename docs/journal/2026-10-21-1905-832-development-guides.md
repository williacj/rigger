<!-- ABOUTME: Records the owner-approved README links to repository development and test setup. -->

# Repository development and testing entry point

The owner explicitly approved expanding #832/#835 on 2026-10-21 to clarify the README
and link both setup guides. The card author recorded that scope and acceptance before
editing the README. The paragraph directs repository developers to the macOS guide or
the experimental Windows/WSL guide and separates Ubuntu-on-WSL-2 testing from engine
installation and the supported engine-host promise. The Node minimum remains unchanged.

The guides were opened to verify their stated procedures before writing the links.
The preceding source head 82d748c5c5bbbf3a58a61df28e82643a8fae2fcf passed the normal
Linux hook with 4,004 tests: 3,952 passed, zero failed, zero cancelled and 52 skipped
(570,620.863926 ms, measured by the Node test runner). This documentation change uses
the normal commit hook again. Its result, current-head macOS CI and fresh configured
independent verdicts must be recorded in the PR before the merge handoff.

Previous verdicts are stale after this source and acceptance amendment. The owner will
supply their own marker later; this work writes no owner evidence and performs no merge.
