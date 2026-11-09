// ABOUTME: Checks the two authored synchronous EX decisions through an injected host and independent read/signal model.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EX_CAUSAL_CASES, bindProcessProof, createExCausalModel, encodeObserved } from './process-proof-fixture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error('606 source guard: ' + reason); };
const sourceGuard = (condition, reason) => { if (!condition) fail(reason); };
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
  { fail, guard: sourceGuard, ...strictRequest });
// One binding covers both cases; a distinct file-URL query gives each its own module state.
const products = await binding.importProduct(async specifier => Object.fromEntries(await Promise.all(
  EX_CAUSAL_CASES.map(async ({ id }) => {
    const url = new URL(specifier);
    url.searchParams.set('606-proof-case', id);
    return [id, await import(url.href)];
  }))));
after(() => binding.checkSources());
const sourceHeader = JSON.stringify({ closure: binding.closure });
const sourceHeaderSha256 = digest(sourceHeader);
// The proof tools keep only a digest of stdout, so a recorded run also keeps originals in its receipt root.
const emit = line => {
  process.stdout.write(line);
  if (manifestPath !== undefined) appendFileSync(join(process.env.RIGGER_606_NATIVE_RECEIPT_ROOT, 'case-originals.jsonl'), line);
};
emit('606_SOURCE_HEADER ' + sourceHeader + '\n');

async function run(row) {
  const records = [];
  let begun = false;
  const record = (event, fields = {}) => records.push({ ordinal: records.length + 1, event, ...encodeObserved(fields) });
  const guard = (condition, reason) => assert.ok(condition, '606 fixture guard: ' + reason);
  const equal = (one, other) => JSON.stringify(encodeObserved(one)) === JSON.stringify(encodeObserved(other));
  const model = createExCausalModel(row, { record, guard, equal, isBegun: () => begun });
  const { containNow } = products[row.id];
  record('ready', { case: row.id, model: model.model });
  begun = true;
  record('go', { case: row.id });
  const actual = containNow(41001, {
    readTimeout: 5000,
    host: {
      ps: '606-controlled-ps',
      spawnSync: model.raw,
      signal: model.kill,
      clock: {
        now: model.now,
        pause: () => assert.fail('unexpected synchronous EX host.clock.pause'),
        schedule: () => assert.fail('unexpected synchronous EX host.clock.schedule'),
        cancel: () => assert.fail('unexpected synchronous EX host.clock.cancel'),
      },
    },
  });
  const { expected, ...observedModel } = model.complete(actual);
  record('guard.success', observedModel);
  emit('606_CONTAIN_NOW_ORIGINAL ' + JSON.stringify(encodeObserved({
    sourceHeaderSha256, case: row.id, authored: row, observed: records, actual, expected, counters: observedModel,
  })) + '\n');
  assert.deepEqual(actual, expected);
}

// proves R-STATE-26
test('606 containNow: SITE-EX-F0-X-Z', async () => {
  await run(EX_CAUSAL_CASES[0]);
});

// proves R-STATE-26
test('606 containNow: EDGE-EX-AQ-NEWPID-B0-omitted-reaped', async () => {
  await run(EX_CAUSAL_CASES[1]);
});
