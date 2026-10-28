// ABOUTME: Runs once in a consumer with real recorded forge and git survivors for event context proof.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import template from '../templates/rigger.config.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { markerComment } from './fake-repository.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { GIT, holding } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { card, COLUMNS, FIELDS, REPO, PROJECT, ADMITTED } from './verb-consumer.mjs';
import { commandKills, leavingRecordedChild } from './event-context-world.mjs';

/** Set up fresh, continuing, or merge-lane work without using the checkout as a consumer. */
export function onceEventWorld(t, { continuing = false, merging = false, peers = [] } = {}) {
  const directory = holding(t);
  const settings = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, provisioning: {},
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } } };
  const consumer = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const fakeDirectory = join(directory, 'fake');
  mkdirSync(fakeDirectory);
  const fake = installFakeGh(fakeDirectory, { repo: REPO, project: PROJECT, origin,
    board: { columns: COLUMNS, fields: FIELDS, items: [card(12, merging ? 'Review' : 'Coding'), ...peers] } });
  if (continuing || merging) {
    const base = gitIn(consumer, 'rev-parse', 'HEAD').trim();
    gitIn(consumer, 'switch', '-qc', 'rigger-12');
    gitIn(consumer, 'commit', '-qm', 'work for review', '--allow-empty');
    const head = gitIn(consumer, 'rev-parse', 'HEAD').trim();
    gitIn(consumer, 'push', '-q', 'origin', 'rigger-12');
    gitIn(consumer, 'switch', '-q', 'main');
    const comment = markerComment({ card: 12, pull: 77, head, body: ADMITTED,
      ...(merging ? {} : { verdict: 'needs revision', items: ['unmet'], toSound: 'The widget must turn blue.' }) });
    seedRepository(fake, { origin, mergeable: { 77: 'MERGEABLE' }, pullRequests: [{ number: 77, head: 'rigger-12', sha: head, mergeBase: base,
      diff: 'diff --git a/widget b/widget\n', comments: [comment], mergeable: 'mergeable' }] });
  } else seedRepository(fake, { origin });
  leavingRecordedChild(directory, 'gh', '"$here/fake/gh" "$@"', { leadersOnly: true });
  leavingRecordedChild(directory, 'git', `'${GIT}' "$@"`, { leadersOnly: true });
  const agent = standInAgent({ 12: { engineer: { pr: !continuing, push: continuing } } });
  const invoke = () => {
    const bin = fileURLToPath(new URL('../src/cli/rigger.mjs', import.meta.url));
    const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: agent.first(`${directory}:${process.env.PATH}`) } });
    assert.equal(ran.error, undefined, ran.stderr);
    return ran;
  };
  const events = () => readEvents(join(consumer, '.rigger'));
  return { directory, consumer, fake, agent, invoke, events, rows: (name, selected = events()) => commandKills(directory, selected, name) };
}

/** The maker's span includes scratch before dispatch.start and settle after dispatch.end. */
export function makerSpan(events) {
  const begin = events.findIndex((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'engineer');
  assert.ok(begin >= 0, 'the maker was not dispatched');
  const dispatch = events[begin].dispatch;
  const start = events.findIndex((event) => event.event === 'dispatch.start' && event.dispatch === dispatch);
  const end = events.findIndex((event) => event.event === 'dispatch.end' && event.dispatch === dispatch);
  assert.ok(start > begin && end > start, 'the maker must have started and ended');
  assert.equal(events[end].exit, 0);
  const next = events.findIndex((event, index) => index > end && event.layer === 'L3' && event.event === 'dispatch');
  return { dispatch, scratch: events.slice(begin, start), settle: events.slice(end + 1, next < 0 ? events.length : next) };
}
