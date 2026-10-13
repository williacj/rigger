// ABOUTME: Reads every workflow file this repository holds and the gate workflow's template: what
// each job is named, what the gate workflow triggers on, the token it holds, the order its posting
// job mints and posts in, and, run with stand-ins for node and curl, what its steps post.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE_CONTEXT } from '../src/workflow/gate.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = join(ROOT, '.github', 'workflows', 'rigger-gate.yml');
const TEMPLATE = join(ROOT, 'templates', 'github', 'workflows', 'rigger-gate.yml');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * The YAML a workflow file in this repository is written in, parsed: block mappings and block
 * sequences by indentation, plain, single- and double-quoted scalars, flow sequences of scalars,
 * literal block scalars (`|`), and comments on lines of their own. Anything else is refused, naming
 * the line, so a file this reads wrongly fails rather than passes. Every scalar is a string.
 */
function parseWorkflow(text) {
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

const live = parseWorkflow(readFileSync(LIVE, 'utf8'));
const template = parseWorkflow(readFileSync(TEMPLATE, 'utf8'));

/** Every job of a parsed workflow, with its id. */
const jobsOf = (workflow) => Object.entries(workflow.jobs).map(([id, job]) => ({ id, ...job }));

/** Every step of every job, with its job's id. */
const stepsOf = (workflow) => jobsOf(workflow).flatMap((job) => job.steps.map((step) => ({ job: job.id, ...step })));

/** The posting job: the one that declares the `gate` environment. */
const posting = (workflow) => jobsOf(workflow).find((job) => job.environment === 'gate');

/** The step of `job` named `name`, asserted to be there once. */
function stepNamed(job, name) {
  const found = job.steps.filter((step) => step.name === name);
  assert.equal(found.length, 1, `${job.id} holds ${found.length} steps named ${name}`);
  return found[0];
}

test('the reader parses a workflow it is handed, and refuses a form it does not read rather than misreading it', () => {
  assert.deepEqual(parseWorkflow('a: b\nc:\n  - d: e\n    f: [g, \'h\']\n  - i\nj: |\n  k\n    l\n'), { a: 'b', c: [{ d: 'e', f: ['g', 'h'] }, 'i'], j: 'k\n  l\n' });
  for (const text of ['a: {b: c}\n', 'a: b\n   c: d\n', 'a: [b,\n  c]\n', 'a b\n', 'a: b\na: c\n']) {
    assert.throws(() => parseWorkflow(text), /line \d+/, text);
  }
});

test('no job in any file under .github/workflows/ or templates/github/workflows/ has an id or name equal to rigger/gate or self-hosting', () => {
  const files = ['.github/workflows', 'templates/github/workflows'].flatMap((directory) => readdirSync(join(ROOT, directory)).map((name) => join(ROOT, directory, name)));
  assert.ok(files.length >= 3, files.join(', '));
  for (const file of files) {
    for (const job of jobsOf(parseWorkflow(readFileSync(file, 'utf8')))) {
      for (const named of [job.id, job.name]) assert.ok(!['rigger/gate', 'self-hosting'].includes(named), `${file}: ${named}`);
    }
  }
});

test('the template differs from this repository\'s workflow only in the pinned commit, line by line', () => {
  const ours = readFileSync(LIVE, 'utf8').split('\n');
  const theirs = readFileSync(TEMPLATE, 'utf8').split('\n');
  assert.equal(ours.length, theirs.length);
  const differing = ours.map((line, at) => [line, theirs[at]]).filter(([one, other]) => one !== other);
  assert.equal(differing.length, 1, JSON.stringify(differing));
  assert.equal(differing[0][1], '  RIGGER_COMMIT: PINNED_COMMIT');
  assert.match(differing[0][0], /^ {2}RIGGER_COMMIT: [0-9a-f]{40}$/);
});

test('the posting step names the context GATE_CONTEXT, in the template and in this repository\'s workflow', () => {
  for (const workflow of [template, live]) {
    assert.equal(stepNamed(posting(workflow), 'Post rigger/gate on each head the check read').env.CONTEXT, GATE_CONTEXT);
  }
});

test('the workflow triggers on each event and type the events table names, and on no pull_request event', () => {
  for (const workflow of [template, live]) {
    assert.deepEqual(workflow.on, {
      pull_request_target: { types: ['opened', 'synchronize', 'reopened', 'edited'] },
      issue_comment: { types: ['created', 'edited', 'deleted'] },
      issues: { types: ['edited', 'labeled', 'unlabeled'] },
    });
  }
});

test('the workflow\'s permissions grant its GITHUB_TOKEN read scopes only, at the top level and in every job', () => {
  for (const workflow of [template, live]) {
    for (const [where, permissions] of [['top level', workflow.permissions], ...jobsOf(workflow).map((job) => [job.id, job.permissions])]) {
      assert.ok(permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0, `${where} declares no permissions`);
      for (const [scope, granted] of Object.entries(permissions)) assert.equal(granted, 'read', `${where}: ${scope}`);
    }
  }
});

test('the posting job declares environment gate, and after the script runs, an inline step mints the App\'s token from GATE_APP_ID and GATE_APP_PRIVATE_KEY, and the post step posts with it', () => {
  for (const workflow of [template, live]) {
    const job = posting(workflow);
    const names = job.steps.map((step) => step.name);
    const ruled = names.indexOf('Run the gate check on each pull request');
    const minted = names.indexOf('Mint the gate App\'s token');
    const posted = names.indexOf('Post rigger/gate on each head the check read');
    assert.ok(ruled !== -1 && ruled < minted && minted < posted, names.join(', '));
    const mint = job.steps[minted];
    assert.equal(mint.uses, undefined);
    assert.deepEqual(mint.env, { GATE_APP_ID: '${{ vars.GATE_APP_ID }}', GATE_APP_PRIVATE_KEY: '${{ secrets.GATE_APP_PRIVATE_KEY }}' });
    assert.match(mint.run, /openssl dgst -sha256 -sign/);
    assert.match(mint.run, /app\/installations\/\$\{installation\}\/access_tokens/);
    assert.match(mint.run, /"statuses\\":\\"write\\"/);
    assert.equal(job.steps[posted].env.TOKEN, `\${{ steps.${mint.id}.outputs.token }}`);
    assert.match(job.steps[posted].run, /Authorization: Bearer \$\{TOKEN\}/);
  }
});

test('the template\'s posting job names the environment gate, the variable GATE_APP_ID and the secret GATE_APP_PRIVATE_KEY, and holds no App id or key', () => {
  const text = readFileSync(TEMPLATE, 'utf8');
  assert.equal(posting(template).environment, 'gate');
  assert.match(text, /\$\{\{ vars\.GATE_APP_ID \}\}/);
  assert.match(text, /\$\{\{ secrets\.GATE_APP_PRIVATE_KEY \}\}/);
  assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY/);
  for (const step of stepsOf(template)) {
    for (const value of Object.values(step.env ?? {})) assert.doesNotMatch(value, /^\d+$/, `${step.name} holds a literal id`);
  }
});

test('the private key and the minted token appear only in the mint and post steps\' env, and in no other step', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) {
      const env = Object.values(step.env ?? {}).join('\n');
      const named = `${env}\n${step.run ?? ''}\n${step.if ?? ''}`;
      const holdsKey = /secrets\.GATE_APP_PRIVATE_KEY/.test(named);
      const holdsToken = /steps\.mint\.outputs\.token/.test(named);
      if (step.name === 'Mint the gate App\'s token') assert.ok(holdsKey && !holdsToken && /secrets\./.test(env), step.name);
      else if (step.name === 'Post rigger/gate on each head the check read') assert.ok(holdsToken && !holdsKey && /steps\.mint\.outputs\.token/.test(env), step.name);
      else assert.ok(!holdsKey && !holdsToken && !/secrets\./.test(named), step.name);
    }
    // Nothing above the steps hands either on: no job or workflow env, and no job output.
    const above = JSON.stringify([workflow.env, ...jobsOf(workflow).map((job) => [job.env, job.outputs])]);
    assert.doesNotMatch(above, /secrets\.|steps\.mint/);
  }
});

test('no step in any job of the workflow has a uses:', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) assert.equal(step.uses, undefined, `${step.job}: ${step.name}`);
  }
});

test('every job in the workflow runs on macos-latest', () => {
  for (const workflow of [template, live]) {
    for (const job of jobsOf(workflow)) assert.equal(job['runs-on'], 'macos-latest', job.id);
  }
});

test('the workflow names one Node major, one engines admits, and before the script runs a step prints node --version and fails the run, naming both, where the runner\'s is below it', () => {
  const major = template.env.NODE_MAJOR;
  assert.match(major, /^\d+$/);
  assert.ok(Number(major) >= Number(manifest.engines.node.match(/^>=\s*(\d+)/)[1]), `${major} is below engines ${manifest.engines.node}`);
  for (const job of jobsOf(template)) {
    const names = job.steps.map((step) => step.name);
    const checked = names.indexOf('Check the Node version');
    const script = job.steps.findIndex((step) => /GATE_CHECK/.test(step.run ?? ''));
    assert.ok(checked !== -1 && checked < script, `${job.id}: ${names.join(', ')}`);
  }
  const check = stepNamed(posting(template), 'Check the Node version');
  for (const [version, status] of [['v22.11.0', 1], [`v${major}.0.0`, 0], ['v26.1.0', 0]]) {
    const ran = runStep(check, { NODE_MAJOR: major }, { node: `#!/bin/sh\necho ${version}\n` });
    assert.equal(ran.status, status, `${version}: ${ran.stdout}${ran.stderr}`);
    assert.ok(ran.stdout.includes(version) && ran.stdout.includes(`Node ${major}`), ran.stdout);
  }
});

test('no run: step interpolates a github.event expression, and event fields reach the script through env', () => {
  for (const workflow of [template, live]) {
    for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\$\{\{/, `${step.job}: ${step.name}`);
    assert.equal(workflow.env.NUMBER, '${{ github.event.pull_request.number || github.event.issue.number }}');
    assert.equal(workflow.env.IS_PULL, '${{ github.event.pull_request != null || github.event.issue.pull_request != null }}');
  }
});

test('no step checks out, or runs code from, the pull request\'s head', () => {
  for (const workflow of [template, live]) {
    const text = JSON.stringify(workflow);
    assert.doesNotMatch(text, /github\.event\.pull_request\.head|github\.head_ref|GITHUB_HEAD_REF/);
    for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\bgit (clone|checkout|fetch|switch)\b/, step.name);
  }
});

test('a first job resolves the card\'s number and hands the posting job that number alone as its output', () => {
  for (const workflow of [template, live]) {
    const [first] = jobsOf(workflow);
    assert.deepEqual(first.outputs, { card: '${{ steps.card.outputs.card }}' });
    assert.match(stepNamed(first, 'Resolve the card').run, /^node "\$\{RUNNER_TEMP\}\/\$\{GATE_CHECK\}" card >> "\$\{GITHUB_OUTPUT\}"$/);
    assert.equal(posting(workflow).needs, first.id);
  }
});

test('every job that posts runs in a concurrency group keyed on the workflow and the first job\'s output, never cancelled in progress, and logs that group with its start and end times', () => {
  for (const workflow of [template, live]) {
    const posters = jobsOf(workflow).filter((job) => job.steps.some((step) => /\/statuses\//.test(step.run ?? '')));
    assert.deepEqual(posters.map((job) => job.id), [posting(workflow).id]);
    for (const job of posters) {
      assert.deepEqual(job.concurrency, { group: '${{ github.workflow }}-${{ needs.card.outputs.card }}', 'cancel-in-progress': 'false' });
      assert.equal(job.env.GROUP, job.concurrency.group);
      const [start] = job.steps;
      const end = job.steps.at(-1);
      assert.match(start.run, /concurrency group \$\{GROUP\}; started \$\(date -u/);
      assert.equal(end.if, 'always()');
      assert.match(end.run, /concurrency group \$\{GROUP\}; ended \$\(date -u/);
    }
  }
});

test('no step or condition depends on a run being cancelled', () => {
  for (const workflow of [template, live]) {
    const text = JSON.stringify(workflow);
    assert.doesNotMatch(text, /cancelled\(\)|cancel-in-progress":"true/);
  }
});

test('the workflow installs Rigger at the pinned commit from its codeload tarball, outside any checkout, and runs the script by its path inside the installed package', () => {
  assert.deepEqual(manifest.bin, { rigger: 'src/cli/rigger.mjs' });
  for (const workflow of [template, live]) {
    assert.equal(workflow.env.GATE_CHECK, `rigger/node_modules/${manifest.name}/scripts/gate-check.mjs`);
    for (const job of jobsOf(workflow)) {
      const install = stepNamed(job, 'Install Rigger at the pinned commit');
      assert.match(install.run, /npm install --prefix "\$\{RUNNER_TEMP\}\/rigger" --ignore-scripts .*"https:\/\/codeload\.github\.com\/williacj\/rigger\/tar\.gz\/\$\{RIGGER_COMMIT\}"/);
      for (const step of job.steps.filter((each) => /gate-check|GATE_CHECK/.test(each.run ?? ''))) {
        assert.match(step.run, /node "\$\{RUNNER_TEMP\}\/\$\{GATE_CHECK\}" (card|map|rule)/, step.name);
      }
    }
  }
});

test('the post and mint steps run only where every step before them succeeded and the event concerns a pull request, so a failed read of the card\'s pull requests or of a pull request posts nothing', () => {
  for (const workflow of [template, live]) {
    const job = posting(workflow);
    for (const name of ['Mint the gate App\'s token', 'Post rigger/gate on each head the check read']) {
      assert.equal(stepNamed(job, name).if, 'success() && steps.map.outputs.pulls != \'\'');
    }
    // The map and the gate check run with no condition of their own, so either failing skips both.
    for (const name of ['Map the event to its pull requests', 'Run the gate check on each pull request']) assert.equal(stepNamed(job, name).if, undefined);
  }
});

test('no file under scripts/, .github/ or templates/ holds the marker\'s syntax', () => {
  const grep = spawnSync('git', ['grep', '-n', 'rigger-marker', '--', 'scripts', '.github', 'templates'], { cwd: ROOT, encoding: 'utf8', env: gitEnvironment() });
  assert.equal(grep.status, 1, grep.stdout);
});

/**
 * Runs `step`'s script as the runner does, under bash with `-eo pipefail`, with `env` beside the
 * runner's own variables, and with `stand-ins`, each a name and its script, first on PATH. Answers
 * its status, what it printed, and the runner's files: its temporary directory, output and summary.
 */
function runStep(step, env = {}, standIns = {}, runner = temporaryDirectory('rigger-workflow-runner-')) {
  const bin = join(runner, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, script] of Object.entries(standIns)) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  const files = { RUNNER_TEMP: join(runner, 'temp'), GITHUB_OUTPUT: join(runner, 'output'), GITHUB_STEP_SUMMARY: join(runner, 'summary') };
  mkdirSync(files.RUNNER_TEMP, { recursive: true });
  for (const file of [files.GITHUB_OUTPUT, files.GITHUB_STEP_SUMMARY]) if (!existsSync(file)) writeFileSync(file, '');
  writeFileSync(join(runner, 'step.sh'), step.run);
  const ran = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(runner, 'step.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: [bin, process.env.PATH].join(delimiter), GITHUB_REPOSITORY: 'acme/widgets', GATE_CHECK: template.env.GATE_CHECK, ...files, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, runner, ...files };
}

/**
 * A stand-in gate check under `runner`'s temporary directory, at the path the workflow runs it by,
 * printing for each pull request what `answers` gives it and exiting with its status.
 */
function standInCheck(runner, answers) {
  const path = join(runner, 'temp', template.env.GATE_CHECK);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `const answers = ${JSON.stringify(answers)};\nconst [, number] = process.argv.slice(2);\nconst { printed, status } = answers[number];\nprocess.stdout.write(printed);\nprocess.exitCode = status;\n`);
}

/** A stand-in curl that records each call's URL and body, one JSON line each, and prints `{}`. */
const curlRecording = (runner) => `#!/bin/sh\nnode -e 'const a = process.argv.slice(1); require("fs").appendFileSync(${JSON.stringify(join(runner, 'posts'))}, JSON.stringify({ url: a.find((w) => w.startsWith("https://")), body: a[a.indexOf("-d") + 1] }) + "\\n")' -- "$@"\necho '{}'\n`;

/** What the stand-in curl was asked to post, one entry per call. */
const postsOf = (runner) => (existsSync(join(runner, 'posts')) ? readFileSync(join(runner, 'posts'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);

/** Runs the posting job's gate step for `answers`, then, where it succeeded, its post step. */
function gateAndPost(answers) {
  const job = posting(template);
  const runner = temporaryDirectory('rigger-workflow-runner-');
  standInCheck(runner, answers);
  const gate = runStep(stepNamed(job, 'Run the gate check on each pull request'), { PULLS: Object.keys(answers).join(' ') }, {}, runner);
  const post = gate.status === 0
    ? runStep(stepNamed(job, 'Post rigger/gate on each head the check read'), { CONTEXT: GATE_CONTEXT, TOKEN: 'minted' }, { curl: curlRecording(runner) }, runner)
    : null;
  return { gate, post, posts: postsOf(runner), summary: readFileSync(gate.GITHUB_STEP_SUMMARY, 'utf8') };
}

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const THIRD = 'c'.repeat(40);

test('the workflow posts one status under rigger/gate on the SHA the script printed: success where it exited 0, failure otherwise, with the first reason, cut to 140 characters, as its description', () => {
  const long = `reviewer: ${'é'.repeat(200)}`;
  const { gate, post, posts, summary } = gateAndPost({
    12: { printed: `head: ${SHA}\nadmitted\n`, status: 0 },
    13: { printed: `head: ${OTHER}\nrefused: ${long}\nrefused: owner: no marker\n`, status: 1 },
    // A non-zero exit with no reason printed is a failure all the same: the state is the status's.
    14: { printed: `head: ${THIRD}\n`, status: 1 },
  });

  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.equal(post.status, 0, post.stdout + post.stderr);
  assert.deepEqual(posts.map((each) => each.url), [SHA, OTHER, THIRD].map((sha) => `https://api.github.com/repos/acme/widgets/statuses/${sha}`));
  const [admitted, refused, unexplained] = posts.map((each) => JSON.parse(each.body));
  assert.equal(unexplained.state, 'failure');
  assert.deepEqual({ state: admitted.state, context: admitted.context }, { state: 'success', context: 'rigger/gate' });
  assert.deepEqual(refused, { state: 'failure', context: 'rigger/gate', description: [...long].slice(0, 140).join('') });
  assert.equal([...refused.description].length, 140);
  assert.ok(summary.includes(`head: ${OTHER}`), summary);
});

test('where a run of the script read no pull request, it printed no head, so the gate step fails and no post step runs for that event', () => {
  const { gate, post, posts } = gateAndPost({
    12: { printed: `head: ${SHA}\nadmitted\n`, status: 0 },
    13: { printed: '', status: 2 },
  });

  assert.notEqual(gate.status, 0);
  assert.match(gate.stdout, /pull request #13 could not be read, so nothing is posted for this event/);
  assert.equal(post, null);
  assert.deepEqual(posts, []);
});

test('the post goes on the SHA the script read, whatever the head is by the time it posts', () => {
  // The post step reads no head of its own: the only SHA it is handed is the one the check printed.
  const { posts } = gateAndPost({ 12: { printed: `head: ${SHA}\nrefused: reviewer: no marker\n`, status: 1 } });
  assert.deepEqual(posts.map((each) => each.url), [`https://api.github.com/repos/acme/widgets/statuses/${SHA}`]);
  assert.doesNotMatch(stepNamed(posting(template), 'Post rigger/gate on each head the check read').run, /pulls\/|gh /);
});
