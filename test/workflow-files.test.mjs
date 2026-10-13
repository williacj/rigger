// ABOUTME: Reads every workflow file this repository holds and the gate workflow's template: what
// each job is named, what the gate workflow triggers on, the token it holds, the order its posting
// job mints and posts in, and, run with stand-ins for node and curl, what its steps post.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE_CONTEXT } from '../src/workflow/gate.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import rigger from '../rigger.config.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { fixture } from './process-fixtures.mjs';

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

// This repository's own self-hosting workflow, which posts `self-hosting` as the gate workflow
// posts `rigger/gate`, from the tree fetched at the commit its own file was read from.

const SELF_HOSTING = join(ROOT, '.github', 'workflows', 'self-hosting.yml');

/** The self-hosting workflow, parsed when a test reads it. */
const selfHosting = () => parseWorkflow(readFileSync(SELF_HOSTING, 'utf8'));

/** The scripts the self-hosting workflow runs, by their paths inside the tree it fetched. */
const TREE_SCRIPTS = /node "\$\{RUNNER_TEMP\}\/\$\{TREE\}\/(scripts\/gate-check\.mjs|\.github\/scripts\/self-hosting-check\.mjs)"/;

/** The self-hosting workflow's step names, which the tests below find its steps by. */
const FETCH = 'Fetch the tree this workflow was read from';
const CHECK = 'Run the self-hosting check on each pull request';
const MINT = 'Mint the gate App\'s token';
const POST = 'Post self-hosting on each head the check read';

test('the self-hosting workflow triggers on the gate workflow\'s event set, and on no pull_request event', () => {
  assert.deepEqual(selfHosting().on, live.on);
  assert.deepEqual(Object.keys(selfHosting().on), ['pull_request_target', 'issue_comment', 'issues']);
});

test('no step in any job of the self-hosting workflow has a uses:', () => {
  const steps = stepsOf(selfHosting());
  assert.ok(steps.length > 0);
  for (const step of steps) assert.equal(step.uses, undefined, `${step.job}: ${step.name}`);
});

test('the self-hosting workflow runs the self-hosting script and the gate script by their paths in the tree an inline step of the same job fetched, and never from the head\'s tree, the base ref or a pinned install', () => {
  const workflow = selfHosting();
  assert.match(workflow.env.TREE, /^[a-z-]+$/);
  const ran = new Set();
  for (const job of jobsOf(workflow)) {
    const fetched = job.steps.findIndex((step) => step.name === FETCH);
    for (const [at, step] of job.steps.entries()) {
      const run = step.run ?? '';
      // The version check is the gate workflow's own, which names node only to ask its version.
      if (step.name === 'Check the Node version') {
        assert.equal(run, stepNamed(posting(live), step.name).run);
        continue;
      }
      assert.doesNotMatch(run, /npm (install|ci)|RIGGER_COMMIT|node_modules|GITHUB_BASE_REF|github\.base_ref|\bgit (clone|checkout|fetch|switch|worktree)\b/, `${job.id}: ${step.name}`);
      // Every node it runs is the version check, an inline script, or one of the two scripts in the tree.
      for (const call of run.match(/\bnode [^|;\n]*/g) ?? []) {
        if (/^node (--version|-e )/.test(call)) continue;
        const script = TREE_SCRIPTS.exec(call);
        assert.ok(script, `${job.id}: ${step.name} runs ${call}`);
        assert.ok(fetched !== -1 && fetched < at, `${job.id}: ${step.name} runs before the tree is fetched`);
        ran.add(script[1]);
      }
    }
  }
  assert.deepEqual([...ran].sort(), ['.github/scripts/self-hosting-check.mjs', 'scripts/gate-check.mjs']);
});

test('the fetch step names GITHUB_WORKFLOW_SHA as the commit it fetches, and never GITHUB_SHA, github.sha, a github.event field or a branch name, and nothing redefines GITHUB_WORKFLOW_SHA', () => {
  const workflow = selfHosting();
  for (const job of jobsOf(workflow)) {
    const fetch = stepNamed(job, FETCH);
    assert.match(fetch.run, /"https:\/\/codeload\.github\.com\/\$\{GITHUB_REPOSITORY\}\/tar\.gz\/\$\{GITHUB_WORKFLOW_SHA\}"/);
    assert.doesNotMatch(fetch.run, /\bGITHUB_SHA\b|github\.sha|github\.event|GITHUB_REF|GITHUB_HEAD_REF|GITHUB_BASE_REF|github\.ref|refs\/|\bmain\b|\$\{\{/, job.id);
    assert.equal(fetch.env, undefined, job.id);
  }
  const envs = [workflow.env, ...jobsOf(workflow).flatMap((job) => [job.env, ...job.steps.map((step) => step.env)])];
  for (const env of envs) assert.ok(!Object.hasOwn(env ?? {}, 'GITHUB_WORKFLOW_SHA'), JSON.stringify(env));
});

test('run as the runner runs it, the fetch step unpacks the tarball the forge serves for that commit into the tree the scripts run from', () => {
  const fetch = stepNamed(posting(selfHosting()), FETCH);
  const runner = temporaryDirectory('rigger-workflow-runner-');
  const source = join(runner, 'source', 'rigger-0123456');
  mkdirSync(join(source, '.github', 'scripts'), { recursive: true });
  writeFileSync(join(source, '.github', 'scripts', 'self-hosting-check.mjs'), 'the script\n');
  const tarball = join(runner, 'tree.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', tarball, '-C', join(runner, 'source'), 'rigger-0123456']).status, 0);
  const curl = `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(join(runner, 'curl-args'))}\ncat ${JSON.stringify(tarball)}\n`;

  const ran = runStep(fetch, { TREE: selfHosting().env.TREE, GITHUB_WORKFLOW_SHA: '0123456789abcdef0123456789abcdef01234567', GITHUB_SHA: 'f'.repeat(40) }, { curl }, runner);

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(readFileSync(join(runner, 'curl-args'), 'utf8').split('\n').includes('https://codeload.github.com/acme/widgets/tar.gz/0123456789abcdef0123456789abcdef01234567'));
  assert.equal(readFileSync(join(ran.RUNNER_TEMP, selfHosting().env.TREE, '.github', 'scripts', 'self-hosting-check.mjs'), 'utf8'), 'the script\n');
});

test('no step of the self-hosting workflow checks out, or runs code from, the pull request\'s head', () => {
  const workflow = selfHosting();
  assert.doesNotMatch(JSON.stringify(workflow), /github\.event\.pull_request\.head|github\.head_ref|GITHUB_HEAD_REF/);
  for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\bgit (clone|checkout|fetch|switch)\b/, step.name);
});

test('the self-hosting workflow\'s permissions grant its GITHUB_TOKEN read scopes only, at the top level and in every job', () => {
  const workflow = selfHosting();
  for (const [where, permissions] of [['top level', workflow.permissions], ...jobsOf(workflow).map((job) => [job.id, job.permissions])]) {
    assert.ok(permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0, `${where} declares no permissions`);
    for (const [scope, granted] of Object.entries(permissions)) assert.equal(granted, 'read', `${where}: ${scope}`);
  }
});

test('the self-hosting posting job declares environment gate, and after the script runs, an inline step mints the App\'s token from GATE_APP_ID and GATE_APP_PRIVATE_KEY, and the post step posts self-hosting with it', () => {
  const job = posting(selfHosting());
  const names = job.steps.map((step) => step.name);
  const [checkedAt, mintedAt, postedAt] = [CHECK, MINT, POST].map((name) => names.indexOf(name));
  assert.ok(checkedAt !== -1 && checkedAt < mintedAt && mintedAt < postedAt, names.join(', '));
  const mint = job.steps[mintedAt];
  assert.equal(mint.uses, undefined);
  assert.deepEqual(mint.env, { GATE_APP_ID: '${{ vars.GATE_APP_ID }}', GATE_APP_PRIVATE_KEY: '${{ secrets.GATE_APP_PRIVATE_KEY }}' });
  const post = job.steps[postedAt];
  assert.equal(post.env.CONTEXT, 'self-hosting');
  assert.equal(post.env.TOKEN, `\${{ steps.${mint.id}.outputs.token }}`);
  assert.match(post.run, /Authorization: Bearer \$\{TOKEN\}/);
});

test('the self-hosting mint step\'s run: is identical to the gate workflow\'s', () => {
  assert.equal(stepNamed(posting(selfHosting()), MINT).run, stepNamed(posting(live), MINT).run);
});

test('in the self-hosting workflow, the private key and the minted token appear only in the mint and post steps\' env, and in no other step', () => {
  const workflow = selfHosting();
  for (const step of stepsOf(workflow)) {
    const env = Object.values(step.env ?? {}).join('\n');
    const named = `${env}\n${step.run ?? ''}\n${step.if ?? ''}`;
    const holdsKey = /secrets\.GATE_APP_PRIVATE_KEY/.test(named);
    const holdsToken = /steps\.mint\.outputs\.token/.test(named);
    if (step.name === MINT) assert.ok(holdsKey && !holdsToken && /secrets\./.test(env), step.name);
    else if (step.name === POST) assert.ok(holdsToken && !holdsKey && /steps\.mint\.outputs\.token/.test(env), step.name);
    else assert.ok(!holdsKey && !holdsToken && !/secrets\./.test(named), step.name);
  }
  const above = JSON.stringify([workflow.env, ...jobsOf(workflow).map((job) => [job.env, job.outputs])]);
  assert.doesNotMatch(above, /secrets\.|steps\.mint/);
});

test('no run: step of the self-hosting workflow interpolates a github.event expression, and event fields reach the scripts through env', () => {
  const workflow = selfHosting();
  for (const step of stepsOf(workflow)) assert.doesNotMatch(step.run ?? '', /\$\{\{/, `${step.job}: ${step.name}`);
  assert.equal(workflow.env.NUMBER, live.env.NUMBER);
  assert.equal(workflow.env.IS_PULL, live.env.IS_PULL);
});

test('the self-hosting workflow\'s first job runs the gate script\'s card mode by its path in the fetched tree, and hands the posting job that card\'s number alone as its output', () => {
  const workflow = selfHosting();
  const [first] = jobsOf(workflow);
  assert.deepEqual(first.outputs, { card: '${{ steps.card.outputs.card }}' });
  assert.equal(stepNamed(first, 'Resolve the card').run, 'node "${RUNNER_TEMP}/${TREE}/scripts/gate-check.mjs" card >> "${GITHUB_OUTPUT}"');
  assert.equal(posting(workflow).needs, first.id);
  assert.equal(first.environment, undefined);
});

test('the self-hosting posting job\'s mapping step runs the gate script\'s map mode by its path in the fetched tree', () => {
  assert.match(stepNamed(posting(selfHosting()), 'Map the event to its pull requests').run, /^node "\$\{RUNNER_TEMP\}\/\$\{TREE\}\/scripts\/gate-check\.mjs" map > /);
});

test('every self-hosting posting job runs in a concurrency group keyed on the workflow and the first job\'s output, never cancelled in progress, whose key for one card differs from the gate workflow\'s', () => {
  const workflow = selfHosting();
  const posters = jobsOf(workflow).filter((job) => job.steps.some((step) => /\/statuses\//.test(step.run ?? '')));
  assert.deepEqual(posters.map((job) => job.id), [posting(workflow).id]);
  const group = '${{ github.workflow }}-${{ needs.card.outputs.card }}';
  for (const job of posters) {
    assert.deepEqual(job.concurrency, { group, 'cancel-in-progress': 'false' });
    assert.equal(job.env.GROUP, group);
  }
  // For one card, the group each workflow's run waits in is the expression with its own name in it.
  const keyed = (named) => posting(named).concurrency.group.replace('${{ github.workflow }}', named.name).replace('${{ needs.card.outputs.card }}', '662');
  assert.equal(posting(live).concurrency.group, group);
  assert.notEqual(keyed(workflow), keyed(live));
});

test('no step or condition of the self-hosting workflow depends on a run being cancelled, and each run reads its facts at its start and posts on the SHA it read', () => {
  const workflow = selfHosting();
  assert.doesNotMatch(JSON.stringify(workflow), /cancelled\(\)|cancel-in-progress":"true/);
  // The facts are read by the script, which the check step runs once the job has started; the post step reads none.
  const post = stepNamed(posting(workflow), POST);
  assert.doesNotMatch(post.run, /pulls\/|gh |node "\$\{RUNNER_TEMP\}\/\$\{TREE\}/);
  assert.match(post.run, /statuses\/\$\{head\}/);
});

test('the self-hosting mint and post steps run only where every step before them succeeded and the event concerns a pull request, so a failed read of the card\'s pull requests or of a pull request posts nothing', () => {
  const job = posting(selfHosting());
  for (const name of [MINT, POST]) assert.equal(stepNamed(job, name).if, 'success() && steps.map.outputs.pulls != \'\'');
  for (const name of ['Map the event to its pull requests', CHECK]) assert.equal(stepNamed(job, name).if, undefined);
});

test('no job of the self-hosting workflow has an id or name equal to rigger/gate or self-hosting', () => {
  for (const job of jobsOf(selfHosting())) {
    for (const named of [job.id, job.name]) assert.ok(!['rigger/gate', 'self-hosting'].includes(named), named);
  }
});

/**
 * Runs the self-hosting posting job's check step on `pulls` with the scripts in `tree` and `env`
 * beside, then, where it succeeded, its post step, with stand-in curl first on PATH recording what
 * it posts. `env` is not handed to the post step, so no PATH it names can put the real curl first.
 */
function checkAndPost(pulls, tree, env = {}) {
  const job = posting(selfHosting());
  const runner = temporaryDirectory('rigger-workflow-runner-');
  mkdirSync(join(runner, 'temp'), { recursive: true });
  symlinkSync(tree, join(runner, 'temp', selfHosting().env.TREE));
  const check = runStep(stepNamed(job, CHECK), { TREE: selfHosting().env.TREE, PULLS: pulls.join(' '), ...env }, {}, runner);
  const post = check.status === 0
    ? runStep(stepNamed(job, POST), { CONTEXT: 'self-hosting', TOKEN: 'minted', GITHUB_REPOSITORY: env.GITHUB_REPOSITORY ?? 'acme/widgets' }, { curl: curlRecording(runner) }, runner)
    : null;
  return { check, post, posts: postsOf(runner) };
}

/** A tree holding a stand-in self-hosting script that prints, for each pull request, what `answers` gives it, and exits with its status. */
function standInTree(answers) {
  const tree = temporaryDirectory('rigger-workflow-tree-');
  mkdirSync(join(tree, '.github', 'scripts'), { recursive: true });
  writeFileSync(join(tree, '.github', 'scripts', 'self-hosting-check.mjs'), `const answers = ${JSON.stringify(answers)};\nconst { printed, status } = answers[process.argv[2]];\nprocess.stdout.write(printed);\nprocess.exitCode = status;\n`);
  return tree;
}

test('the self-hosting workflow posts self-hosting on the SHA the script printed: success where it exited 0, failure otherwise, with its first refusal reason, cut to 140 characters, as the description', () => {
  const long = `owner: ${'é'.repeat(200)}`;
  const { check, post, posts } = checkAndPost([12, 13], standInTree({
    12: { printed: `head: ${SHA}\npassed\n`, status: 0 },
    13: { printed: `head: ${OTHER}\nrefused: ${long}\nrefused: another\n`, status: 1 },
  }));

  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.equal(post.status, 0, post.stdout + post.stderr);
  assert.deepEqual(posts.map((each) => each.url), [SHA, OTHER].map((sha) => `https://api.github.com/repos/acme/widgets/statuses/${sha}`));
  const [passed, refused] = posts.map((each) => JSON.parse(each.body));
  assert.deepEqual({ state: passed.state, context: passed.context }, { state: 'success', context: 'self-hosting' });
  assert.deepEqual(refused, { state: 'failure', context: 'self-hosting', description: [...long].slice(0, 140).join('') });
});

/**
 * A fake forge whose `main` holds this repository's config and an `AGENTS.md` listing
 * `.githooks/`, with card 7's issue and pull request 12 from `rigger-7` at that branch's head,
 * holding `pull`'s facts beside.
 */
function selfHostingForge(pull) {
  const agents = '## What binds\n\n| Document | Authority |\n|---|---|\n| `README.md` | The CLI contract |\n\n## Self-hosting\n\n- The live gate: `.githooks/`.\n';
  const origin = repositoryIn('rigger-workflow-origin-', { 'rigger.config.mjs': `export default ${JSON.stringify(rigger)};\n`, 'AGENTS.md': agents });
  gitIn(origin, 'branch', '-M', 'main');
  gitIn(origin, 'switch', '--quiet', '-c', 'rigger-7');
  gitIn(origin, 'commit', '--allow-empty', '-qm', 'the card\'s work');
  gitIn(origin, 'switch', '--quiet', 'main');
  const head = gitIn(origin, 'rev-parse', 'rigger-7').trim();
  const issues = [{ number: 7, title: 'Card seven', body: '## Acceptance\n\n- The verb prints its help.\n', labels: ['type:change'] }];
  const fake = installFakeGh(temporaryDirectory('rigger-workflow-gh-'), { repo: 'williacj/rigger', project: 6, board: { columns: ['Review'], items: [] }, origin });
  seedRepository(fake, { repo: 'williacj/rigger', issues, pullRequests: [{ number: 12, head: 'rigger-7', sha: head, base: 'main', ...pull }] });
  return { origin, head, fake };
}

/**
 * The environment the workflow's steps run the real scripts under against `forge`: a `gh` first on
 * PATH handing the fake every request, failing one holding `failing` as gh does on a 502, and
 * running `then` once one holding `after` is answered.
 */
function onForge(forge, { failing = 'no request', after = 'no request', then = ':' } = {}) {
  const directory = temporaryDirectory('rigger-workflow-wrapped-gh-');
  fixture(directory, 'gh', [
    'unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY',
    `case "$*" in *'${failing}'*) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;; esac`,
    `'${forge.fake.gh}' "$@"`,
    'status=$?',
    `case "$*" in *'${after}'*) ${then} ;; esac`,
    'exit $status',
  ].join('\n'));
  return { PATH: [directory, dirname(forge.fake.gh), process.env.PATH].join(delimiter), GITHUB_REPOSITORY: 'williacj/rigger' };
}

/** A diff changing `.githooks/pre-commit`, as the forge serves it. */
const HOOK_DIFF = 'diff --git a/.githooks/pre-commit b/.githooks/pre-commit\nindex 3b18e51..8c7e5a6 100644\n--- a/.githooks/pre-commit\n+++ b/.githooks/pre-commit\n@@ -1 +1 @@\n-one\n+two\n';

test('given the forge answers another head when the script reads the pull request again after its diff, the workflow running the script on it posts no self-hosting status for that event', () => {
  const forge = selfHostingForge({ diff: HOOK_DIFF });
  const moved = gitIn(forge.origin, 'commit-tree', '-p', forge.head, '-m', 'moved', `${forge.head}^{tree}`).trim();
  const env = onForge(forge, { after: 'vnd.github.diff', then: `git -C '${forge.origin}' update-ref refs/heads/rigger-7 ${moved}` });

  const { check, post, posts } = checkAndPost([12], ROOT, env);

  assert.notEqual(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stderr, new RegExp(`head moved from ${forge.head} to ${moved}`));
  assert.match(check.stdout, /pull request #12 could not be read, so nothing is posted for this event/);
  assert.equal(post, null);
  assert.deepEqual(posts, []);
});

test('given the diff read fails, or the forge refuses the diff as too large, the workflow running the script posts failure on the head the script read, with a description naming the diff read', () => {
  for (const [pull, failing, named] of [[{ diff: HOOK_DIFF }, 'vnd.github.diff', /HTTP 502/], [{ declined: 'Sorry, the diff exceeded the maximum number of lines (20000)' }, undefined, /maximum number of lines/]]) {
    const forge = selfHostingForge(pull);

    const { check, posts } = checkAndPost([12], ROOT, onForge(forge, { failing }));

    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.deepEqual(posts.map((each) => each.url), [`https://api.github.com/repos/williacj/rigger/statuses/${forge.head}`]);
    const posted = JSON.parse(posts[0].body);
    assert.equal(posted.state, 'failure');
    assert.equal(posted.context, 'self-hosting');
    assert.match(posted.description, /^the read of pull request #12's diff failed: /);
    assert.ok([...posted.description].length <= 140);
    assert.match(check.stdout, named);
  }
});
