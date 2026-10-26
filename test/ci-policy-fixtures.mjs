// ABOUTME: Shared literal CI source fixtures and in-process evaluation of the workflow's actual policy.
import assert from 'node:assert/strict';
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
    pr: { number: 7, head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', state: 'open', draft: false },
    live: { head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main', state: 'open', draft: false, labels: [] },
    changes: [{ status: 'A', oldMode: '000000', newMode: '100644', path: 'docs/journal/a.md' }],
  };
}

export function ciProof(mode = 'FAST_ELIGIBLE') {
  return {
    mode, demoNeeded: false, sourceValid: true,
    source: { event: 'pull_request', ref: 'refs/pull/7/merge', sha: 'a'.repeat(40), tree: 'b'.repeat(40), parents: ['c'.repeat(40), 'd'.repeat(40)], head: 'd'.repeat(40), base: 'c'.repeat(40), baseRef: 'main' },
    results: { plan: 'success', fast: 'success', full_ordinary: 'skipped', full_host: 'skipped', demo: 'skipped' },
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
  if (['policy', 'guard', 'runPolicy'].includes(operation)) return policy[operation](facts, extra);
  throw new Error('unsupported in-process CI operation ' + operation);
}
