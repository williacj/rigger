// ABOUTME: Refuses a register that allocates one id twice. A retired id stays allocated, so the
// ABOUTME: live register and the retired one are counted together.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Where the registers live. Which files sit here is theirs to say: a register allocates an id by
// writing a row, and the retired one says its ids still count, so every file here is read.
const REGISTER = 'docs/spec';

/** The cells of one markdown table row, trimmed, with the empty edges the pipes make dropped. */
function cells(line) {
  return line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
}

/**
 * Every id one document allocates: the first column of each table the register headed `id`.
 *
 * A register writes a decision twice — once as a row and once as the body below it — and only
 * the row is the allocation. Asking the table for its own header is what tells an allocation
 * apart from every other table and every other mention of an id.
 */
export function idRows(text) {
  const found = [];
  let allocating = false;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) {
      allocating = false;
      continue;
    }
    const row = cells(line);
    if (row[0] === 'id') allocating = true;
    else if (allocating && !/^-+$/.test(row[0])) found.push(row[0]);
  }
  return found;
}

/** Every id the register allocates more than once, and the files the rows sit in. */
export function check(root) {
  const rows = readdirSync(join(root, REGISTER))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) => {
      const path = `${REGISTER}/${name}`;
      return idRows(readFileSync(join(root, REGISTER, name), 'utf8')).map((id) => ({ id, path }));
    });
  const allocated = new Map();
  for (const { id, path } of rows) allocated.set(id, [...(allocated.get(id) ?? []), path]);
  const findings = [...allocated]
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, rows: paths }));
  return { findings, failing: findings.length > 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CI passes no argument and this repository is read. A path reads that repository instead,
  // which is how a test watches the check refuse one.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { findings, failing } = check(process.argv[2] ? resolve(process.argv[2]) : here);
  for (const { id, rows } of findings) console.error(`${id} is allocated ${rows.length} times: ${rows.join(', ')}`);
  console.log(`${String(findings.length).padStart(6)}  ids allocated more than once, across ${REGISTER}`);
  if (failing) {
    console.error('An id names one thing and is never reused. Allocate a new one, and leave the old row where it is.');
    process.exit(1);
  }
}
