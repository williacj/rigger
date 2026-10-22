<!-- ABOUTME: Records card 872's proposal that admission skip every entry whose name starts with a dot. -->

# Admission skips dot-files

[#872](https://github.com/williacj/rigger/issues/872) proposes a delta to `ARCHITECTURE.md`,
"Failure model", the admission paragraph. The base read "Every file in it but a temporary file is
a closer", so a `.DS_Store` that Finder leaves in `.rigger/admission/` was an unreadable closer,
and one Finder visit stopped every pull. The architect's pre-dispatch attack on #869 found this as
W2 ([#869 c6341940013](https://github.com/williacj/rigger/issues/869#issuecomment-6341940013)).
The owner ruled it in U28
([#740 c6341920341](https://github.com/williacj/rigger/issues/740#issuecomment-6341920341)): a
name starting with `.` is not a closer and is skipped, and any other unreadable file still reads
as closed.

## What changed

- An entry whose name starts with `.`, whatever its type, is not a closer, and no reader opens it.
  The temporary file `.tmp-<id>` (K40) falls under that rule rather than being a named exception.
- Every other entry is a closer, so an entry of no closer form is still an unreadable closer. The
  safe direction the paragraph already had is kept for every name a person or tool might leave
  that does not start with `.`.
- "No closer file exists" became "no closer exists", because a closer is now any entry and not
  only a file. A directory named `foo` in `.rigger/admission/` would otherwise be a closer that
  left admission open.

## What it costs

A closer can no longer be hidden from the engine by a dot-prefixed name, which is the point. The
cost is that a person who copies a closer under a dot name, expecting it to hold admission,
finds admission open. Nothing in the architecture writes such a name except the temporary file.
