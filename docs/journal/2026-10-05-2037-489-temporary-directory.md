ABOUTME: Journal for #489 (M4-14): why every Codex session now gets a writable temporary directory
in its scratch directory, and the architecture exception that allows it (O93).

# #489: a temporary directory for every Codex session

**What failed.** In the owner's live run at `3cd7ab6`, the judge's here-document failed with
"can't create temp file for here document: operation not permitted". The same command line then
posted an empty `--body-file`, so the fake forge got an empty comment ahead of the real findings.
In production that would be an empty comment on a real pull request.

**Cause, measured with zsh 5.9 on the owner's host, no agent CLI run.** zsh writes a here-document
under `$TMPPREFIX`, `/tmp/zsh` unless set. `TMPDIR` plays no part:
- `TMPDIR=/nonexistent` left a heredoc working;
- `TMPPREFIX=/nonexistent/zsh` broke it.

Our declaration excludes `/tmp` and `$TMPDIR` from the sandbox, as #489's item requires. So every
Codex session Rigger starts had no writable temporary directory.

**Why it needed the owner.** `ARCHITECTURE.md` allowed the adapter one widening of the consumer's
sandbox, a reached directory. A writable temporary directory was a second one. The owner chose it
as O93. The architect wrote the two-exception text, and #583 carries it verbatim.

**What the adapter does.** It makes `tmp` in the role's scratch directory and names it with
`--add-dir`. It sets `TMPDIR` to it, and `TMPPREFIX` to `tmp/zsh` inside it, so zsh's files land
inside the directory and not beside it. `test/provider-codex.test.mjs` proves this two ways, with
no CLI:
- through the invocation;
- through L1 with the stand-in `codex`, where L1 hands the variables over a `TMPDIR` the caller set.

The live run shows whether a heredoc then works under the sandbox.

**Three more O93 tests.** The PM's amendment asked for a stand-in writing a file in the directory,
two dispatches getting two directories, and the directory lying in no worktree. One guarded mutation
per test, each run on that test alone, reds it, and each was restored byte-exact:
- dropping `TMPDIR` from the env: the file was not in the directory (ENOENT);
- one shared directory beside the scratch directories: `notEqual` failed;
- the directory inside the working directory: "lies in a worktree".

The stand-in that writes is a shell `codex` ahead of the shared stand-in. It writes under its
`TMPDIR`, then hands the run on, so the shared stand-in is unchanged.
