// ABOUTME: The `setup-board` verb: it reads the board the config names, works out what the config
// declares and the board lacks, and adds that through the schema-write side, one line per write.

import { selectedLabels, validate } from '../config/validate.mjs';
import { boardOf, readSide } from '../substrate/forge/read.mjs';
import { schemaWriteSide } from '../substrate/forge/schema-write.mjs';
import { loadConfig, workingTree } from './doctor.mjs';

/** The type GitHub names a single-select field by, which is the only type a priority field may be. */
const SINGLE_SELECT = 'SINGLE_SELECT';

/**
 * What the board holds that setup-board compares the config against: the names of its columns,
 * every field's name and type, and the repository's labels. Read before anything is written.
 */
async function survey(board) {
  const read = readSide(board);
  return {
    columns: boardOf('setup-board', board).columns.options.map((option) => option.name),
    fields: await read.readFieldTypes(),
    labels: await read.readLabels(),
  };
}

/**
 * The writes that add what `config` declares and `held` lacks, each as the schema-write
 * operation, its arguments and the line printed for it, or `{ refusal }` where the board cannot
 * take the config without changing something it already holds. Nothing held is ever removed,
 * renamed or changed: a priority field already there is left as it is, whatever its options.
 */
function writesFor(config, held) {
  const writes = [];
  for (const name of new Set(Object.values(config.board.columns))) {
    if (!held.columns.includes(name)) writes.push({ operation: 'createColumn', args: [name], line: `added the column ${name}` });
  }
  const { priority } = config.board;
  if (priority) {
    const field = held.fields.find(({ name }) => name === priority.field);
    if (field && field.type !== SINGLE_SELECT) {
      return { refusal: `the board's field ${field.name} is a ${field.type} field, and a priority field is ${SINGLE_SELECT}, so nothing was written` };
    }
    if (!field) {
      writes.push({ operation: 'createField', args: [priority.field, priority.options], line: `created the field ${priority.field} with the options ${priority.options.join(', ')}` });
    }
  }
  for (const name of selectedLabels(config)) {
    if (!held.labels.includes(name)) writes.push({ operation: 'createLabel', args: [name], line: `created the label ${name}` });
  }
  return { writes };
}

/** What the command prints for a `setup-board` run, and the status it exits with. */
export async function setupBoard({ target = process.cwd() } = {}) {
  const { named, refusal } = workingTree('setup-board', { target });
  if (refusal) return { text: refusal, code: 1 };
  const { config, unread } = await loadConfig(named);
  if (unread) return { text: `rigger setup-board: ${unread}`, code: 1 };
  const refusals = validate(config);
  if (refusals.length > 0) return { text: `rigger setup-board: \`${named}\`'s config earns refusals, so nothing was written: ${refusals.join('; ')}`, code: 1 };

  const board = { repo: config.repo, ...config.board };
  const where = `board ${board.project}`;
  let planned;
  try {
    planned = writesFor(config, await survey(board));
  } catch (error) {
    return { text: `rigger setup-board: ${error.message}, so nothing was written`, code: 1 };
  }
  if (planned.refusal) return { text: `rigger setup-board: ${planned.refusal}`, code: 1 };

  const side = schemaWriteSide(board);
  const made = [];
  for (const { operation, args, line } of planned.writes) {
    try {
      await side[operation](...args);
    } catch (error) {
      return { text: [`rigger setup-board: ${made.length} writes to ${where} before one failed`, ...made, `  ${error.message}`].join('\n'), code: 1 };
    }
    made.push(`  ${line}`);
  }
  return { text: [`rigger setup-board: ${made.length} writes to ${where}`, ...made].join('\n'), code: 0 };
}
