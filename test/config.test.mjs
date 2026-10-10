// ABOUTME: Tests the config core against ARCHITECTURE.md's extension points and its published
// config shape: what a consumer may declare, what is required, and what is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { CATEGORIES, SHAPES, declaredLabels, selectedLabels, validate, workRequires } from '../src/config/validate.mjs';
import rigger from '../rigger.config.mjs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { roleTimeout } from '../src/config/validate.mjs';

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

/** The rule one shape gives one key, read from the shape's own keys and nowhere else. */
const ruleFor = (shape, key) => (Object.hasOwn(SHAPES[shape] ?? {}, key) ? SHAPES[shape][key] : undefined);

/** Whether a value is a set of declarations, as the validator reads one. */
const declares = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
    const rule = ruleFor(shape, key);
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
  // Own keys on both branches, as the validator reads them: a path followed through a prototype
  // would expand to a key the config never declared.
  const names = head === '*'
    ? Object.keys(value ?? {})
    : declares(value) && Object.hasOwn(value, head) ? [head] : [];
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
 * Every key an object holds whether its author wrote one or not, taken from the runtime rather
 * than listed here, and one key nothing holds unless its author wrote it.
 *
 * A probe that only ever uses the last of these tells nothing about the others: a check reading
 * `key in shape` answers yes to every inherited name and no to that one, so it passes a test
 * built from it while offering eleven declarations Rigger never published.
 */
const INHERITED = Object.getOwnPropertyNames(Object.prototype);
const UNOFFERED = [...INHERITED, 'fixedByRiggerAndNotTheConsumer'];

/**
 * This config, with one key declared on the value at a dotted path. Declared through
 * `defineProperty` rather than by assignment, because assigning to `__proto__` sets a prototype
 * where every other name would have made an own key, and the one name that behaves differently
 * is the one worth probing.
 */
function declaring(config, parts, key) {
  const copy = structuredClone(config);
  Object.defineProperty(walkTo(copy, parts), key, {
    value: true, enumerable: true, configurable: true, writable: true,
  });
  return copy;
}

/**
 * This config, with the key at a dotted path inherited from a prototype rather than declared on
 * the value that should declare it. Inheriting is not declaring, so Rigger reads it as absent.
 */
function inheriting(config, parts) {
  const copy = structuredClone(config);
  const holder = walkTo(copy, parts.slice(0, -1));
  const key = parts.at(-1);
  const prototype = { [key]: holder[key] };
  delete holder[key];
  Object.setPrototypeOf(holder, prototype);
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

/**
 * Every value the starter config carries where only the consumer can answer it, as the dotted
 * path it sits at and the placeholder it arrives holding.
 *
 * Read off the shape table rather than listed here, so a third value that arrives as a name is
 * watched by this suite from the moment its rule declares one.
 */
function placeholders(shape = 'config', path = '') {
  return Object.entries(SHAPES[shape]).flatMap(([key, rule]) => {
    const here = at(path, key);
    if (rule.keys) return placeholders(rule.keys, here);
    return rule.placeholder === undefined ? [] : [[here, rule.placeholder]];
  });
}

test('a config still holding a starter placeholder is refused, and the refusal names the path and the placeholder', () => {
  // A placeholder is a name where a value belongs, so a config still holding one has not been
  // answered. The defect this catches is the quiet half: `board.project` cannot be filled from
  // git or from anything else `init` can read, so a number left as it shipped would have Rigger
  // work whatever board that number happens to name in the consumer's account.
  const found = placeholders();
  assert.ok(found.length > 0, 'the shape table declares no placeholder, so this checks nothing');

  for (const [path, placeholder] of found) {
    const refused = refusal(holding(rigger, path.split('.'), placeholder));
    assert.ok(refused.includes(`\`${path}\``), `\`${path}\` holding its placeholder earned a refusal that does not name it: ${refused}`);
    assert.ok(refused.includes(placeholder), `\`${path}\` holding \`${placeholder}\` earned a refusal that does not name it: ${refused}`);
  }
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

test('a key the config inherits rather than declares is refused as missing, and the refusal names it', () => {
  // Inheriting is not declaring. A required key answered by an object's prototype was never
  // written by the consumer, so Rigger reads it as absent rather than as satisfied.
  const paths = requiredOf().flatMap((path) => expand(rigger, path.split('.')));
  assert.ok(paths.length > 0, 'the validator requires nothing, so nothing was checked');
  for (const parts of paths) {
    const named = parts.join('.');
    const refusals = validate(inheriting(rigger, parts));
    assert.ok(
      refusals.some((refusal) => refusal.includes(`\`${named}\``) && refusal.includes('required')),
      `inheriting \`${named}\` rather than declaring it earned no refusal naming it: ${refusals.join('; ') || 'none'}`,
    );
  }
});

// proves R-SCHED-10
test('a declaration Rigger does not offer is refused wherever it sits, and the refusal names it', () => {
  const sites = shapeSites().flatMap(instancesOf);
  assert.ok(sites.length > 1, 'the config reaches no nested shape, so only the top level was checked');
  for (const parts of sites) {
    for (const key of UNOFFERED) {
      const named = at(parts.join('.'), key);
      const refusals = validate(declaring(rigger, parts, key));
      assert.ok(
        refusals.some((refusal) => refusal.includes(`\`${named}\``)),
        `\`${named}\` earned no refusal naming it: ${refusals.join('; ') || 'none'}`,
      );
    }
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

// The stand-in is `adjudicator` because `D18` defers that role and names what returns it, so it
// is the one name this config is guaranteed not to declare. It held `architect` until this
// repository staffed the architect, at which point the fixture stopped standing in for anything
// and the test passed on a config it was no longer describing.
test('a kind whose maker is no role the config declares is refused, and the refusal names it', () => {
  const earned = refusal(withKind({ maker: 'adjudicator' }));
  assert.match(earned, /`kinds\.change\.maker`/);
  assert.match(earned, /adjudicator/);
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

// proves R-SCHED-14
test('a kind whose select.labels is empty is refused, and the refusal names that kind', () => {
  assert.match(refusal(withKind({ select: { labels: [] } })), /`kinds\.change\.select\.labels`/);
});

// The engine reads `select.labels` as a list when it selects cards, so a value that is no list
// would reach it as a throw rather than being refused when the config loads.
test('a kind whose select.labels is not a list is refused, and the refusal names that key', () => {
  for (const labels of ['type:change', 3, { change: 'type:change' }, null]) {
    assert.match(refusal(withKind({ select: { labels } })), /`kinds\.change\.select\.labels`/, JSON.stringify(labels));
  }
});

// A card carries labels by name, so an entry that is no non-empty string names no label a card
// could carry.
test('a kind whose select.labels holds an entry that is no label name is refused, and the refusal names that key', () => {
  for (const labels of [[''], ['type:change', 3], [null]]) {
    assert.match(refusal(withKind({ select: { labels } })), /`kinds\.change\.select\.labels`/, JSON.stringify(labels));
  }
});

test('a declared epic label that is one label name is accepted', () => {
  for (const epicLabel of ['type:epic', 'kind:epic']) {
    assert.deepEqual(validate({ ...rigger, epicLabel }), [], epicLabel);
  }
});

// A card carries labels by name, so an epic label that is no name marks no card, and a list
// declares more than the one label that marks an epic.
test('a declared epic label that is not one label name is refused, and the refusal names the key', () => {
  for (const epicLabel of ['', '   ', 3, null, undefined, true, ['type:epic'], { label: 'type:epic' }]) {
    assert.match(refusal({ ...rigger, epicLabel }), /`epicLabel`/, JSON.stringify(epicLabel) ?? 'undefined');
  }
});

// A kind selecting the epic label would have every card it selects count as an epic, and so
// never be pulled (`R-SCHED-11`), without anyone being told.
test('an epic label that a kind selects is refused, and the refusal names the key, the kind and the label', () => {
  const earned = refusal({ ...rigger, epicLabel: 'type:spec' });
  assert.match(earned, /`epicLabel`/);
  assert.match(earned, /`kinds\.spec`/);
  assert.match(earned, /`type:spec`/);

  const second = refusal({
    ...withKind({ select: { labels: ['type:change', 'type:epic'] } }),
    epicLabel: 'type:epic',
  });
  assert.match(second, /`epicLabel`/);
  assert.match(second, /`kinds\.change`/);
  assert.match(second, /`type:epic`/);
});

// GitHub holds label names case-insensitively (#301's measurement), so `Type:Epic` and `type:epic`
// are one label there.
test('an epic label differing only in letter case from a label a kind selects is refused, naming that kind', () => {
  const earned = refusal({
    ...withKind({ select: { labels: ['type:change', 'type:epic'] } }),
    epicLabel: 'Type:Epic',
  });
  assert.match(earned, /`epicLabel`/);
  assert.match(earned, /`kinds\.change`/);
});

test('an epic label no kind selects under any letter case earns no refusal naming epicLabel', () => {
  const refusals = validate({
    ...withKind({ select: { labels: ['type:change', 'type:epics'] } }),
    epicLabel: 'Type:Epic',
  });
  assert.deepEqual(refusals.filter((held) => held.includes('`epicLabel`')), []);
});

// proves R-SCHED-14
test('a kind selecting one label or two is accepted', () => {
  assert.deepEqual(validate(withKind({ select: { labels: ['type:change'] } })), []);
  assert.deepEqual(validate(withKind({ select: { labels: ['type:change', 'type:fix'] } })), []);
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

/** This repository's config with its `vhs` provisioning step declaring this instead. */
const withStep = (vhs) => ({ ...rigger, provisioning: { ...rigger.provisioning, vhs } });

// A step's selector has a kind's shape, so the engine will read its `select.labels` as a list
// too, and a value that is no list would reach it as a throw rather than a refusal at load.
test('a provisioning step whose select.labels is not a list is refused, and the refusal names that key', () => {
  for (const labels of ['area:demo', 3, { demo: 'area:demo' }, null]) {
    const step = { run: 'brew install vhs', select: { labels } };
    assert.match(refusal(withStep(step)), /`provisioning\.vhs\.select\.labels`/, JSON.stringify(labels));
  }
});

// A step that selects nothing is selected by the kinds that name it, so no `select` is a state
// the validator reads rather than a gap it refuses. The template is filled as `init` fills it and
// as its consumer answers `board.project`, so what is checked is the config a consumer runs.
test('a provisioning step with no select, or selecting one label or two, is accepted, and so are this config and its template', async () => {
  assert.deepEqual(validate(withStep({ run: 'brew install vhs' })), []);
  assert.deepEqual(validate(withStep({ run: 'brew install vhs', select: { labels: ['area:demo'] } })), []);
  assert.deepEqual(validate(withStep({ run: 'brew install vhs', select: { labels: ['area:demo', 'area:docs'] } })), []);
  assert.deepEqual(validate(rigger), []);
  const template = (await import('../templates/rigger.config.mjs')).default;
  assert.deepEqual(validate({ ...template, repo: 'acme/widgets', board: { ...template.board, project: 12 } }), []);
});

// A step selecting no label would provision no card, which its author did not write.
test('a provisioning step whose select.labels is empty is refused, and the refusal names that key', () => {
  const step = { run: 'brew install vhs', select: { labels: [] } };
  assert.match(refusal(withStep(step)), /`provisioning\.vhs\.select\.labels`/);
});

test('a provisioning step whose select.labels holds an entry that is no label name is refused, and the refusal names that key', () => {
  for (const labels of [[''], ['area:demo', 3], [null]]) {
    const step = { run: 'brew install vhs', select: { labels } };
    assert.match(refusal(withStep(step)), /`provisioning\.vhs\.select\.labels`/, JSON.stringify(labels));
  }
});

// A label holding only whitespace names no label a card could carry, so a kind declaring one
// would select no card while the config was accepted as though it selected some.
test('a select.labels entry holding only whitespace is refused for a kind and a provisioning step, naming the key', () => {
  for (const labels of [['  '], ['\t']]) {
    assert.match(refusal(withKind({ select: { labels } })), /`kinds\.change\.select\.labels`/, JSON.stringify(labels));
    const step = { run: 'brew install vhs', select: { labels } };
    assert.match(refusal(withStep(step)), /`provisioning\.vhs\.select\.labels`/, JSON.stringify(labels));
  }
});

// proves R-LOOP-11
test('a role called owner is refused, because the owner is the one judge that is not a role', () => {
  const declared = { ...rigger, roles: { ...rigger.roles, owner: { agent: 'a.md', provider: 'claude', tier: 'high' } } };
  assert.match(refusal(declared), /`roles\.owner`/);
});

test('a config declaring no priority is accepted, because a board need not rank its cards', () => {
  assert.ok(Object.hasOwn(rigger.board, 'priority'), 'this repository declares no priority, so its absence went untested');
  assert.deepEqual(validate(without(rigger, ['board', 'priority'])), []);
});

/** This repository's config with its priority declaration listing these options. */
const ranking = (options) => holding(rigger, ['board', 'priority', 'options'], options);

test('a priority declaration listing no options is refused, and the refusal names the key', () => {
  assert.match(refusal(ranking([])), /`board\.priority\.options`/);
});

test('a priority declaration naming one option twice is refused, and the refusal names the option', () => {
  // The repeated name is one the rest of the list does not hold, so a refusal naming whichever
  // option it met first, or the last, does not pass by accident.
  assert.match(refusal(ranking(['High', 'Urgent', 'Low', 'Urgent'])), /`Urgent`/);
});

test('a priority declaration listing anything but option names is refused, and the refusal names the key', () => {
  // An option is named by its display name on the board, which is a string with something in it.
  for (const unnamed of [1, null, true, '', ['High'], { name: 'High' }]) {
    assert.match(refusal(ranking(['High', unnamed])), /`board\.priority\.options`/, `${JSON.stringify(unnamed)} was read as a name`);
  }
  // An empty slot names no option either, and a list read by skipping holes never sees it.
  assert.match(refusal(ranking(['High', , 'Low'])), /`board\.priority\.options`/, 'an empty slot was read as a name');
});

// An option holding only whitespace names no board option a card could hold, so every card
// holding that value would rank as undeclared while the config was accepted.
test('a priority declaration listing an option holding only whitespace is refused, and the refusal names the key', () => {
  for (const blank of ['  ', '\t', ' ']) {
    assert.match(refusal(ranking(['High', blank])), /`board\.priority\.options`/, `${JSON.stringify(blank)} was read as a name`);
  }
});

test('a priority declaration listing only non-empty option names is accepted', () => {
  for (const options of [['High', 'Normal', 'Low'], ['P0'], ['Very high', ' Low ']]) {
    assert.deepEqual(validate(ranking(options)), [], JSON.stringify(options));
  }
});

/** This repository's config declaring `owner` as its board's owner. */
const ownedBy = (owner) => holding(rigger, ['board', 'owner'], owner);

test('a declared board owner that is one string holding something other than whitespace is accepted', () => {
  // A login other than the repository's owner, the repository's owner itself, and one padded.
  for (const owner of ['octo-org', 'williacj', ' someone ']) {
    assert.deepEqual(validate(ownedBy(owner)), [], JSON.stringify(owner));
  }
});

test('a declared board owner that is not a string is refused, and the refusal names the key', () => {
  for (const owner of [42, null, true, ['octo-org'], { login: 'octo-org' }]) {
    assert.match(refusal(ownedBy(owner)), /`board\.owner`/, JSON.stringify(owner));
  }
});

test('a declared board owner that is empty is refused, and the refusal names the key', () => {
  assert.match(refusal(ownedBy('')), /`board\.owner`/);
});

test('a declared board owner holding only whitespace is refused, and the refusal names the key', () => {
  for (const owner of [' ', '   ', '\t', '\n']) {
    assert.match(refusal(ownedBy(owner)), /`board\.owner`/, JSON.stringify(owner));
  }
});

// A board owner is optional (`R-OPTION-1`): its absence is the repository's owner's board, which
// the forge adapter reads, and not a fault the validator reports.
test('a config declaring no board owner is accepted, and no refusal names its absence', () => {
  assert.ok(!Object.hasOwn(rigger.board, 'owner'), 'this repository declares a board owner, so its absence went untested');
  const refusals = validate(rigger);
  assert.deepEqual(refusals, []);
  assert.ok(!refusals.some((refused) => refused.includes('board.owner')), refusals.join('; '));
});

test('a config declaring no board owner still carries none once Rigger has loaded and validated it', async () => {
  // Loaded as `doctor` loads a consumer's config, by importing the module, then validated. Only
  // the forge adapter supplies the repository's owner in the key's place, so nothing on the way
  // in may write one.
  const loaded = (await import('../rigger.config.mjs?board-owner')).default;
  const before = structuredClone(loaded);
  assert.deepEqual(validate(loaded), []);
  assert.ok(!Object.hasOwn(loaded.board, 'owner'), `the loaded config carries a board owner: ${loaded.board.owner}`);
  assert.deepEqual(loaded, before);
});

/** This repository's config with `concurrency` declared as `value`. */
const runningAtOnce = (value) => holding(rigger, ['concurrency'], value);

test('a concurrency that is not a positive whole number is refused, and the refusal names the key and the value', () => {
  for (const [value, spelled] of [[0, '0'], [-2, '-2'], [1.5, '1.5'], ['3', "'3'"]]) {
    const refused = refusal(runningAtOnce(value));
    assert.match(refused, /`concurrency`/, JSON.stringify(value));
    assert.ok(refused.includes(spelled), `the refusal does not name ${spelled}: ${refused}`);
  }
});

test('a concurrency no JSON can spell is refused without a throw, and the refusal names the value as written', () => {
  // A config is a module, so it can hold values JSON has no spelling for: `Infinity` is a natural
  // way to write "no cap", and a BigInt is a whole number of another type.
  for (const [value, spelled] of [[Number.NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'], [3n, '3n'], [{ per: 2n }, '{ per: 2n }']]) {
    const refused = refusal(runningAtOnce(value));
    assert.match(refused, /`concurrency`/, String(spelled));
    assert.ok(refused.endsWith(` ${spelled}`), `the refusal does not name ${spelled}: ${refused}`);
  }
});

test('a concurrency that is a positive whole number is accepted, and so is a config declaring none', () => {
  for (const value of [1, 3, 12]) assert.deepEqual(validate(runningAtOnce(value)), [], String(value));
  assert.deepEqual(validate(without(rigger, ['concurrency'])), []);
});

test('the labels a config selects are every label its kinds and provisioning steps select, each once, and nothing else', () => {
  // Written out by hand from the declarations below. A label two kinds share, and one a kind and a
  // step share, are each named once; the epic label, which no kind or step selects, and a step
  // that selects nothing name no label.
  const config = {
    ...rigger,
    kinds: {
      change: { ...rigger.kinds.change, select: { labels: ['type:change', 'area:cli'] } },
      spec: { ...rigger.kinds.spec, select: { labels: ['type:spec', 'area:cli'] } },
    },
    epicLabel: 'type:epic',
    provisioning: {
      'npm-ci': { run: 'npm ci', required: true },
      vhs: { run: 'brew install vhs', select: { labels: ['area:demo', 'type:spec'] } },
    },
  };
  assert.deepEqual(validate(config), []);

  assert.deepEqual(selectedLabels(config), ['type:change', 'area:cli', 'type:spec', 'area:demo']);
});

test('the labels a config declares are those its kinds and steps select, then its epic label, each once', () => {
  // Written out by hand from this repository's config, which declares `type:epic`.
  assert.deepEqual(declaredLabels(rigger), ['type:change', 'type:spec', 'type:structure', 'type:intake', 'type:spike', 'area:demo', 'type:epic']);
  const { epicLabel, ...unmarked } = rigger;
  assert.deepEqual(validate(unmarked), []);
  assert.deepEqual(declaredLabels(unmarked), ['type:change', 'type:spec', 'type:structure', 'type:intake', 'type:spike', 'area:demo']);
});

test('a config with no provisioning selects the labels its kinds select', () => {
  const { provisioning, ...config } = rigger;
  const kinds = Object.fromEntries(Object.entries(rigger.kinds).map(([name, { provisioning: steps, ...kind }]) => [name, kind]));
  assert.deepEqual(validate({ ...config, kinds }), []);

  assert.deepEqual(selectedLabels({ ...config, kinds }), ['type:change', 'type:spec', 'type:structure', 'type:intake', 'type:spike']);
});

/** This repository's config with its `worktrees` declaration holding this instead. */
const placedAt = (worktrees) => holding(rigger, ['worktrees'], worktrees);

test('a worktree root that is not a string holding something other than whitespace is refused, and the refusal names worktrees.root', () => {
  for (const root of ['', '  ', '\t', 3, null, true, ['../rigger-worktrees'], { path: '../rigger-worktrees' }]) {
    assert.match(refusal(placedAt({ root, topic: 'rigger-{number}' })), /`worktrees\.root`/, JSON.stringify(root));
  }
});

test('a worktree topic that is not a string is refused, and the refusal names worktrees.topic', () => {
  for (const topic of [42, null, true, ['rigger-{number}'], { rule: 'rigger-{number}' }]) {
    assert.match(refusal(placedAt({ topic })), /`worktrees\.topic`/, JSON.stringify(topic));
  }
});

// Every card's issue number is what tells its workspace and its branch from another's, so a topic
// that never places it derives one name for every card.
// proves R-WORK-9
test('a worktree topic holding no {number} is refused, and the refusal names the topic', () => {
  for (const topic of ['rigger', 'rigger-number', 'rigger-{Number}', 'rigger-{num}', 'rigger-{ number }']) {
    const refused = refusal(placedAt({ topic }));
    assert.match(refused, /`worktrees\.topic`/, topic);
    assert.ok(refused.includes(`\`${topic}\``), `the refusal does not name \`${topic}\`: ${refused}`);
  }
});

// An empty topic places no number either, so every card would share the root itself.
// proves R-WORK-9
test('a worktree topic that is empty is refused, and the refusal names the topic', () => {
  assert.match(refusal(placedAt({ topic: '' })), /`worktrees\.topic`/);
});

// A topic holding `/` makes directories under the root that Rigger never removes, and a branch
// that git refuses wherever a branch holds the part before the slash. An absolute topic and one
// holding a `..` segment are each such a topic, since each holds `{number}` too (ruling 3, P2).
// proves R-SCHED-10
test('a worktree topic holding a / is refused, and the refusal names the topic', () => {
  for (const topic of ['cards/{number}', 'rigger-{number}/', '/tmp/rigger-{number}', '../rigger-{number}', 'a/../rigger-{number}', '{number}/..']) {
    const refused = refusal(placedAt({ topic }));
    assert.match(refused, /`worktrees\.topic`/, topic);
    assert.ok(refused.includes(`\`${topic}\``), `the refusal does not name \`${topic}\`: ${refused}`);
  }
});

// L2 reads a kind's steps as a list of names, so a string would be read a character at a time,
// each character a step nobody declared (engineer 15).
test('a kind whose provisioning is not a list of step names is refused, and the refusal names the kind', () => {
  for (const provisioning of ['npm-ci', 3, null, { 'npm-ci': true }, ['npm-ci', 3], [''], ['  '], ['npm-ci', , 'vhs']]) {
    assert.match(refusal(withKind({ provisioning })), /`kinds\.change/, JSON.stringify(provisioning));
  }
});

// A step the config does not declare is one Rigger has no command for, so the kind names
// something Rigger does not offer. A name every object inherits is declared by nobody either.
// proves R-SCHED-10
test('a kind whose provisioning names a step provisioning does not declare is refused, and the refusal names the kind and the step', () => {
  for (const step of ['lint', 'toString', '__proto__']) {
    const refused = refusal(withKind({ provisioning: ['npm-ci', step] }));
    assert.match(refused, /`kinds\.change`/, step);
    assert.ok(refused.includes(`\`${step}\``), `the refusal does not name \`${step}\`: ${refused}`);
  }
  const { provisioning, ...undeclared } = withKind({ provisioning: ['npm-ci'] });
  const kinds = Object.fromEntries(Object.entries(undeclared.kinds).map(([name, kind]) => [name, name === 'change' ? kind : { ...kind, provisioning: [] }]));
  const refused = refusal({ ...undeclared, kinds });
  assert.match(refused, /`kinds\.change`/);
  assert.match(refused, /`npm-ci`/);
});

// L1 runs a step's command line under `/bin/sh`, so anything but a string holding a command is
// nothing it can run.
test('a provisioning step whose run is not a string holding something other than whitespace is refused, and the refusal names the step', () => {
  for (const run of ['', '  ', '\n', 3, null, true, ['brew', 'install', 'vhs'], { command: 'brew install vhs' }]) {
    assert.match(refusal(withStep({ run })), /`provisioning\.vhs/, JSON.stringify(run));
  }
});

test("a provisioning step's cwd that is not a string is refused, and the refusal names the step's cwd", () => {
  for (const cwd of [3, null, true, ['.'], { path: '.' }]) {
    assert.match(refusal(withStep({ run: 'brew install vhs', cwd })), /`provisioning\.vhs\.cwd`/, JSON.stringify(cwd));
  }
});

// A step's working directory is a directory under the card's workspace, and an absolute path
// names one wherever the workspace is.
test("a provisioning step's cwd that is absolute is refused, and the refusal names the step", () => {
  for (const cwd of ['/', '/tmp', '/Users/someone/work', '//server']) {
    assert.match(refusal(withStep({ run: 'brew install vhs', cwd })), /`provisioning\.vhs/, cwd);
  }
});

// Resolved against the workspace, each of these climbs out of it, however it gets there.
test("a provisioning step's cwd that would resolve outside the card's workspace is refused, and the refusal names the step", () => {
  for (const cwd of ['..', '../', '../sibling', './..', 'sub/../..', 'sub/../../other', 'a/b/../../../c']) {
    assert.match(refusal(withStep({ run: 'brew install vhs', cwd })), /`provisioning\.vhs/, cwd);
  }
});

// Each of these resolves to the workspace or a directory under it, `..foo` being a directory's
// name rather than a step up.
test("a provisioning step's cwd naming the workspace or a directory under it is accepted", () => {
  for (const cwd of ['.', './', 'packages/app', './packages/app', 'sub/..', 'a/b/../c', '..foo', 'sub/..foo']) {
    assert.deepEqual(validate(withStep({ run: 'brew install vhs', cwd })), [], cwd);
  }
});

test("a provisioning step's timeout that is not a positive whole number of milliseconds is refused, and the refusal names the step", () => {
  for (const timeout of [0, -1, 1.5, '1800000', Number.NaN, Infinity, 1800000n, null, true, [1800000], { ms: 1800000 }]) {
    assert.match(refusal(withStep({ run: 'brew install vhs', timeout })), /`provisioning\.vhs/, String(timeout));
  }
});

test("a provisioning step's timeout that is a positive whole number of milliseconds is accepted", () => {
  for (const timeout of [1, 60000, 1800000]) {
    assert.deepEqual(validate(withStep({ run: 'brew install vhs', timeout })), [], String(timeout));
  }
});

test("a worktree declaration spelled as ARCHITECTURE.md's published shape spells it is accepted, naming neither key", async () => {
  const { worktrees } = await publishedShape();
  assert.ok(Object.hasOwn(worktrees, 'root') && Object.hasOwn(worktrees, 'topic'), 'the published shape declares no root and topic, so nothing was checked');
  assert.deepEqual(validate(placedAt(worktrees)), []);
});

test("a step's cwd and timeout spelled as ARCHITECTURE.md's published shape spells them are accepted, naming neither key", async () => {
  const steps = Object.entries((await publishedShape()).provisioning).filter(([, step]) => Object.hasOwn(step, 'cwd') && Object.hasOwn(step, 'timeout'));
  assert.ok(steps.length > 0, 'the published shape declares no step with a cwd and a timeout, so nothing was checked');
  for (const [name, step] of steps) {
    assert.deepEqual(validate(holding(rigger, ['provisioning', name], step)), [], name);
  }
});

// Each key is optional, and so is the declaration: an absent one takes the Engine settings row's
// default rather than earning a refusal.
test('a config declaring no worktrees, or a worktrees declaring only a root or only a topic, is accepted', () => {
  assert.deepEqual(validate(without(rigger, ['worktrees'])), []);
  assert.deepEqual(validate(placedAt({ root: '../rigger-worktrees' })), []);
  assert.deepEqual(validate(placedAt({ topic: 'rigger-{number}' })), []);
  assert.deepEqual(validate(placedAt({ topic: 'card{number}-work' })), []);
});

/** This repository's config with its engineer role altered, which is what the role rules bind. */
const withRole = (change) => ({
  ...rigger,
  roles: { ...rigger.roles, engineer: { ...rigger.roles.engineer, ...change } },
});

// proves R-SCHED-10
test("a role's tier other than standard or high is refused, and the refusal names the role's tier and the value", () => {
  for (const tier of ['fast', 'Standard', 'HIGH', '', 1, null, ['high']]) {
    const earned = refusal(withRole({ tier }));
    assert.match(earned, /`roles\.engineer\.tier`/, String(tier));
    assert.ok(earned.includes(inspect(tier)), `${earned} does not name ${inspect(tier)}`);
  }
});

test("a role's tier of standard or high is accepted", () => {
  for (const tier of ['standard', 'high']) assert.deepEqual(validate(withRole({ tier })), [], tier);
});

// proves R-SCHED-10
test("a role's labels mapping a label to a tier other than standard or high is refused, naming the path and the value", () => {
  for (const tier of ['fast', 'High', '']) {
    const earned = refusal(withRole({ labels: { 'tier:high': 'high', 'tier:fast': tier } }));
    assert.match(earned, /`roles\.engineer\.labels`/, tier);
    assert.ok(earned.includes(inspect(tier)), `${earned} does not name ${inspect(tier)}`);
  }
});

// proves R-SCHED-10
test("a role's labels that is not an object of label names to strings is refused, naming the path", () => {
  for (const labels of ['tier:high', ['tier:high'], null, 7, { 'tier:high': 1 }, { 'tier:high': null }, { 'tier:high': ['high'] }, { '  ': 'high' }, { '': 'high' }]) {
    assert.match(refusal(withRole({ labels })), /`roles\.engineer\.labels`/, inspect(labels));
  }
});

// A config module can hand the validator any value, and only a plain object's own entries are the
// labels the consumer wrote: a Map holds its entries where `Object.entries` never looks, and an
// inherited entry was written by nobody.
// proves R-SCHED-10
test("a role's labels that is no plain object of label names to strings is refused, naming the path", () => {
  class Labels { constructor() { this['tier:high'] = 'high'; } }
  const bare = Object.create(null);
  bare['tier:high'] = 'high';
  const inherited = Object.create({ 'tier:high': 7 });
  const computed = Object.defineProperty({}, 'tier:high', { get: () => 'high', enumerable: true });
  const symbolic = { [Symbol('tier:high')]: 7 };
  const cases = [new Map([['tier:high', 7]]), new Map([['tier:high', 'high']]), new Set(['tier:high']), new Labels(), bare, inherited, computed, symbolic, new Date(0), /tier:high/];
  for (const labels of cases) {
    assert.match(refusal(withRole({ labels })), /`roles\.engineer\.labels`/, inspect(labels, { showHidden: true }));
  }
});

// A key the config defines as non-enumerable is no declaration, so the validator neither reads nor
// refuses it, whatever it holds (ruling 16 on #467). An enumerable one is a declaration, and a
// symbol is no label name.
// proves R-SCHED-10
test("a role's labels with a non-enumerable symbol key is accepted, and one with an enumerable symbol key is refused", () => {
  const hidden = Object.defineProperty({ 'tier:high': 'high' }, Symbol('tier:fast'), { value: 7, enumerable: false });
  assert.deepEqual(validate(withRole({ labels: hidden })), []);
  const shown = Object.defineProperty({ 'tier:high': 'high' }, Symbol('tier:fast'), { value: 'high', enumerable: true });
  assert.match(refusal(withRole({ labels: shown })), /`roles\.engineer\.labels`/);
});

// proves R-SCHED-10
test("a role's timeout that is not a positive whole number of milliseconds is refused, naming the path and the value", () => {
  for (const timeout of [0, -5, 1.5, '14400000', Number.NaN, Infinity, 14400000n, null, true, [14400000], { ms: 14400000 }]) {
    const earned = refusal(withRole({ timeout }));
    assert.match(earned, /`roles\.engineer\.timeout`/, inspect(timeout));
    assert.ok(earned.includes(inspect(timeout)), `${earned} does not name ${inspect(timeout)}`);
  }
});

test("a role's timeout that is a positive whole number of milliseconds is accepted", () => {
  for (const timeout of [1, 60000, 14400000]) assert.deepEqual(validate(withRole({ timeout })), [], String(timeout));
});

// proves R-SCHED-10
test('a kind naming one judge twice is refused, and the refusal names the kind and the judge', () => {
  for (const judges of [['reviewer', 'reviewer'], ['reviewer', 'pm', 'reviewer', 'owner']]) {
    const earned = refusal(withKind({ judges }));
    assert.match(earned, /`kinds\.change/, judges.join());
    assert.match(earned, /`reviewer`/, judges.join());
  }
});

test('a kind naming each judge once is accepted', () => {
  assert.deepEqual(validate(withKind({ judges: ['reviewer', 'pm', 'owner'] })), []);
});

// proves R-SCHED-10
test('a role whose name holds a / is refused, and the refusal names the role', () => {
  for (const name of ['team/engineer', '/engineer', 'engineer/', '../engineer']) {
    const declared = { ...rigger, roles: { ...rigger.roles, [name]: { agent: 'a.md', provider: 'claude', tier: 'high' } } };
    assert.ok(refusal(declared).includes(`\`roles.${name}\``), name);
  }
});

/** This repository's config with one more role, declared under `name`, as a consumer would. */
const withRoleNamed = (name) => ({ ...rigger, roles: { ...rigger.roles, [name]: { agent: 'a.md', provider: 'claude', tier: 'high' } } });

// A role's directory is `<base>/<role>`, so `..` resolves to the base's parent, and `.` and the
// empty string to the base itself. Making either fresh would remove what every other card holds
// there (#558; ruling 19 on #555).
// proves R-SCHED-10
test('a role named .., . or the empty string is refused, and the refusal names the role and says its name names a directory', () => {
  for (const name of ['..', '.', '']) {
    const refused = refusal(withRoleNamed(name));
    assert.ok(refused.includes(`\`roles.${name}\``), `the refusal does not name \`roles.${name}\`: ${refused}`);
    assert.ok(refused.includes("a role's name names a directory"), `the refusal does not say a role's name names a directory: ${refused}`);
    for (const other of Object.keys(rigger.roles)) {
      assert.ok(!refused.includes(other), `the refusal of ${inspect(name)} names the role \`${other}\`: ${refused}`);
    }
  }
});

// proves R-SCHED-10
test('a kind naming a role named .., . or the empty string as its maker or a judge has that role refused, whatever else it refuses', () => {
  for (const name of ['..', '.', '']) {
    const declared = withRoleNamed(name);
    const asMaker = { ...declared, kinds: { ...declared.kinds, change: { ...declared.kinds.change, maker: name } } };
    const asJudge = { ...declared, kinds: { ...declared.kinds, change: { ...declared.kinds.change, judges: [name, 'owner'] } } };
    for (const [where, config] of [['maker', asMaker], ['judge', asJudge]]) {
      const refusals = validate(config);
      assert.ok(
        refusals.some((refused) => refused.includes(`\`roles.${name}\``) && refused.includes("a role's name names a directory")),
        `a kind naming ${inspect(name)} as its ${where} earned no refusal of the role: ${refusals.join('; ') || 'none'}`,
      );
    }
  }
});

// The refusal is of the three names alone, not of every name beginning with a dot.
test('a role named ... or .reviewer is accepted', () => {
  for (const name of ['...', '.reviewer']) assert.deepEqual(validate(withRoleNamed(name)), [], name);
});

// proves R-SCHED-10
test('a role naming a provider the adapter map does not hold is refused, and the refusal names the role and the provider', () => {
  for (const provider of ['unheld', 'Claude', 'toString', '', 7, null, ['claude']]) {
    assert.ok(!Object.hasOwn(ADAPTERS, provider) || typeof provider !== 'string', `the adapter map holds ${inspect(provider)}`);
    const earned = refusal(withRole({ provider }));
    assert.match(earned, /`roles\.engineer/, inspect(provider));
    assert.ok(earned.includes(inspect(provider)), `${earned} does not name ${inspect(provider)}`);
  }
});

test('a role naming any provider the adapter map holds is accepted', () => {
  assert.ok(Object.keys(ADAPTERS).length > 0, 'the adapter map holds no provider, so nothing was checked');
  for (const provider of Object.keys(ADAPTERS)) assert.deepEqual(validate(withRole({ provider })), [], provider);
});

test('the validator types no provider name, reading every one from the adapter map', () => {
  const source = readFileSync(join(root, 'src', 'config', 'validate.mjs'), 'utf8');
  for (const provider of Object.keys(ADAPTERS)) {
    assert.ok(!new RegExp(`['"\`]${provider}['"\`]`).test(source), `src/config/validate.mjs types the provider name ${provider}`);
  }
});

test("a role's time is four hours where it declares no timeout, and its own timeout where it declares one", () => {
  // Four hours is 4 × 60 × 60 × 1000 milliseconds (`O7` on #467; ARCHITECTURE.md's role paragraph).
  assert.equal(roleTimeout(rigger.roles.engineer), 14400000);
  assert.equal(roleTimeout({ ...rigger.roles.engineer, timeout: 60000 }), 60000);
});

test("the labels a config declares include every label a role's labels names, each once, alongside those it declared before", () => {
  // Written out by hand from this repository's config and the two roles' labels below. `tier:high`
  // is named by two roles, and `Type:Change` is GitHub's one label with `type:change`, which a
  // kind selects, so each is declared once.
  const config = {
    ...rigger,
    roles: {
      ...rigger.roles,
      engineer: { ...rigger.roles.engineer, labels: { 'tier:high': 'high', 'Type:Change': 'high' } },
      reviewer: { ...rigger.roles.reviewer, labels: { 'tier:high': 'high', 'tier:standard': 'standard' } },
    },
  };
  assert.deepEqual(validate(config), []);
  assert.deepEqual(declaredLabels(config), [
    'type:change', 'type:spec', 'type:structure', 'type:intake', 'type:spike', 'area:demo', 'type:epic', 'tier:high', 'tier:standard',
  ]);
});

test("a role's labels mapping label names to standard or high is accepted, and so is one mapping none", () => {
  for (const labels of [{ 'tier:high': 'high' }, { 'tier:high': 'high', 'tier:standard': 'standard' }, {}]) {
    assert.deepEqual(validate(withRole({ labels })), [], inspect(labels));
  }
});

// proves R-VERDICT-1
test('given a config declaring a top-level verdicts key, the validator refuses it, naming the key', () => {
  const refusals = validate({ ...rigger, verdicts: ['sound', 'needs revision', 'critical', 'approved'] });

  assert.deepEqual(refusals, ['`verdicts` is not a declaration Rigger offers']);
});

// proves R-VERDICT-1
test('given a kind declaring verdicts, the validator refuses it, naming the key', () => {
  const [name, kind] = Object.entries(rigger.kinds)[0];
  const refusals = validate({ ...rigger, kinds: { ...rigger.kinds, [name]: { ...kind, verdicts: ['approved'] } } });

  assert.deepEqual(refusals, [`\`kinds.${name}.verdicts\` is not a declaration Rigger offers`]);
});
