ABOUTME: Journal for #631: the push hook reads the remote's default branch before it lets the
suite check run, and the command gate refuses literal pushes to that branch early.

# #631 — default-branch pushes stop at the push hook

Git gives `pre-push` the remote ref for each update after resolving refspecs and push
configuration. The hook reads the remote's local HEAD and compares that name with each remote
ref. This keeps the refusal in one place for `push.default`, configured refspecs, matching pushes,
and commands whose earlier shell steps changed the current directory or branch.

Where the local remote HEAD is absent, the hook has no default name to compare. It refuses the
whole push and points to `git remote set-head <remote> -a`. A URL push has no named remote HEAD to
read and follows the same rule. The check reads a local ref and the lines Git supplied; it makes
no network request.

The PreToolUse hook refuses a direct command whose literal refspec names the default branch, when
its payload supplies a working directory and the local remote HEAD is readable. It steps aside on
commands whose target requires Git to resolve earlier shell work or configuration. The push hook
still sees the resolved updates before any suite check or remote mutation.

The test fixture uses a bare remote and clone under `TMPDIR`. It replaces the suite check in that
temporary hook directory with a marker, so a refused push proves the suite was not reached and a
permitted push proves it was. The bare repository's refs prove the remote stayed unchanged on
refusal and moved on permission.
