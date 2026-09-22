// ABOUTME: Tests the config core against ARCHITECTURE.md's extension points and its published
// ABOUTME: config shape: what a consumer may declare, what is required, and what is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHAPES, validate } from '../src/config/validate.mjs';
import rigger from '../rigger.config.mjs';

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

/** Every declaration the validator requires, as dotted paths, a `*` standing for any name. */
function requiredOf(shape = 'config', path = '') {
  return Object.entries(SHAPES[shape]).flatMap(([key, rule]) => {
    const here = at(path, key);
    const under = rule.keys ? requiredOf(rule.keys, here) : rule.entries ? requiredOf(rule.entries, `${here}.*`) : [];
    return rule.required ? [here, ...under] : under;
  });
}

/** One dotted path against a config, with every `*` expanded to the names that config holds. */
function expand(value, parts) {
  if (parts.length === 0) return [[]];
  const [head, ...rest] = parts;
  const names = head === '*' ? Object.keys(value ?? {}) : value && head in value ? [head] : [];
  return names.flatMap((name) => expand(value[name], rest).map((tail) => [name, ...tail]));
}

/** Every place in a config where the validator reads a value's keys against a shape. */
function shapeSites(value, shape = 'config', path = '') {
  const sites = [path];
  for (const [key, held] of Object.entries(value)) {
    const rule = SHAPES[shape]?.[key];
    if (rule?.keys) sites.push(...shapeSites(held, rule.keys, at(path, key)));
    if (rule?.entries) {
      for (const [name, entry] of Object.entries(held)) {
        sites.push(...shapeSites(entry, rule.entries, at(at(path, key), name)));
      }
    }
  }
  return sites;
}

/** The value one dotted path names inside a config. */
const walkTo = (config, parts) => parts.reduce((held, part) => held[part], config);

/** This config, with the value at one dotted path taken out. */
function without(config, parts) {
  const copy = structuredClone(config);
  delete walkTo(copy, parts.slice(0, -1))[parts.at(-1)];
  return copy;
}

test("the validator accepts this repository's own config unchanged", () => {
  assert.deepEqual(validate(rigger), []);
});

test('every key the validator requires is refused when missing, and the refusal names it', () => {
  const paths = requiredOf().flatMap((path) => expand(rigger, path.split('.')));
  assert.ok(paths.length > 0, 'the validator requires nothing, so nothing was checked');
  for (const parts of paths) {
    const named = parts.join('.');
    const refusals = validate(without(rigger, parts));
    assert.ok(
      refusals.some((refusal) => refusal.includes(`\`${named}\``) && refusal.includes('required')),
      `taking \`${named}\` out earned no refusal naming it: ${refusals.join('; ') || 'none'}`,
    );
  }
});

test('a declaration Rigger does not offer is refused wherever it sits, and the refusal names it', () => {
  const sites = shapeSites(rigger);
  assert.ok(sites.length > 1, 'the config reaches no nested shape, so only the top level was checked');
  for (const site of sites) {
    const config = structuredClone(rigger);
    walkTo(config, site ? site.split('.') : [])['fixedByRiggerAndNotTheConsumer'] = true;
    const named = at(site, 'fixedByRiggerAndNotTheConsumer');
    const refusals = validate(config);
    assert.ok(
      refusals.some((refusal) => refusal.includes(`\`${named}\``)),
      `\`${named}\` earned no refusal naming it: ${refusals.join('; ') || 'none'}`,
    );
  }
});

test('what the validator offers is exactly what ARCHITECTURE.md publishes, in both directions', async () => {
  assert.deepEqual(unique(offered()), unique(declared(await publishedShape())));
});
