ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A guarantee that was only a convention

A test declares what it proves in a `// proves R-GROUP-#` comment, and the tool that builds the
test matrix reads those out of the test sources. Its own tests hand it fixture sources, so a
scan matching anywhere on a line would read every fixture as a claim by the file quoting it.
Anchoring a declaration to a whole line answers that for a fixture written as a single-line
string, which is every fixture this repository had, and three documents went on to state it as a
property of the scanner. It was a convention the fixtures kept. A fixture written as a template
literal spanning lines, and a call commented out under a live declaration, each produced a matrix
naming a test that did not exist, and neither said a word. A scan now refuses by name what it
cannot read, and what it still cannot see is written down beside it instead of claimed away.

## 2026-09-22 — A generated document and CRLF

The test matrix is compared with what its tool writes, byte for byte. Git hands a Windows
working tree CRLF and the tool writes LF, so on Windows the check called a freshly written file
stale. `.gitattributes` pins `docs/derived/` to LF, the way it already pins the hooks. Any
generated document that lands there inherits the pin.
