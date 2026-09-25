// ABOUTME: The fake `gh`: an executable a test places first on `PATH`, answering the forge
// adapter's commands from the fake board. Test-only, and never named from src/.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFakeBoard } from './fake-board.mjs';

/**
 * The commands the fake `gh` answers, each keyed by how `commandOf` writes it, with what answers
 * it. Nothing else is answered: an unmodelled command fails, printing itself.
 */
const COMMANDS = {};

/** How the fake `gh` names a command it was run with: as the command line itself. */
const spelled = (args) => ['gh', ...args].join(' ');

/**
 * The command `args` run as `gh`, written so that two requests the fake answers alike are one
 * command.
 */
export function commandOf(args) {
  return spelled(args);
}

/** The board a fake `gh` answers from: the model it was given, with every write since replayed. */
async function boardOf(state) {
  const board = createFakeBoard(state.model);
  for (const { operation, args } of state.writes) await board.operations[operation](...args);
  return board;
}

/**
 * Answers the command this process was run with from the board held at `statePath`. What it
 * prints and its exit code are what `gh` would give; a command it does not model fails, printing
 * itself.
 */
export async function main(statePath) {
  const args = process.argv.slice(2);
  const answer = COMMANDS[commandOf(args)];
  if (!answer) {
    process.stderr.write(`the fake gh does not model \`${spelled(args)}\`\n`);
    process.exitCode = 1;
    return;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const board = await boardOf(state);
  const data = await answer(board, state, args);
  writeFileSync(statePath, JSON.stringify({ ...state, writes: board.writes() }));
  process.stdout.write(`${JSON.stringify({ data })}\n`);
}

/**
 * Installs a fake `gh` in `dir`, answering as `gh` would for the board numbered `project` among
 * the boards of `repo`'s owner, which holds `board`: the fake board's own arguments.
 *
 * It returns the executable's path, `gh`, and `model()`, the fake board as the fake `gh` now holds
 * it, whose write record holds every write the fake `gh` was sent.
 */
export function installFakeGh(dir, { repo, project, board = {} }) {
  const statePath = join(dir, 'board.json');
  writeFileSync(statePath, JSON.stringify({ repo, project, model: board, writes: [] }));
  const gh = join(dir, 'gh');
  // CommonJS, because nothing beside it says otherwise, and so it loads this module dynamically.
  const entry = `import(${JSON.stringify(import.meta.url)}).then(({ main }) => main(${JSON.stringify(statePath)}));\n`;
  writeFileSync(gh, `#!${process.execPath}\n${entry}`);
  chmodSync(gh, 0o755);
  return { gh, model: () => boardOf(JSON.parse(readFileSync(statePath, 'utf8'))) };
}
