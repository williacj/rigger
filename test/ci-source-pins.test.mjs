// ABOUTME: Holds each repository file ci.yml's host startup check fingerprints equal to the SHA-256 the
// check pins for it, and the stand-in startup fixture's fingerprints for those files equal to the pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ci, startupInspectionFixture } from './ci-host-fixtures.mjs';

// Harness diagnostics, so no `// proves`: no row of docs/spec/requirements.md describes ci.yml's host
// startup qualification (#1323). The pins are read from the check's own source, the CI_HOST module in
// ci.yml, which holds their only copy.
const declared = ci.env.CI_HOST.match(/const projectSources = (\{[^}]*\});/);
const projectSources = declared ? JSON.parse(declared[1]) : {};

// Break: a source edit that removes or renames projectSources would leave the loop below with nothing to check.
test("ci.yml's host startup check declares a SHA-256 pin for each repository file it fingerprints", () => {
  assert.ok(declared, "ci.yml's CI_HOST module declares projectSources");
  assert.ok(Object.keys(projectSources).length > 0, 'projectSources names at least one repository file');
  for (const [path, pin] of Object.entries(projectSources)) assert.match(pin, /^[0-9a-f]{64}$/, `${path} is pinned to a SHA-256`);
});

// Break: a pinned file changed without its re-pin leaves full_host with no qualified startup and no
// host key, so check (26) fails for every pull request after it (#1323, CI run 42558570287).
// Oracle: node:crypto's SHA-256 of the file's bytes in this tree, against the pin as ci.yml writes it.
for (const [path, pin] of Object.entries(projectSources)) {
  test(`${path} hashes to the SHA-256 ci.yml's host startup check pins for it`, () => {
    const actual = createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
    assert.equal(actual, pin, `${path} differs from the SHA-256 ci.yml's host startup check accepts for it; re-pin it in projectSources in .github/workflows/ci.yml`);
  });
}

// Break: a second copy of the pins in the stand-in fixture agrees with tests whatever ci.yml accepts,
// which is how the drift went unnoticed (#1323).
test("the stand-in startup fixture fingerprints each pinned repository file with the value ci.yml accepts", () => {
  const { cwd, fingerprints } = startupInspectionFixture();
  for (const [path, pin] of Object.entries(projectSources)) {
    assert.equal(fingerprints.get(join(cwd, path)), pin, `the fixture's fingerprint for ${path} differs from ci.yml's pin`);
  }
});
