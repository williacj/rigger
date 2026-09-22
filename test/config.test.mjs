// ABOUTME: Tests the config core against ARCHITECTURE.md's extension points and its published
// ABOUTME: config shape: what a consumer may declare, what is required, and what is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHAPES, validate } from '../src/config/validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The config shape `ARCHITECTURE.md` publishes under its extension-point table, run rather than
 * read, so the test compares against the architecture's own object and not a retyping of it.
 *
 * That document is the authority for what a consumer may declare (`AGENTS.md`, "What binds"), so
 * the block is found by what it is — the fenced JavaScript that exports a config — rather than by
 * where it sits, and a block that stops being valid JavaScript fails here rather than silently
 * matching nothing.
 */
async function publishedShape() {
  const architecture = readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8');
  const blocks = [...architecture.matchAll(/```js\r?\n([\s\S]*?)```/g)].map(([, body]) => body);
  const shapes = blocks.filter((body) => body.includes('export default'));
  assert.equal(shapes.length, 1, 'ARCHITECTURE.md publishes no single config shape to check against');
  const module = await import(`data:text/javascript,${encodeURIComponent(shapes[0])}`);
  return module.default;
}

/** Where a key sits, as a refusal names it. */
const at = (path, key) => (path ? `${path}.${key}` : key);

/**
 * Every declaration the validator offers, as dotted paths. A shape reached through a
 * consumer-named key contributes a `*` for that name, because Rigger fixes the shape and the
 * consumer fixes the name.
 */
function offered(shape = 'config', path = '') {
  return Object.entries(SHAPES[shape]).flatMap(([key, rule]) => {
    const here = at(path, key);
    if (rule.keys) return offered(rule.keys, here);
    if (rule.entries) return offered(rule.entries, `${here}.*`);
    return [here];
  });
}

/**
 * Every declaration a config makes, as the same dotted paths. The walk is steered by the shapes
 * the validator offers, and a key no shape names is emitted where it sits: a config that declares
 * something unoffered shows up as an extra path rather than disappearing into the walk.
 */
function declared(value, shape = 'config', path = '') {
  return Object.entries(value).flatMap(([key, held]) => {
    const rule = SHAPES[shape]?.[key];
    const here = at(path, key);
    if (rule?.keys) return declared(held, rule.keys, here);
    if (rule?.entries) return Object.values(held).flatMap((entry) => declared(entry, rule.entries, `${here}.*`));
    return [here];
  });
}

const unique = (paths) => [...new Set(paths)].sort();

test('a config that names none of the required keys is refused, and each refusal names its key', () => {
  const refusals = validate({});
  assert.ok(refusals.some((refusal) => refusal.includes('`repo`')), refusals.join('\n'));
});

test('a declaration Rigger does not offer is refused, and the refusal names it', () => {
  const refusals = validate({ worktreeRoot: '/tmp/worktrees' });
  assert.ok(refusals.some((refusal) => refusal.includes('`worktreeRoot`')), refusals.join('\n'));
});

test('a kind that names no maker is refused, and the refusal names that kind`s maker', () => {
  const refusals = validate({ kinds: { change: { judges: ['reviewer'] } } });
  assert.ok(refusals.some((refusal) => refusal.includes('`kinds.change.maker`')), refusals.join('\n'));
});

test('what the validator offers is exactly what ARCHITECTURE.md publishes, in both directions', async () => {
  assert.deepEqual(unique(offered()), unique(declared(await publishedShape())));
});
