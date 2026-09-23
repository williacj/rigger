// ABOUTME: Tests the config core against ARCHITECTURE.md's extension points and its published
// ABOUTME: config shape: what a consumer may declare, what is required, and what is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES, SHAPES, validate, workRequires } from '../src/config/validate.mjs';
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

/**
 * Every place the validator reads a value's keys against a shape, derived from the shape table
 * rather than from what one config happens to hold.
 *
 * Reading a config's values instead would only ever reach the sites that config nests, which is
 * narrower than the class: a container key holds no shape of its own, so it is never a site, and
 * three of them went unwatched until the sites came from the table.
 */
function shapeSites(shape = 'config', path = '') {
  return [path, ...Object.entries(SHAPES[shape]).flatMap(([key, rule]) => {
    if (rule.keys) return shapeSites(rule.keys, at(path, key));
    if (rule.entries) return shapeSites(rule.entries, `${at(path, key)}.*`);
    return [];
  })];
}

/**
 * Every place the validator reads a value's keys as consumer-chosen names, each holding a shape.
 * A container is not a shape site — its keys are the consumer's — but it holds declarations just
 * the same, so it is refused for holding none.
 */
function containerSites(shape = 'config', path = '') {
  return Object.entries(SHAPES[shape]).flatMap(([key, rule]) => {
    if (rule.keys) return containerSites(rule.keys, at(path, key));
    if (rule.entries) return [at(path, key), ...containerSites(rule.entries, `${at(path, key)}.*`)];
    return [];
  });
}

/** The value one dotted path names inside a config. */
const walkTo = (config, parts) => parts.reduce((held, part) => held[part], config);

/** This config, with the value at one dotted path taken out. */
function without(config, parts) {
  const copy = structuredClone(config);
  delete walkTo(copy, parts.slice(0, -1))[parts.at(-1)];
  return copy;
}

/** This config, with the value at one dotted path replaced. The empty path is the config itself. */
function holding(config, parts, value) {
  if (parts.length === 0) return value;
  const copy = structuredClone(config);
  walkTo(copy, parts.slice(0, -1))[parts.at(-1)] = value;
  return copy;
}

/**
 * Every concrete path this config offers for one site of the table, each `*` expanded to the
 * names the config holds there. A site the config exercises nowhere is a site this suite cannot
 * watch, so it fails rather than passing over it.
 */
function instancesOf(site) {
  const paths = site === '' ? [[]] : expand(rigger, site.split('.'));
  assert.ok(paths.length > 0, `this repository's config holds nothing at \`${site}\`, so the site went unchecked`);
  return paths;
}

test("the validator accepts this repository's own config unchanged", () => {
  assert.deepEqual(validate(rigger), []);
});

test('a declaration that holds no declarations is refused wherever it sits, and the refusal names it', () => {
  // Every place the validator reads declarations, whether their keys are Rigger's or the
  // consumer's. The top level is one site among them and not a special case, which is the whole
  // claim: a value that is not a set of declarations earns one refusal naming where it sits,
  // never a throw and never one refusal per character of a string.
  const everywhere = [...shapeSites(), ...containerSites()];
  for (const site of everywhere) {
    for (const parts of instancesOf(site)) {
      for (const nothing of [null, undefined, 'npm ci', ['npm ci'], 3]) {
        const named = parts.join('.');
        const refusals = validate(holding(rigger, parts, nothing));
        assert.equal(
          refusals.length,
          1,
          `\`${named || 'the config'}\` holding ${JSON.stringify(nothing) ?? 'undefined'} earned ${refusals.length} refusals: ${refusals.join('; ') || 'none'}`,
        );
        assert.ok(
          refusals[0].includes(named === '' ? 'the config' : `\`${named}\``),
          `\`${named || 'the config'}\` holding ${JSON.stringify(nothing) ?? 'undefined'} earned a refusal that does not name it: ${refusals[0]}`,
        );
      }
    }
  }
});

test('a config declaring nothing at all is refused for each of the four keys Rigger cannot act without', () => {
  // Written out rather than derived from the shape table, which the test below reads: a required
  // key dropped from that table would take itself out of the derivation and go unnoticed. What
  // Rigger can do nothing without is a judgement this card makes, so it is pinned by hand.
  const refusals = validate({});
  for (const key of ['repo', 'board', 'roles', 'kinds']) {
    assert.ok(
      refusals.some((refusal) => refusal.includes(`\`${key}\``) && refusal.includes('required')),
      `a config declaring nothing earned no refusal requiring \`${key}\`: ${refusals.join('; ') || 'none'}`,
    );
  }
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

// proves R-SCHED-10
test('a declaration Rigger does not offer is refused wherever it sits, and the refusal names it', () => {
  const sites = shapeSites().flatMap(instancesOf);
  assert.ok(sites.length > 1, 'the config reaches no nested shape, so only the top level was checked');
  for (const parts of sites) {
    const config = structuredClone(rigger);
    walkTo(config, parts)['fixedByRiggerAndNotTheConsumer'] = true;
    const named = at(parts.join('.'), 'fixedByRiggerAndNotTheConsumer');
    const refusals = validate(config);
    assert.ok(
      refusals.some((refusal) => refusal.includes(`\`${named}\``)),
      `\`${named}\` earned no refusal naming it: ${refusals.join('; ') || 'none'}`,
    );
  }
});

// proves R-SCHED-10, R-LOOP-10
test('what the validator offers is exactly what ARCHITECTURE.md publishes, in both directions', async () => {
  assert.deepEqual(unique(offered()), unique(declared(await publishedShape())));
});

/** This repository's config with one kind of work altered, which is what these rules bind. */
const withKind = (change) => ({
  ...rigger,
  kinds: { ...rigger.kinds, change: { ...rigger.kinds.change, ...change } },
});

/** The one refusal this config earns, or a readable failure naming however many it earned. */
function refusal(config) {
  const refusals = validate(config);
  assert.equal(refusals.length, 1, `expected one refusal, got ${refusals.length}: ${refusals.join('; ') || 'none'}`);
  return refusals[0];
}

test('every kind this repository declares names one maker role and an ordered list of judge roles', () => {
  const names = Object.keys(rigger.roles);
  assert.ok(Object.keys(rigger.kinds).length > 0, 'the config declares no kind of work');
  for (const [name, kind] of Object.entries(rigger.kinds)) {
    assert.ok(names.includes(kind.maker), `kinds.${name} makes its work with \`${kind.maker}\`, which is no declared role`);
    assert.ok(Array.isArray(kind.judges) && kind.judges.length > 0, `kinds.${name} names no ordered list of judges`);
    for (const judge of kind.judges) {
      assert.ok(judge === 'owner' || names.includes(judge), `kinds.${name} is judged by \`${judge}\`, which is no declared role`);
    }
  }
});

test('a kind whose maker is no role the config declares is refused, and the refusal names it', () => {
  const earned = refusal(withKind({ maker: 'architect' }));
  assert.match(earned, /`kinds\.change\.maker`/);
  assert.match(earned, /architect/);
});

test('a kind naming more than one maker is refused, because a kind has one maker', () => {
  assert.match(refusal(withKind({ maker: ['engineer', 'pm'] })), /`kinds\.change\.maker`/);
});

test('a kind whose judge is neither a declared role nor the owner is refused, and the refusal names it', () => {
  const earned = refusal(withKind({ judges: ['reviewer', 'adjudicator'] }));
  assert.match(earned, /`kinds\.change\.judges`/);
  assert.match(earned, /adjudicator/);
});

test('a kind that names no judge at all is refused, because no work is delivered unjudged', () => {
  assert.match(refusal(withKind({ judges: [] })), /`kinds\.change\.judges`/);
});

test('a kind whose judges are not an ordered list is refused, because their order is the rule', () => {
  assert.match(refusal(withKind({ judges: 'reviewer' })), /`kinds\.change\.judges`/);
});

// proves R-LOOP-11
test('a kind naming the owner anywhere but last is refused, and the refusal names the position', () => {
  // None of these names `engineer`, which is this kind's maker: a fixture that named it would
  // earn the separation refusal too, and pass this test for the wrong rule.
  for (const judges of [['owner', 'reviewer'], ['reviewer', 'owner', 'pm'], ['owner', 'owner']]) {
    const earned = refusal(withKind({ judges }));
    assert.match(earned, /`kinds\.change\.judges`/, judges.join(', '));
    assert.match(earned, /owner/, judges.join(', '));
  }
});

test('a kind naming the owner last is accepted, and so is one naming the owner not at all', () => {
  assert.deepEqual(validate(withKind({ judges: ['reviewer', 'owner'] })), []);
  assert.deepEqual(validate(withKind({ judges: ['reviewer'] })), []);
});

// proves R-LOOP-3
test('a kind naming one role as both its maker and a judge is refused, and the refusal names it', () => {
  for (const judges of [['engineer'], ['reviewer', 'engineer'], ['engineer', 'owner']]) {
    const earned = refusal(withKind({ maker: 'engineer', judges }));
    assert.match(earned, /`kinds\.change`/, judges.join(', '));
    assert.match(earned, /engineer/, judges.join(', '));
  }
});

// proves R-SCHED-10, R-ESCALATE-2
test('an escalation category Rigger does not offer is refused, and the refusal names it', () => {
  assert.match(refusal({ ...rigger, escalate: ['critical', 'infrastructure'] }), /infrastructure/);
});

// proves R-ESCALATE-2
test('a consumer choosing among the fixed categories is accepted, adding none of its own', async () => {
  // R-ESCALATE-2: the set is Rigger's, a consumer chooses which of them are the owner's, and all
  // are unless the consumer says otherwise. The default the architecture publishes is therefore
  // the whole set, which is what the offered categories are checked against.
  const every = (await publishedShape()).escalate;
  assert.deepEqual(unique(CATEGORIES), unique(every));
  assert.deepEqual(validate({ ...rigger, escalate: [] }), []);
  for (const category of every) assert.deepEqual(validate({ ...rigger, escalate: [category] }), []);
  assert.deepEqual(validate({ ...rigger, escalate: every }), []);
});

// proves R-PROV-1
test('a provisioning step that declares nothing is read as optional', () => {
  // R-PROV-1: a step declares whether the work requires it, and one that does not declare it is
  // optional. The expected readings come from that row and from D12, which has this repository's
  // own config carrying one of each.
  assert.equal(workRequires({ run: 'brew install vhs' }), false);
  assert.equal(workRequires({ run: 'npm ci', required: true }), true);
  assert.equal(workRequires({ run: 'npm ci', required: false }), false);
  assert.equal(workRequires(rigger.provisioning.vhs), false);
  assert.equal(workRequires(rigger.provisioning['npm-ci']), true);
});

test('a provisioning step whose declaration is not a boolean is refused, so nothing is read as required by truthiness', () => {
  const config = { ...rigger, provisioning: { ...rigger.provisioning, vhs: { ...rigger.provisioning.vhs, required: 'yes' } } };
  assert.match(refusal(config), /`provisioning\.vhs\.required`/);
});

// proves R-LOOP-11
test('a role called owner is refused, because the owner is the one judge that is not a role', () => {
  const declared = { ...rigger, roles: { ...rigger.roles, owner: { agent: 'a.md', provider: 'claude', tier: 'high' } } };
  assert.match(refusal(declared), /`roles\.owner`/);
});
