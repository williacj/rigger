// ABOUTME: Builds a consumer for real-bin judge holds and refused events, using only fake forge and agent CLIs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { fixture, leave, scratch, TAIL } from './process-fixtures.mjs';
import { codexSkillAnswer, standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { COLUMNS, FIELDS, PROJECT, REPO, card, consumerConfig } from './verb-consumer.mjs';

const bin = fileURLToPath(new URL('../src/cli/rigger.mjs', import.meta.url));

/** The literal event predicates exercise each R38 source, independent of production classification. */
const REFUSALS = {
  dispatch: "event.layer === 'L3' && event.event === 'dispatch' && event.role === 'reviewer'",
  scratch: "event.layer === 'L1' && event.event === 'workspace.made' && event.role === 'reviewer' && event.main === undefined",
  start: "event.layer === 'L1' && event.event === 'dispatch.start' && event.facts !== undefined",
  survivor: "event.layer === 'L0' && event.event === 'survivor.killed'",
  timeout: "event.layer === 'L0' && event.event === 'timeout.killed'",
};

/** Runs the bin in one fresh consumer, with an optional refusal at the real JSONL append boundary. */
export function judgeVerbWorld(t, refusal) {
  const directory = scratch(t);
  const settings = structuredClone(consumerConfig(1));
  settings.kinds.change = { ...settings.kinds.change, judges: ['reviewer'] };
  const probe = ['survivor', 'timeout'].includes(refusal);
  settings.roles.reviewer = { ...settings.roles.reviewer, provider: probe ? 'codex' : 'claude' };
  const origin = join(directory, 'origin.git');
  const files = { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`, '.claude/agents/reviewer.md': '# Reviewer\n' };
  if (refusal === undefined) files['.claude/settings.json'] = JSON.stringify({ permissions: { allow: ['Bash(npm ci && npm test)'] } });
  const repository = repositoryAt(join(directory, 'consumer'), files);
  gitIn(repository, 'branch', '-M', 'main');
  const target = withOrigin(repository, origin);
  const gh = join(directory, 'gh');
  mkdirSync(gh);
  installFakeGh(gh, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [card(10, 'Ready')] }, origin });
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  if (probe) {
    writeFileSync(join(agent.dir, 'hold'), '');
    writeFileSync(join(agent.dir, 'probe-answer'), codexSkillAnswer([]));
    const body = refusal === 'survivor'
      ? `/bin/cat "$here/probe-answer"\n${leave(TAIL, 'probe-child')}`
      : 'echo $$ > "$here/probe.pid"\nexec /usr/bin/tail -f "$here/hold"';
    fixture(agent.dir, 'codex', body);
  }
  let preload;
  if (refusal !== undefined) {
    preload = join(directory, 'refuse-event.mjs');
    // The clock changes only the Codex probe's 60 s timer, after that probe was spawned. This
    // validates refusal wiring and output, while judgeTimedProbe retains the readiness/deadline proof.
    writeFileSync(preload, [
      '// ABOUTME: Refuses one fixture event and controls the probe deadline for the bin world.',
      "import fs from 'node:fs';",
      "import childProcess from 'node:child_process';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'const append = fs.appendFileSync;',
      'fs.appendFileSync = (path, data, ...rest) => {',
      '  let event; try { event = JSON.parse(String(data)); } catch {}',
      `  if (event && (${REFUSALS[refusal]})) throw Object.assign(new Error('the fixture refuses '+event.event), { code: 'EACCES' });`,
      '  return append(path, data, ...rest);',
      '};',
      ...(refusal === 'timeout' ? [
        'const spawn = childProcess.spawn; let probe = false;',
        "childProcess.spawn = (command, args, ...rest) => { if (command === 'codex' && args.includes('prompt-input')) probe = true; return spawn(command, args, ...rest); };",
        'const schedule = globalThis.setTimeout;',
        'globalThis.setTimeout = (done, delay, ...args) => schedule(done, probe && delay === 60000 ? 1000 : delay, ...args);',
      ] : []),
      'syncBuiltinESMExports();',
    ].join('\n'));
  }
  const environment = {
    ...process.env,
    CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'),
    PATH: [agent.dir, gh, process.env.PATH].join(delimiter),
    ...(preload === undefined ? {} : { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ') }),
  };
  const ran = spawnSync(process.execPath, [bin, 'run'], { cwd: target, env: environment, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  assert.equal(ran.error, undefined, `${ran.stdout}${ran.stderr}`);
  const state = join(realpathSync.native(target), '.rigger');
  return { code: ran.status, out: ran.stdout, err: ran.stderr, events: readEvents(state), state, runs: agent.runs() };
}
