// ABOUTME: Shared literal CI source fixtures and in-process evaluation of the workflow's actual policy.
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Literal Git/API contract fixture: a synthetic merge of known B and H, with a fresh PR read. */
export function ciFacts() {
  return {
    event: 'pull_request', action: 'synchronize', ref: 'refs/pull/7/merge', owner: 'williacj', sender: 'contributor',
    eventSha: 'a'.repeat(40), complete: true,
    main: { head: 'c'.repeat(40), defaultBranch: 'main' },
    checkout: { sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)] },
    pr: { number: 7, head: 'd'.repeat(40), base: 'c'.repeat(40), testedBase: 'c'.repeat(40), baseRef: 'main', state: 'open', draft: false },
    live: { head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', state: 'open', draft: false, labels: [] },
    changes: [{ status: 'A', oldMode: '000000', newMode: '100644', path: 'docs/journal/a.md' }],
  };
}

export function ciProof(mode = 'FAST_ELIGIBLE') {
  return {
    mode, demoNeeded: false, sourceValid: true,
    source: { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', eventBase: 'c'.repeat(40) },
    results: { plan: 'success', fast: 'success', full_ordinary: 'skipped', full_host: 'skipped', demo: 'skipped', cancel_superseded: 'success' },
  };
}

/** Owner full request and complete results, independent literal source identities from ciProof. */
export function ciFullFixture() {
  const facts = ciFacts();
  Object.assign(facts, { action: 'labeled', sender: 'williacj', label: 'ci:full' });
  facts.live.labels = ['ci:full']; facts.changes[0].path = 'test/package-budget.test.mjs';
  const proof = ciProof('BROAD_EXECUTED'); proof.results.full_ordinary = proof.results.full_host = 'success';
  return { facts, proof };
}

/** Literal receipt contract: full proof binds candidate identity, keeping synthetic SHA as provenance. */
export function ciFullReceiptFixture() {
  const { facts, proof } = ciFullFixture();
  facts.repository = { id: 42, fullName: 'williacj/rigger' };
  facts.pr.id = 7001;
  facts.workflow = { id: 9130, path: '.github/workflows/ci.yml', blob: 'f'.repeat(40) };
  facts.run = { id: 4101, attempt: 2, event: 'pull_request', actor: 'williacj' };
  const receipt = {
    schema: 1,
    origin: { runId: 4101, attempt: 2, event: 'pull_request', actor: 'williacj', action: 'labeled', label: 'ci:full' },
    candidate: {
      repositoryId: 42, repository: 'williacj/rigger', prId: 7001, prNumber: 7,
      workflowId: 9130, workflowPath: '.github/workflows/ci.yml', workflowBlob: 'f'.repeat(40),
      head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', tree: 'b'.repeat(40),
      parents: ['c'.repeat(40), 'd'.repeat(40)],
      profile: { ordinary: true, host: true, demo: false },
    },
    checkout: { sha: 'a'.repeat(40), eventSha: 'a'.repeat(40) },
  };
  return { facts, proof, receipt };
}

/** Actual Actions REST-shaped completed owner run and per-attempt jobs, not a preverified flag. */
export function ciReuseFixture() {
  const { facts, receipt } = ciFullReceiptFixture();
  Object.assign(facts, { action: 'edited', sender: 'contributor', eventSha: 'e'.repeat(40) });
  delete facts.label;
  facts.checkout.sha = 'e'.repeat(40);
  facts.run = { id: 4102, attempt: 1, event: 'pull_request', actor: 'contributor' };
  const proof = ciProof('BROAD_DEFERRED');
  proof.source.sha = 'e'.repeat(40);
  proof.reuse = {
    receipt,
    run: {
      id: 4101, run_attempt: 2, workflow_id: 9130, path: '.github/workflows/ci.yml',
      event: 'pull_request', status: 'completed', conclusion: 'success', actor: { login: 'williacj' },
      repository: { id: 42, full_name: 'williacj/rigger' }, head_sha: 'd'.repeat(40),
      pull_requests: [{ id: 7001, number: 7, head: { sha: 'd'.repeat(40) }, base: { ref: 'main', sha: 'c'.repeat(40) } }],
    },
    jobs: { total_count: 7, jobs: ['plan', 'fast', 'full_ordinary', 'full_host', 'cancel_superseded', 'check (26)', 'demo'].map((name, at) => ({
      id: 5100 + at, run_id: 4101, run_attempt: 2, name, status: 'completed', conclusion: name === 'demo' ? 'skipped' : 'success',
    })) },
  };
  return { facts, proof };
}

export function ciCollectorFixture() {
  const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40);
  const git = {};
  for (const [args, output] of [
    [['rev-parse', 'HEAD'], a + '\n'],
    [['rev-parse', 'HEAD^{tree}'], b + '\n'],
    [['show', '-s', '--format=%P', 'HEAD'], c + ' ' + d + '\n'],
    [['diff', '--raw', '-z', '--no-renames', c, a], ':000000 100644 0000000 1234567 A\0docs/journal/a.md\0'],
  ]) git[JSON.stringify(args)] = Buffer.from(output).toString('base64');
  return {
    context: { eventName: 'pull_request', ref: 'refs/pull/7/merge', sha: a, repository: 'williacj/rigger', owner: 'williacj' },
    event: {
      action: 'synchronize', number: 7, sender: { login: 'contributor' },
      repository: { full_name: 'williacj/rigger' },
      pull_request: { head: { sha: d }, base: { sha: c, ref: 'main' }, state: 'open', draft: false },
    },
    git,
    api: {
      '/repos/williacj/rigger': { full_name: 'williacj/rigger', default_branch: 'main', owner: { login: 'williacj' } },
      '/repos/williacj/rigger/pulls/7': { number: 7, head: { sha: d }, base: { sha: c, ref: 'main' }, state: 'open', draft: false, labels: [] },
      '/repos/williacj/rigger/git/ref/heads/main': { object: { sha: c } },
      '/repos/williacj/rigger/issues/7/labels?per_page=100': [],
    },
  };
}

/** Repository, PR and current attempt identities are literal Actions REST responses. */
export function ciRunCollectorFixture() {
  const fixture = ciCollectorFixture();
  Object.assign(fixture.context, { runId: '4102', runAttempt: '1' });
  fixture.api['/repos/williacj/rigger'].id = 42;
  fixture.api['/repos/williacj/rigger/pulls/7'].id = 7001;
  fixture.api['/repos/williacj/rigger/actions/runs/4102/attempts/1'] = {
    id: 4102, run_attempt: 1, workflow_id: 9130, path: '.github/workflows/ci.yml', event: 'pull_request',
    actor: { login: 'contributor' }, repository: { id: 42, full_name: 'williacj/rigger' }, head_sha: 'd'.repeat(40),
    pull_requests: [{ id: 7001, number: 7 }],
  };
  fixture.git[JSON.stringify(['rev-parse', 'HEAD:.github/workflows/ci.yml'])] = Buffer.from('f'.repeat(40) + '\n').toString('base64');
  return fixture;
}

/**
 * The YAML a workflow file in this repository is written in, parsed: block mappings and block
 * sequences by indentation, plain, single- and double-quoted scalars, flow sequences of scalars,
 * literal block scalars (`|`), and comments on lines of their own. Anything else is refused, naming
 * the line, so a file this reads wrongly fails rather than passes. Every scalar is a string.
 */
export function parseWorkflow(text) {
  const lines = text.split('\n').map((line, at) => ({ at: at + 1, text: line, indent: line.length - line.trimStart().length }));
  let next = 0;
  const content = () => {
    while (next < lines.length && (lines[next].text.trim() === '' || lines[next].text.trim().startsWith('#'))) next += 1;
    return lines[next];
  };
  const refuse = (line, why) => {
    throw new Error(`line ${line.at}, ${JSON.stringify(line.text)}: ${why}`);
  };
  const scalar = (raw, line) => {
    const value = raw.trim();
    if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) refuse(line, 'an unclosed single-quoted scalar');
      return value.slice(1, -1).replaceAll("''", "'");
    }
    if (value.startsWith('"')) {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) refuse(line, 'an unclosed double-quoted scalar');
      return JSON.parse(value);
    }
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) refuse(line, 'a flow sequence on more than one line');
      const inner = value.slice(1, -1).trim();
      return inner === '' ? [] : inner.split(',').map((item) => scalar(item, line));
    }
    if (/^[{&*!%@`]/.test(value)) refuse(line, 'a form this reader does not read');
    return value;
  };
  const literal = (indent) => {
    const held = [];
    let block = null;
    while (next < lines.length && (lines[next].text.trim() === '' || lines[next].indent > indent)) {
      const line = lines[next];
      if (line.text.trim() !== '') block ??= line.indent;
      held.push(line);
      next += 1;
    }
    while (held.length > 0 && held.at(-1).text.trim() === '') held.pop();
    return `${held.map((line) => line.text.slice(block ?? 0)).join('\n')}\n`;
  };
  const entry = (rest, line, indent, into) => {
    const pair = /^([A-Za-z0-9_-]+):(?: (.*))?$/.exec(rest);
    if (!pair) refuse(line, 'not `key: value`');
    const [, key, value] = pair;
    if (Object.hasOwn(into, key)) refuse(line, `the key ${key} is given twice`);
    if (value === undefined || value.trim() === '') into[key] = block(indent);
    else if (value.trim() === '|') into[key] = literal(indent);
    else into[key] = scalar(value, line);
  };
  const block = (parent) => {
    const first = content();
    if (first === undefined || first.indent <= parent) return null;
    const indent = first.indent;
    if (first.text.trimStart().startsWith('- ')) {
      const items = [];
      for (let line = content(); line !== undefined && line.indent === indent && line.text.trimStart().startsWith('- '); line = content()) {
        next += 1;
        const rest = line.text.trimStart().slice(2);
        if (/^[A-Za-z0-9_-]+:(?: |$)/.test(rest)) {
          const item = {};
          entry(rest, line, indent + 2, item);
          for (let more = content(); more !== undefined && more.indent === indent + 2; more = content()) {
            next += 1;
            entry(more.text.trimStart(), more, indent + 2, item);
          }
          items.push(item);
        } else items.push(scalar(rest, line));
      }
      const stray = content();
      if (stray !== undefined && stray.indent > parent && stray.indent !== indent) refuse(stray, 'indented as no sibling of the sequence above');
      return items;
    }
    const map = {};
    for (let line = content(); line !== undefined && line.indent === indent; line = content()) {
      next += 1;
      entry(line.text.trimStart(), line, indent, map);
    }
    const stray = content();
    if (stray !== undefined && stray.indent > parent && stray.indent !== indent) refuse(stray, 'indented as no sibling of the mapping above');
    return map;
  };
  const parsed = block(-1);
  if (content() !== undefined) refuse(content(), 'left unread');
  return parsed;
}

const source = parseWorkflow(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')).env.CI_POLICY;
assert.equal(typeof source, 'string', 'the protected workflow has no inline CI_POLICY');
const hadAction = Object.hasOwn(process.env, 'CI_POLICY_ACTION');
const savedAction = process.env.CI_POLICY_ACTION;
let policy;
try {
  delete process.env.CI_POLICY_ACTION;
  policy = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
} finally {
  if (hadAction) process.env.CI_POLICY_ACTION = savedAction;
  else delete process.env.CI_POLICY_ACTION;
}

/** Calls actual inline exports; collector collaborators accept only literal recorded answers. */
export async function evaluateCiPolicy(operation, facts, extra = {}) {
  if (operation === 'collect') {
    const calls = [];
    const answer = await policy.collect({
      event: facts.event, context: facts.context,
      run: (args) => { const key = JSON.stringify(args); calls.push(args); if (!Object.hasOwn(facts.git, key)) throw new Error('unexpected Git command ' + key); return Buffer.from(facts.git[key], 'base64'); },
      request: async (path) => { if (!Object.hasOwn(facts.api, path)) throw new Error('unavailable API page'); return facts.api[path]; },
    });
    return { answer, calls };
  }
  if (['discoverFullProof', 'readReceiptZip', 'downloadArtifact', 'requestJson'].includes(operation)) return policy[operation](facts, extra);
  if (['policy', 'guard', 'runPolicy'].includes(operation)) return policy[operation](facts, extra);
  throw new Error('unsupported in-process CI operation ' + operation);
}

/** Literal Python zipfile nonseekable-stream ZIP: flag 3 plus signed data descriptor.
 * Expected UTF-8 payload is exactly {"schema":1} (12 bytes), CRC32 0x89fbc18c.
 * One regular Unix 0100644 ci-full-proof.json: local header 0, data 48..61,
 * signed descriptor 62..77, central directory 78..141, EOCD 142..163, no trailing bytes.
 * Standard streaming ZIP form used by upload-artifact@v7 archiver:
 * https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/upload/zip.ts
 * https://github.com/archiverjs/node-compress-commons/blob/master/lib/archivers/zip/zip-archive-output-stream.js
 * Descriptor rules: PKWARE APPNOTE 6.3.10 sections 4.3.9 and 4.4.4.
 */
export const ciArtifactZip = 'UEsDBBQACAAIAAAAXV0AAAAAAAAAAAAAAAASAAAAY2ktZnVsbC1wcm9vZi5qc29uq1YqTs5IzU1UsjKsBQBQSwcIjMH7iQ4AAAAMAAAAUEsBAhQDFAAIAAgAAABdXYzB+4kOAAAADAAAABIAAAAAAAAAAAAAAKSBAAAAAGNpLWZ1bGwtcHJvb2YuanNvblBLBQYAAAAAAQABAEAAAABOAAAAAAA=';

/** Independent APPNOTE single-entry format; native deflater/CRC supplies valid collaborator bytes, never policy expectations. */
export function ciBudgetArchive({ expandedBytes, archiveBytes, declaredExpanded }) {
  let size = expandedBytes ?? archiveBytes - 350;
  for (let attempt = 0; attempt < 4; attempt++) {
    const payload = Buffer.from('{"data":"' + 'x'.repeat(size - 11) + '"}');
    assert.equal(payload.length, size);
    const archive = ciArchiveBytes(payload, { level: archiveBytes ? 0 : 6, declaredExpanded });
    if (!archiveBytes || archive.length === archiveBytes) return { archive, expanded: size, textLength: size - 11 };
    size += archiveBytes - archive.length;
  }
  throw new Error('independent byte-boundary fixture could not establish its premise');
}

/** The ZIP layout comes from APPNOTE; payloads and expected decisions are supplied independently by each fixture. */
function ciArchiveBytes(payload, { level = 6, declaredExpanded = payload.length } = {}) {
  const compressed = deflateRawSync(payload, { level });
  const base = Buffer.from(ciArtifactZip, 'base64'), checksum = crc32(payload);
  const descriptor = Buffer.from(base.subarray(62, 78)), central = Buffer.from(base.subarray(78, 142)), end = Buffer.from(base.subarray(142));
  descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(declaredExpanded, 12);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredExpanded, 24);
  end.writeUInt32LE(48 + compressed.length + 16, 16);
  return Buffer.concat([base.subarray(0, 48), compressed, descriptor, central, end]);
}

/** Literal Actions discovery/detail/artifact/job collaborators; ZIP contains the independently specified receipt. */
export function ciDiscoveryFixture(defect = 'usable', supplied = ciReuseFixture()) {
  const { facts, proof } = supplied;
  const { receipt, run, jobs } = proof.reuse;
  if (defect === 'candidate-mismatch') receipt.candidate.head = '0'.repeat(40);
  if (defect === 'host-failed') jobs.jobs.find((job) => job.name === 'full_host').conclusion = 'failure';
  const archive = ciArchiveBytes(Buffer.from(JSON.stringify(receipt)));
  const prefix = '/repos/williacj/rigger/actions';
  return { facts, archive: archive.toString('base64'), api: {
    [prefix + '/workflows/9130/runs?event=pull_request&head_sha=' + facts.pr.head + '&status=success&per_page=100']: { total_count: 1, workflow_runs: [run] },
    [prefix + '/runs/4101/attempts/2']: run,
    [prefix + '/runs/4101/artifacts?per_page=100']: { total_count: 1, artifacts: [{
      id: 6001, name: 'ci-full-proof-4101-2', size_in_bytes: archive.length, expired: false,
      workflow_run: { id: 4101, repository_id: 42, head_sha: run.head_sha },
    }] },
    [prefix + '/runs/4101/attempts/2/jobs?per_page=100']: jobs,
  } };
}
