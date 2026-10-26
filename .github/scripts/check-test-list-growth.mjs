// ABOUTME: Refuses growth in the transitional test lists between an event's declared base and head.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function listGrowth(before, after) {
  return ['converting', 'awaiting'].flatMap((list) => {
    const known = new Set(before[list]);
    return after[list].filter((file) => !known.has(file))
      .map((file) => list + ' grew: ' + file);
  });
}

export function checkGrowth(context, facts) {
  try {
    const { eventName, ref } = context;
    if (!((eventName === 'push' && ref?.startsWith('refs/heads/'))
        || eventName === 'pull_request' || eventName === 'merge_group'
        || (['schedule', 'workflow_dispatch'].includes(eventName) && ref === 'refs/heads/main'))) {
      return { ok: false, errors: ['unsupported event ' + eventName + ' at ref ' + ref] };
    }
    if (!/^[a-f0-9]{40}$/.test(context.sha ?? '')) {
      return { ok: false, errors: ['head is unavailable or invalid: ' + context.sha] };
    }
    let base = context.event.before;
    if (eventName === 'push' && !/^[a-f0-9]{40}$/.test(base ?? '')) {
      return { ok: false, errors: ['push base is unavailable or invalid'] };
    }
    if (context.eventName === 'push' && /^0{40}$/.test(base)) {
      base = context.ref === 'refs/heads/' + context.event.repository.default_branch
        ? facts.firstParent(context.sha)
        : facts.mergeBase(context.sha, 'refs/remotes/origin/' + context.event.repository.default_branch);
    }
    if (context.eventName === 'pull_request') base = context.event.pull_request?.base?.sha;
    if (context.eventName === 'merge_group') base = context.event.merge_group?.base_sha;
    if (['schedule', 'workflow_dispatch'].includes(context.eventName) && context.ref === 'refs/heads/main') base = facts.firstParent(context.sha);
    if (!base && (context.eventName !== 'push' || context.ref === 'refs/heads/' + context.event.repository.default_branch)) {
      return { ok: false, errors: ['head ' + context.sha + ' is a root commit or has no available first parent'] };
    }
    if (!base) return { ok: false, errors: ['head ' + context.sha + ' has no common ancestor with the default branch'] };
    if (!facts.present(base)) return { ok: false, errors: ['base ' + base + ' is not present in the clone'] };
    if (!facts.listsExist(base)) {
      readListsAt(context.sha, 'head', facts);
      return { ok: true, notice: 'base ' + base + ' predates the transitional lists' };
    }
    const errors = listGrowth(readListsAt(base, 'base', facts), readListsAt(context.sha, 'head', facts));
    return { ok: errors.length === 0, errors };
  } catch (error) { return { ok: false, errors: [error.message] }; }
}

function readListsAt(sha, role, facts) {
  try { return facts.readLists(sha); }
  catch (error) { throw new Error(role + ' ' + sha + ' lists cannot be read: ' + error.message); }
}

export function gitFacts(root = process.cwd(), introduction = '07197e75cf1013c06368555df3f3e0236fb51594') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const run = (command, args, extra = {}) => execFileSync(command, args, {
    cwd: root, env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, ...extra,
  });
  return {
    present(sha) {
      if (!/^[a-f0-9]{40}$/.test(sha ?? '')) return false;
      try { run('git', ['cat-file', '-e', sha + '^{commit}']); return true; }
      catch { return false; }
    },
    firstParent(sha) {
      return run('git', ['show', '-s', '--format=%P', sha], { encoding: 'utf8' }).trim().split(' ')[0] || null;
    },
    mergeBase(head, defaultRef) {
      try { return run('git', ['merge-base', head, defaultRef], { encoding: 'utf8' }).trim(); }
      catch (error) { if (error.status === 1) return null; throw error; }
    },
    listsExist(base) {
      try { run('git', ['merge-base', '--is-ancestor', introduction, base]); return true; }
      catch (error) { if (error.status === 1) return false; throw error; }
    },
    readLists(sha) {
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('invalid commit ' + sha);
      const archive = run('git', ['archive', '--format=tar', sha, 'test']);
      const snapshot = mkdtempSync(join(tmpdir(), 'rigger-list-growth-'));
      try {
        run('tar', ['-xf', '-', '-C', snapshot], { input: archive });
        return Object.fromEntries(['converting', 'awaiting'].map((list) => {
          const output = run('sh', ['test/suite.sh', '--list', list], { cwd: snapshot, encoding: 'utf8' });
          return [list, output.trim().split('\n').filter(Boolean)];
        }));
      } finally { rmSync(snapshot, { recursive: true, force: true }); }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkGrowth({
      eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    }, gitFacts());
    if (result.notice) console.log(result.notice);
    for (const error of result.errors ?? []) console.error(error);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error('list-growth check failed: ' + error.message); process.exitCode = 1; }
}
