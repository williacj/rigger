// ABOUTME: Proves escalation-role wiring through the once verb over a local origin and fake gh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import template from '../templates/rigger.config.mjs';
import { ROUTING_LINE } from '../src/workflow/escalation.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { standInAgent } from './stub-claude.mjs';
import { warmed } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { BODY, REASON } from './escalation-world.mjs';

/** Existing stand-in acts make/push the PR; the wrapper only posts the new escalation note. */
function world({ pull = false, pushed = false, refuseRoute = false } = {}) {
  const root = temporaryDirectory('rigger-escalation-once-');
  const settings = { ...template, repo: 'acme/widgets', board: { ...template.board, project: 3 },
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } },
    provisioning: {}, escalate: { ambiguous: 'pm' } };
  const consumer = repositoryAt(join(root, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(root, 'origin.git');
  withOrigin(consumer, origin);
  const fakeDir = temporaryDirectory('rigger-escalation-gh-');
  const fake = installFakeGh(fakeDir, { repo: settings.repo, project: 3, origin, board: {
    columns: Object.values(settings.board.columns), fields: [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }],
    items: [{ type: 'issue', repository: settings.repo, number: 12, title: 'Choose a widget colour', body: BODY, labels: ['type:change'], column: 'Coding' }],
  } });
  seedRepository(fake, { origin, issues: [{ number: 12, body: BODY, comments: [] }] });
  const refusing = refuseRoute ? temporaryDirectory('rigger-route-refusal-') : undefined;
  if (refusing !== undefined) {
    const script = [
      `#!${process.execPath}`,
      "import { execFileSync } from 'node:child_process';",
      'if (!process.env.RIGGER_FIXTURE_WARMING) {',
      `if (process.argv.some((arg) => arg.startsWith(${JSON.stringify('body=' + ROUTING_LINE)}))) { console.error('forge denied routing'); process.exit(1); }`,
      `try { execFileSync(${JSON.stringify(fake.gh)}, process.argv.slice(2), { stdio: 'inherit', env: process.env }); } catch (failure) { process.exit(failure.status ?? 1); }`,
      '}',
    ].join('\n');
    writeFileSync(join(refusing, 'gh'), script);
    chmodSync(join(refusing, 'gh'), 0o755);
    warmed(join(refusing, 'gh'));
  }
  const agent = standInAgent({ 12: { engineer: { pr: pull, push: pushed, exit: 7 } } });
  renameSync(join(agent.dir, 'claude'), join(agent.dir, 'stand-in'));
  const wrapper = [
    `#!${process.execPath}`,
    "import { readFileSync } from 'node:fs';",
    "import { execFileSync } from 'node:child_process';",
    'if (!process.env.RIGGER_FIXTURE_WARMING) {',
    "const input = readFileSync(0, 'utf8');",
    "const args = process.argv.slice(2);",
    `try { execFileSync(${JSON.stringify(join(agent.dir, 'stand-in'))}, args, { input, env: process.env }); } catch (failure) { if (failure.status !== 7) throw failure; }`,
    "if (args.some((word) => word.endsWith('/engineer.md'))) {",
    "const dispatch = /^dispatch: (d-[^\\n]+)/m.exec(input)[1];",
    `const body = ['\u0060\u0060\u0060rigger-escalation', 'category: ambiguous', 'item: 2', ${JSON.stringify(`reason: ${REASON}`)}, 'dispatch: ' + dispatch, '\u0060\u0060\u0060'].join('\\n');`,
    "execFileSync('gh', ['api', 'repos/acme/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=' + body], { env: process.env });",
    '}', '}',
  ].join('\n');
  writeFileSync(join(agent.dir, 'claude'), wrapper);
  chmodSync(join(agent.dir, 'claude'), 0o755);
  warmed(join(agent.dir, 'claude'));
  const bin = fileURLToPath(new URL('../src/cli/rigger.mjs', import.meta.url));
  const invoke = () => spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: agent.first(`${refusing === undefined ? '' : `${refusing}:`}${fakeDir}:${process.env.PATH}`) } });
  return { consumer, origin, fake, agent, invoke, events: () => readEvents(join(consumer, '.rigger')) };
}

// The counterexample is forgetting the CLI-to-L3 directory handle, despite a passing loop double.
// proves R-ESCALATE-23
test('once posts the route and dispatches the destination with real escalation and scratch directories', { timeout: 60000 }, async () => {
  const here = world();
  const ran = here.invoke();
  assert.equal(ran.error, undefined);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm'], ran.stdout + ran.stderr);
  const role = here.agent.runs()[1];
  assert.match(role.cwd, /\/escalations\/rigger-12\/pm\/main$/);
  const root = dirname(dirname(dirname(dirname(role.cwd))));
  assert.equal(existsSync(join(root, 'scratch', 'rigger-12', 'pm')), true);
  const card = (await (await here.fake.model()).operations.readItems())[0];
  assert.equal(card.column, 'Coding');
  assert.deepEqual(card.labels, ['type:change']);
});

// An open PR must enter Review after the role settles, and the verb must report that outcome.
// proves R-ESCALATE-21
test('once moves an open pull to Review after the escalation role exits zero and reports the role', { timeout: 60000 }, async () => {
  const here = world({ pull: true });
  const ran = here.invoke();
  assert.equal(ran.error, undefined);
  const card = (await (await here.fake.model()).operations.readItems())[0];
  assert.equal(card.column, 'Review', ran.stdout + ran.stderr);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm']);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /role `pm`.*handled.*Review/);
  assert.doesNotMatch(ran.stdout, /undefined/);
});

// The counterexample is starting over and discarding pushed work after the role exits zero.
// proves R-ESCALATE-21
test('a handled role with a pushed line and no pull leaves Coding then the next once escalates R-WORK-19 to the owner', { timeout: 60000 }, async () => {
  const here = world({ pushed: true });
  const first = here.invoke();
  assert.equal(first.error, undefined);
  assert.equal((await (await here.fake.model()).operations.readItems())[0].column, 'Coding');
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm']);
  const second = here.invoke();
  assert.equal(second.error, undefined);
  assert.equal((await (await here.fake.model()).operations.readItems())[0].column, 'Owner');
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer', 'pm'], 'pushed work must refuse a fresh maker');
  const escalation = here.events().filter((event) => event.event === 'review.escalate').at(-1);
  assert.equal(escalation.raiser, 'loop');
  assert.equal(escalation.destination, 'owner');
  assert.match(escalation.reason, /forge holds its line of work/);
});

// The verb and event must expose the refused write, with no role or escalation directory created.
// proves R-ESCALATE-23
test('once reports a refused routing post and records that write without dispatching its role', { timeout: 60000 }, async () => {
  const here = world({ refuseRoute: true });
  const ran = here.invoke();
  assert.equal(ran.error, undefined);
  assert.equal(ran.status, 1);
  assert.match(ran.stdout + ran.stderr, /routing comment was refused.*forge denied routing/s);
  assert.deepEqual(here.agent.runs().map((run) => run.role), ['engineer']);
  assert.equal(here.events().filter((event) => event.event === 'escalation.route-refused').length, 1);
  assert.equal((await (await here.fake.model()).operations.readItems())[0].column, 'Coding');
  assert.equal(existsSync(join(dirname(here.consumer), 'widgets-worktrees', 'escalations')), false);
});
