ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A test that passed on the runtime's error message, not on ours

The event sink's reader refuses a torn line and names it. The test for that asserted `/line 1/`
and passed the moment it was written, which should have been the tell. What it matched was V8's
own JSON message, `Unterminated string in JSON at position 45 (line 1 column 46)`, and the line
V8 names is the line inside the fragment it was handed rather than the line in the stream.

So the assertion agreed with the runtime by coincidence. It would also have gone red on CI's
Node 20 leg, where the same failure reads `Unexpected end of JSON input` and names no line at
all. The fix was to give the reader its own message, naming the file and the line, and to assert
that text. A test whose expected value can be produced by something other than the code under
test is worth re-reading, even when it fails first for the right reason.

Five of the eleven tests here passed as soon as they were written, because the minimal code for
the first test already covered what they asked. Each was then checked by breaking the sink on
purpose — writing instead of appending, spreading the layer's fields ahead of the envelope,
appending asynchronously — and every one of them went red. That is cheap, and it is the only
thing that separates a test which holds a behaviour from one that describes it.

What the sink guarantees is smaller than "durable". Appends are synchronous, so a process killed
outright loses no event that had already returned, and that is measured by killing one. Nothing
is flushed to the disk, so power loss can still lose the tail, and two writers are not something
this code has been measured against.

## 2026-09-22 — The lint arrived after the corpus, and the corpus barely cleared it

Writing `spec-style-lint` against documents already written showed how little headroom the
sentence ceiling has: the longest sentence the lint reads is 39 words against a ceiling of 40.
The next compound sentence anyone writes into the README or the register reds the build.

Two of the four register rules turned out to be unlintable, and the reason is worth keeping.
Rule 3 asks whether an actor is genuinely unknown and rule 4 asks whether a structure fits its
meaning. Both are judgments about intent, and a lint that guessed at either would file findings
an author has to argue with rather than fix.

The sentence splitter asks the word after a full stop whether the stop ended a sentence, and it
is wrong both ways. A lowercase word keeps two sentences joined, as `v0 buys` does, and the
count comes out high. A capital after an abbreviation splits one sentence into two, the way
`e.g. Rigger` does, and the count comes out low.

The second of those cost a review round, because this entry first claimed it could not happen.
A bias in a check is worth disclosing, and a bias described as absent is worse than one nobody
mentioned: a reader then draws a conclusion the check cannot support. A green lint says no
sentence the splitter reads is past the ceiling, which is narrower than it sounds.

## 2026-09-22 — A guarantee that was only a convention

A test declares what it proves in a `// proves R-GROUP-#` comment, and the tool that builds the
test matrix reads those out of the test sources. Its own tests hand it fixture sources, so a
scan matching anywhere on a line would read every fixture as a claim by the file quoting it.
Anchoring a declaration to a whole line answers that for a fixture written as a single-line
string, which is every fixture this repository had, and three documents went on to state it as a
property of the scanner. It was a convention the fixtures kept. A fixture written as a template
literal spanning lines, and a call commented out under a live declaration, each produced a matrix
naming a test that did not exist, and neither said a word. Closing those brought the lesson round
again from the other side: the block-comment state added with them read a marker inside a string
as a marker, and dropped every declaration after it in silence. A missing claim reads like an
honest gap, which is worse than a false one in the document meant to tell them apart. What the
scan cannot read it now refuses by name, and the little it still cannot see is written down
beside it rather than claimed away.

## 2026-09-22 — A generated document and CRLF

The test matrix is compared with what its tool writes, byte for byte. Git hands a Windows
working tree CRLF and the tool writes LF, so on Windows the check called a freshly written file
stale. `.gitattributes` pins `docs/derived/` to LF, the way it already pins the hooks. Any
generated document that lands there inherits the pin.

