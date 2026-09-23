ABOUTME: A journal entry from card #90: The flaky test was not flaky

## 2026-09-22 — The flaky test was not flaky

Five agents touched the engine-floor install test in `test/package.test.mjs` before this card.
Two watched it red in the full suite and green in isolation, two ran it thirteen times between
them and never saw it red, and the two who saw it reached for different mechanisms: npm cache
contention under `node --test`, and something about nesting the suite under `npm run`. No report
isolated either one, so the cause was still open when the card was filed.

It was never intermittent. On a clone of `main` at `dc8bf6b`, on this host, `npm test` passed
six of six, `npm test --silent` failed six of six, and bare `node --test` passed. The variable
was the invocation, not the machine and not the moment.

npm exports its own config into the environment of a script it runs, as `npm_config_*`. Three
spellings put `npm_config_loglevel=silent` there — `--silent`, `-s` and `--loglevel=silent` —
and each does it before or after the script name alike. `node --test` passes the environment to
the test file, the test file passes it to a child `npm install`, and that child reads the
inherited variable as its own configuration: it still refuses on the engine check and still
exits 1, and it prints nothing on either stream. The assertion then matched a regular expression
against an empty string.

Nothing was lost in transit. The same install writing to a real file rather than a pipe printed
the same zero bytes, and npm recorded the refusal in its debug log in the silent run exactly as
in the loud one. npm had produced its answer and been told not to say it. Load had nothing to do
with it either: sixty-four of these installs at concurrency thirty-two, with the environment
clean, all printed the refusal in full.

The reason five agents disagreed is that each was reading a different question. An agent asking
"is this host red?" runs whatever it habitually runs, and the habit differs between agents. A
flake report carries the failure and the count and drops the command, so the one variable that
decided the outcome was the one nobody wrote down.

What the test now does is name `--loglevel=error` on the install's own command line, where npm
ranks the command line above the environment. What holds that is a second test running the same
install with `npm_config_loglevel=silent` injected, so npm answers whether the command line wins
rather than the test assuming it. Before the one-token fix that second test failed with exactly
the flake's message — `actual: ''` against `/EBADENGINE|Unsupported engine/`.

Mutating the manifest to check the test could still fail turned up something else. The fixture
overwrites `engines.node` with the raised floor whatever the manifest said, so setting
`engines.node` to `*` cannot red the install test — it reds the test above it, the one that
reads the floor out of the manifest and the README and compares them. The install test proves
that `engine-strict` refuses below a declared floor, and it is the test above that holds what
the declared floor is. Neither covers the pair alone, and reading either as if it did would
mistake what the file proves.

The repository already had the shape this needed. `test/package-budget.test.mjs` strips
`NODE_TEST_CONTEXT` out of the environment before it spawns a nested test run, with a comment
saying why, because an inherited variable changes what the child does. That is the same hazard
one variable along, and the install test had not been read as a case of it.
