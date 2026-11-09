// ABOUTME: Checks census retention at a skipped mid-exec first read using an injected clock and authored responses.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Authored responses and independent return oracles for the two bounded census controls.
import { CENSUS_CASES as CASES, bindProcessProof, driveCensus, encodeObserved } from './process-proof-fixture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error('606 source guard: ' + reason); };
const guard = (condition, reason) => { if (!condition) fail(reason); };
// A recorded run names its frozen manifest here; otherwise ordinary capture binds the working bytes.
// The authored inputs are the helper's bytes, so a manifest needs no Node to state their digest.
const manifestPath = process.env.RIGGER_606_STRICT_MANIFEST;
const strictRequest = manifestPath === undefined ? {} : { strict: {
  manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  runtime: { path: process.execPath, version: process.version, platform: process.platform, arch: process.arch,
    binarySha256: digest(readFileSync(process.execPath)) },
  inputSha256: digest(readFileSync(new URL('./process-proof-fixture.mjs', import.meta.url))),
  readGitFacts: 'native',
} };
const binding = await bindProcessProof(new URL('../src/substrate/process.mjs', import.meta.url).href,
  { fail, guard, ...strictRequest });
const { census } = await binding.importProduct();
after(() => binding.checkSources());
const sourceHeader = JSON.stringify({ closure: binding.closure });
const sourceHeaderSha256 = digest(sourceHeader);
// The proof tools keep only a digest of stdout, so a recorded run also keeps originals in its receipt root.
const emit = line => {
  process.stdout.write(line);
  if (manifestPath !== undefined) appendFileSync(join(process.env.RIGGER_606_NATIVE_RECEIPT_ROOT, 'case-originals.jsonl'), line);
};
const CENSUS_ORIGINAL = '606_CENSUS_ORIGINAL ';
const writeOriginal = line => emit(CENSUS_ORIGINAL + JSON.stringify({ sourceHeaderSha256,
  ...JSON.parse(line.slice(CENSUS_ORIGINAL.length)) }) + '\n');
emit('606_SOURCE_HEADER ' + sourceHeader + '\n');

const drive = row => driveCensus(row, census, { writeOriginal });

test('606 census: REPAIR-CENSUS-SKIPPED-SIGHTING-MAP', () => {
  const row = CASES[0];
  const { value, observed, counters } = drive(row);
  emit(CENSUS_ORIGINAL + JSON.stringify({
    sourceHeaderSha256,
    id: row.id,
    authored: { yields: row.yields, clock: row.clock, expectedMembers: row.expectedMembers, expectedSightingsEntries: row.expectedSightingsEntries },
    observed,
    actual: encodeObserved(value),
    counters
  }) + '\n');
  assert.deepEqual(value.members, row.expectedMembers);
  assert.ok(value.sightings instanceof Map);
  assert.deepEqual([...value.sightings.keys()], row.expectedSightingsEntries.map(([pid]) => pid));
  assert.deepEqual(value.sightings.get(41001), row.expectedSightingsEntries[0][1]);
  assert.equal(value.sightings.has(41002), true);
  assert.equal(value.sightings.get(41002), undefined);
});

test('606 census: REPAIR-CENSUS-MALFORMED-C1-NO-PARTIAL-RETURN', () => {
  assert.deepEqual(drive(CASES[1]), { threw: true });
});

test('606 census: REPAIR-CENSUS-TRUSTED-C1-C2-ETIMEDOUT', () => {
  drive(CASES[2]);
});

test('606 census: REPAIR-CENSUS-TRUSTED-C2-C3-ETIMEDOUT', () => {
  drive(CASES[3]);
});

test('606 census: REPAIR-CENSUS-TRUSTED-C4-C5-ETIMEDOUT', () => {
  drive(CASES[4]);
});

test('606 census: REPAIR-CENSUS-TRUSTED-C1-C2-LATE', () => {
  drive(CASES[5]);
});

test('606 census: REPAIR-CENSUS-LATER-MALFORMED-NO-PARTIAL-RETURN', () => {
  drive(CASES[6]);
});

test('606 census: REPAIR-CENSUS-NONBUDGET-REFUSAL-NO-PARTIAL-RETURN', () => {
  drive(CASES[7]);
});

test('606 census: REPAIR-CENSUS-NO-LAST-ETIMEDOUT-THROWS', () => {
  drive(CASES[8]);
});
