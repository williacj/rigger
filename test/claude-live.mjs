// ABOUTME: What the gated live runs of a real `claude` session share: the gate, the PATH past
// npm test's refusing agent CLIs, the stand-in MCP server and agent file, and reading the run's record.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

/*
 * What these runs reach. Each starts one real `claude -p` session, signed in as the host's owner,
 * which reaches Anthropic's service and nothing else these tests start: no forge, no board, and no
 * connector, since the invocation withholds every one and the attempt on one is meant to find it
 * absent. The MCP server a session may call is a stand-in written here, which answers on standard
 * input and output and opens no socket. Each prompt asks only for the loaded set, a marker, one
 * call to that server and one attempt on a connector, and the tests fail on any Bash tool call
 * (ruling 2 on #467).
 *
 * The variable that runs them is `RIGGER_LIVE_CLAUDE`, set to `1`. They find the real `claude` the
 * way `test/forge-runners.test.mjs` finds the real `gh`: on this process's PATH, past the directory
 * `npm test` puts its refusing one in (`test/suite.sh`).
 *
 * Each run lives in a test file of its own. A file that loaded both this checkout's L0 process
 * adapter and the installed package's failed with `RangeError: Map maximum size exceeded`, thrown
 * from the exit cleanup's `newListener` hook in the second copy: each copy puts its own cleanup
 * back ahead of the other's.
 */

export const LIVE = process.env.RIGGER_LIVE_CLAUDE === '1';
export const skip = LIVE ? false : 'a live run starts a real claude session; set RIGGER_LIVE_CLAUDE=1 to run it';

/** How long one session may run before L0 ends it. */
export const SESSION = 300_000;

/** The PATH this process inherited, without the directory holding `npm test`'s refusing agent CLIs. */
export function pastRefusing() {
  const refusing = process.env.RIGGER_REFUSING_AGENT_DIR;
  const path = process.env.PATH ?? '';
  if (refusing === undefined) return path;
  return path.split(delimiter).filter((entry) => resolve(entry || '.') !== resolve(refusing)).join(delimiter);
}

/** A scratch directory under `TMPDIR`, by its real path, removed when the test ends. */
export function scratch(t) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'rigger-claude-live-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * Removes, when the test ends, the transcript Claude Code keeps under the owner's
 * `~/.claude/projects/` for a session run in `directory`. Claude Code names that directory for the
 * path, with every character but a letter or a digit read as `-`, as c2's `memory_paths` in #473's
 * report shows. The removal names that one directory, which the run made, and nothing else.
 */
export function forgetting(t, directory) {
  t.after(() => rmSync(transcriptsOf(directory), { recursive: true, force: true }));
}

/** Where Claude Code keeps the transcripts of sessions run in `directory`, as `forgetting` names it. */
export const transcriptsOf = (directory) => join(homedir(), '.claude', 'projects', directory.replace(/[^a-zA-Z0-9]/g, '-'));

/**
 * Every built-in tool #480's pull request classifies as acting within the session or on its host,
 * on Claude Code 2.1.287. A start record offering any tool outside this list and the withheld ones
 * has a tool nobody has classified, which may act through the owner's account.
 */
export const CLASSIFIED = [
  'Task', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'Edit', 'Monitor', 'NotebookEdit', 'Read',
  'ReportFindings', 'ScheduleWakeup', 'TaskStop', 'ToolSearch', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
];

/** The tools in a start record's `tools` that are neither classified nor the directory's own MCP tools. */
export const unclassified = (tools) => tools.filter((tool) => !CLASSIFIED.includes(tool) && !tool.startsWith('mcp__'));

/** The tools the invocation `args` withhold by `--disallowedTools`. */
export const withheldBy = (args) => args[args.indexOf('--disallowedTools') + 1].split(',');

/** Writes `content` at `path` under `directory`, making its parents. */
export function put(directory, path, content) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), content);
}

/**
 * A stdio MCP server offering one tool, `echo`, which answers `marker`. It appends a line to
 * `started` beside itself when it starts, which is the record of its loading that the session's
 * own answer is not.
 */
export const SERVER = (marker) => `// ABOUTME: A throwaway MCP server for one live run.
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
appendFileSync(join(__dirname, 'started'), 'started\\n');
let buffer = '';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim() === '') continue;
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    if (method === 'initialize') send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'c480live', version: '1.0.0' } } });
    else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'echo', description: 'Answers a fixed marker.', inputSchema: { type: 'object', properties: {} } }] } });
    else if (method === 'tools/call') send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '${marker}' }] } });
    else send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no such method' } });
  }
});
`;

/** An agent file whose last sentence carries `marker`. */
export const AGENT = (marker) => [
  '---',
  'name: live',
  'description: A role for one live run.',
  '---',
  '',
  '# Live',
  '',
  'Answer the question you are asked, briefly. Use no Bash tool.',
  '',
  `The marker at the end of this role file is ${marker}.`,
  '',
].join('\n');

/** Every event a `stream-json` run printed, parsed, one per line. */
export const eventsOf = (stdout) => stdout.toString('utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));

/** Every tool call the session made, by name, with the result it was handed, in order. */
export function callsOf(events) {
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    for (const block of event.message?.content ?? []) if (block.type === 'tool_result') results.set(block.tool_use_id, block);
  }
  const calls = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) if (block.type === 'tool_use') calls.push({ name: block.name, input: block.input, result: results.get(block.id) });
  }
  return calls;
}

/** The text a tool result carried. */
export const textOf = (result) => (typeof result?.content === 'string' ? result.content : (result?.content ?? []).map((part) => part.text ?? '').join(''));

/**
 * Runs the invocation `invocation` answers through the process adapter `runCommand`, with an L0
 * emitter that records any kill, under this process's environment less the variables it names to
 * unset, then with the variables it names to set, in the order ruling 9 on #467 gives
 * `roleDispatch`, and the real `claude` first on PATH. It hands back the run's events and its result.
 */
export async function session({ invocation, runCommand }, request) {
  const killed = [];
  const emitter = { emit: (event, fields) => killed.push({ event, ...fields }) };
  const { command, args, input, unset, env: set } = await invocation({ ...request, emitter });
  const env = { ...process.env, PATH: pastRefusing() };
  for (const variable of unset) delete env[variable];
  Object.assign(env, set);
  const result = await runCommand({ command, args, input, cwd: request.directory, env, timeout: SESSION, emitter });
  const events = eventsOf(result.stdout);
  return { command, args, env: set, result, events, killed, init: events.find((event) => event.type === 'system' && event.subtype === 'init'), answer: events.find((event) => event.type === 'result')?.result ?? '' };
}
