// ABOUTME: Checks a maker's committed head against its card before handoff.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { retiredIds } from './duplicate-id-check.mjs';

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

export function preflight(argv, { root = process.cwd(), scriptChecks = SCRIPT_CHECKS, env = process.env, write = console.log, execute } = {}) {
  root = realpathSync.native(root);
  const run = ([command, ...args]) => {
    const options = { cwd: root, encoding: 'utf8', env: { ...gitEnvironment(env), GIT_OPTIONAL_LOCKS: '0' } };
    return execute ? execute(command, args, options) : spawnSync(command, args, { ...options, env: options.env });
  };
  const git = (...args) => {
    const result = run(['git', '--no-optional-locks', '--literal-pathspecs', ...args]);
    if (result.status !== 0) throw new Error((result.error?.message ?? result.stderr.trim()) || `git exited ${result.status}`);
    return result.stdout;
  };
  let head, base;
  try {
    head = git('rev-parse', 'HEAD').trim();
    try { git('rev-parse', '--verify', 'origin/main^{commit}'); }
    catch (error) { throw new Error(`origin/main is missing: ${error.message}`); }
    try { base = git('merge-base', 'HEAD', 'origin/main').trim(); }
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
  const changed = git('diff', '--no-renames', '--name-only', '-z', `${base}..HEAD`).split('\0').filter(Boolean);
  report('lands-in', paths.length === 0 ? ['no "Lands in" bullet naming paths; lands-in cannot run']
    : changed.filter((path) => !paths.some((named) => covers(named, path))).map((path) => JSON.stringify(path)));
  const retired = retiredIds(root);
  const citations = changed.flatMap((path) => {
    if (path.startsWith('docs/spec/') || path.startsWith('docs/journal/')) return [];
    const diff = git('diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--unified=0', `${base}..HEAD`, '--', path);
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
