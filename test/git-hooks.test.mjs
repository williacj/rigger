// ABOUTME: The hooks `.githooks/` holds: that every git operation this repository refuses with a
// red suite has the hook git runs for that operation, and that each hook reaches the one script
// holding the check rather than carrying a copy of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(repository, '.githooks');

/** The one script the suite check lives in, which every hook reaches rather than restating. */
const SHARED = 'refuse-if-suite-red';

/** The line every hook is, read off `.githooks/pre-commit` by hand rather than composed here. */
const DELEGATION = `exec "$(dirname "$0")/${SHARED}"`;

/**
 * Each git operation this repository refuses with a red suite, against the hook git runs for it.
 *
 * `git commit` runs `pre-commit` and `git push` runs `pre-push`, but a `git merge` that commits
 * runs neither: it runs `pre-merge-commit`, so for as long as this repository held no hook of
 * that name a merge commit was the one commit that reached a branch unchecked (card #165). The
 * operations are named rather than counted, so a hook that goes missing is reported by what it
 * stopped gating rather than by a number.
 */
const GATED = {
  'git commit': 'pre-commit',
  'git merge': 'pre-merge-commit',
  'git push': 'pre-push',
};

/** What a hook says, with its shebang, its header and its blank lines taken out. */
const body = (name) => readFileSync(join(hooks, name), 'utf8')
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'))
  .join('\n');

test('every git operation this repository gates has the hook git runs for it', () => {
  // The defect this catches is the one card #165 fixes: an operation that creates a commit while
  // no file under `.githooks/` carries the name git looks for, so nothing runs and the commit
  // lands. It names the operations left ungated rather than asserting a directory listing,
  // because a hook `.githooks/` gains for some other reason is no failure here.
  const held = readdirSync(hooks);
  assert.deepEqual(
    Object.entries(GATED).filter(([, hook]) => !held.includes(hook)).map(([operation]) => operation),
    [],
  );
});

test('every hook reaches the shared suite check rather than restating it', () => {
  // Read over every file `.githooks/` holds and not only the three above, because a second copy
  // of the check is a defect whatever the file is called. The equality is byte-exact on purpose:
  // a hook checked out with CRLF fails on its own shebang, which is what `.gitattributes` pins
  // `.githooks/*` to LF for, so a line ending that arrived here is a finding too.
  const restated = readdirSync(hooks)
    .filter((name) => name !== SHARED && body(name) !== DELEGATION);
  assert.deepEqual(restated, []);
});
