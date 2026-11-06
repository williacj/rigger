// ABOUTME: Checks a maker's committed head against its card before handoff.

import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { retiredIds } from './duplicate-id-check.mjs';
import { documentChecking } from './doc-reference-check.mjs';

export const SCRIPT_CHECKS = [
  { name: 'matrix', command: ['npm', 'run', 'matrix:check'] },
  { name: 'spec-style', command: ['npm', 'run', 'lint:spec-style'] },
  { name: 'paths', command: ['npm', 'run', 'check:paths'] },
];

/** Backticked paths in the card's Lands in bullet, including its nested bullets. */
function landsIn(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^- \*\*Lands in:\*\*/.test(line));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return [...lines.slice(start, end === -1 ? undefined : end).join('\n').matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1]).filter((path) => path.includes('/') || /\.[A-Za-z0-9]+$/.test(path));
}

function covers(named, path) {
  const expression = named.split(/(<[^/<>]+>)/).map((part) =>
    /^<[^/<>]+>$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${expression}${named.endsWith('/') ? '[\\s\\S]*' : ''}$`).test(path);
}

/** Added lines with their positions in the new file; deletions have no new position. */
function addedLines(diff) {
  const added = [];
  let number;
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) number = Number(hunk[1]);
    else if (number !== undefined && line.startsWith('+')) added.push({ number: number++, text: line.slice(1) });
    else if (number !== undefined && line.startsWith(' ')) number += 1;
  }
  return added;
}

const HISTORICAL_AUDIT = 'docs/spikes/existing-suite-audit.json';

/** Qualify committed bytes without keeping the blob or its patch in memory. */
function qualifyCommittedEvidence(root, head, policy, git, readBlob) {
  const fields = ['path', 'gitMode', 'sha256', 'reason'];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).length !== fields.length || !fields.every((field) => Object.hasOwn(policy, field))
    || policy.path !== HISTORICAL_AUDIT || policy.gitMode !== '100644'
    || typeof policy.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(policy.sha256)
    || typeof policy.reason !== 'string' || policy.reason.trim() === '') {
    throw new Error('invalid retiredIdEvidence qualification fields');
  }
  const entries = git('ls-tree', '-z', head, '--', policy.path).split('\0');
  const [metadata, path] = entries[0].split('\t');
  const [mode, type, oid] = metadata.split(' ');
  if (entries.length !== 2 || entries[1] !== '' || path !== policy.path
    || mode !== policy.gitMode || type !== 'blob' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid ?? '')) {
    throw new Error('committed evidence is missing or is not mode 100644');
  }
  const temporary = realpathSync.native(tmpdir());
  const source = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
  const inside = (parent) => {
    const path = relative(parent, temporary);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  };
  if ([root, source].some(inside)) throw new Error('evidence spool must be outside the repository and checker source');
  let directory, descriptor, failure;
  try {
    directory = mkdtempSync(join(temporary, 'rigger-preflight-'));
    descriptor = openSync(join(directory, 'evidence.blob'), 'wx+', 0o600);
    const result = readBlob(oid, descriptor);
    if (result.status !== 0 || result.error) {
      throw new Error((result.error?.message ?? result.stderr?.trim()) || `blob read exited ${result.status}`);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(65_536);
    let position = 0, length;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, position)) !== 0) {
      hash.update(buffer.subarray(0, length));
      position += length;
    }
    if (hash.digest('hex') !== policy.sha256) throw new Error('committed evidence SHA-256 does not match qualification');
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch (error) { failure ??= error; }
    }
    if (directory !== undefined) {
      try { rmSync(directory, { recursive: true }); } catch (error) { failure ??= error; }
    }
  }
  if (failure) throw failure;
}

export function preflight(argv, { root = process.cwd(), scriptChecks = SCRIPT_CHECKS, env = process.env, write = console.log, execute } = {}) {
  root = realpathSync.native(root);
  const run = ([command, ...args], settings = {}) => {
    const options = { cwd: root, encoding: 'utf8', env: { ...gitEnvironment(env), GIT_OPTIONAL_LOCKS: '0' }, ...settings };
    return execute ? execute(command, args, options) : spawnSync(command, args, { ...options, env: options.env });
  };
  const gitCommand = (...args) => ['git', '--no-pager', '-c', 'color.ui=false', '--no-optional-locks', '--literal-pathspecs', ...args];
  const git = (...args) => {
    const result = run(gitCommand(...args));
    if (result.status !== 0) throw new Error((result.error?.message ?? result.stderr.trim()) || `git exited ${result.status}`);
    return result.stdout;
  };
  let head, main, base;
  try {
    head = git('rev-parse', 'HEAD').trim();
    try { main = git('rev-parse', '--verify', 'origin/main^{commit}').trim(); }
    catch (error) { throw new Error(`origin/main is missing: ${error.message}`); }
    try { base = git('merge-base', head, main).trim(); }
    catch (error) { throw new Error(`no merge base with origin/main: ${error.message}`); }
  } catch (error) {
    write(`preflight: ${error.message}`);
    return 1;
  }
  write(`preflight head ${head} merge-base ${base}`);
  let body;
  try {
    const bodyAt = argv.indexOf('--body-file');
    if (bodyAt !== -1) body = readFileSync(resolve(root, argv[bodyAt + 1]), 'utf8');
    else {
      const result = run(['gh', 'issue', 'view', argv[0], '--json', 'body', '--jq', '.body']);
      if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
      body = result.stdout;
    }
  }
  catch (error) {
    write(`preflight: body cannot be read: ${error.message}`);
    return 1;
  }
  let failing = false;
  const report = (name, findings) => {
    write(`${name}: ${findings.length ? 'failed' : 'passed'}`);
    for (const finding of findings) write(finding);
    if (findings.length) failing = true;
  };
  const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
  const dirty = [];
  for (let index = 0; index < status.length; index += 1) {
    const entry = status[index];
    dirty.push(JSON.stringify(entry.slice(3)));
    if (/[RC]/.test(entry.slice(0, 2))) dirty.push(JSON.stringify(status[++index]));
  }
  report('clean', dirty);
  const paths = landsIn(body);
  const changed = git('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${base}..${head}`).split('\0').filter(Boolean);
  report('lands-in', paths.length === 0 ? ['no "Lands in" bullet naming paths; lands-in cannot run']
    : changed.filter((path) => !paths.some((named) => covers(named, path))).map((path) => JSON.stringify(path)));
  let omitEvidencePatch = false;
  if (changed.includes(HISTORICAL_AUDIT)) {
    try {
      let config;
      try { config = documentChecking(root); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) {
        throw new Error('invalid document checking qualification configuration');
      }
      if (config?.preflight !== undefined) {
        const preflight = config.preflight;
        if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) {
          throw new Error('invalid preflight qualification configuration');
        }
        if (Object.hasOwn(preflight, 'retiredIdEvidence')) {
          omitEvidencePatch = true;
          qualifyCommittedEvidence(root, head, preflight.retiredIdEvidence, git,
            (oid, descriptor) => run(gitCommand('cat-file', 'blob', oid), { stdio: ['ignore', descriptor, 'pipe'] }));
          report('retired evidence', []);
        }
      }
    } catch (error) {
      omitEvidencePatch = true;
      report('retired evidence', [`${JSON.stringify(HISTORICAL_AUDIT)} qualification failed: ${error.message}`]);
    }
  }
  const retired = retiredIds(root);
  const citations = changed.flatMap((path) => {
    if ((omitEvidencePatch && path === HISTORICAL_AUDIT) || path.startsWith('docs/spec/') || path.startsWith('docs/journal/') || path.startsWith('docs/derived/')) return [];
    const diff = git('diff', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', '--unified=0', `${base}..${head}`, '--', path);
    return addedLines(diff).flatMap(({ number, text }) =>
      [...text.matchAll(/\b(?:R-[A-Z][A-Z0-9]*-\d+|D\d+)\b/g)]
        .filter((match) => retired.has(match[0]))
        .map((match) => `${JSON.stringify(path)}:${number} ${match[0]}`));
  });
  report('retired ids', citations);
  for (const { name, command } of scriptChecks) {
    const result = run(command);
    write(`${name}: ${result.status === 0 ? 'passed' : 'failed'} (exit ${result.status})`);
    if (result.stdout) write(result.stdout.trimEnd());
    if (result.stderr) write(result.stderr.trimEnd());
    if (result.status !== 0) failing = true;
  }
  return failing ? 1 : 0;
}

if (process.argv[1] && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))) {
  process.exitCode = preflight(process.argv.slice(2));
}
