ABOUTME: A journal entry from card #35: A test that passed on the runtime's error message, not on ours

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
