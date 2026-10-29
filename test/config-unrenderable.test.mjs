// ABOUTME: Proves a kind's maker or a judge's role that cannot be made a string earns a refusal
// naming it, never a throw, and that every site around them answers as it did before (#1082).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { validate } from '../src/config/validate.mjs';
import rigger from '../rigger.config.mjs';

/**
 * The three values #1082's probe found throwing, each made fresh: a value whose conversion to a
 * string throws. A Symbol throws in a template, and the other two throw wherever they are made a
 * primitive, a property key included.
 */
const UNRENDERABLE = {
  'a Symbol': () => Symbol('s'),
  'a null-prototype object': () => Object.create(null),
  'an object whose toString throws': () => ({ toString() { throw new Error('boom'); } }),
};

/** This repository's own config, copied so a test can change one path of it. */
const live = () => structuredClone(rigger);

/**
 * A config as `inspect` shows every own key, hidden ones and prototypes included, without calling
 * any value's `toString`: what a test compares to see that `validate` left a config unchanged.
 */
const snapshot = (config) => inspect(config, { depth: Infinity, showHidden: true, sorted: false });

/**
 * What `validate` answers, where a throw fails the test naming the config that earned it, and so
 * does a config `validate` changed while refusing it.
 */
function answer(config, what) {
  const before = snapshot(config);
  let refusals;
  try {
    refusals = validate(config);
  } catch (error) {
    return assert.fail(`validate threw for ${what}: ${error.message}`);
  }
  assert.equal(snapshot(config), before, `validate changed the config it read for ${what}`);
  return refusals;
}

/**
 * The refusals a config holding unrenderable values should earn, derived from its string twin: the
 * same config with each value replaced by a string naming no declared role, distinct for distinct
 * values. The twin's refusals are what `validate` gives for it, with each string's rendering
 * replaced by `inspect`'s rendering of the value it stands for. `build` places `values[i]` where
 * the config holds its i-th value.
 */
function fromTwin(build, values) {
  const strings = values.map((_, index) => `unrendered-twin-${String.fromCharCode(97 + index)}`);
  return answer(build(strings), 'the string twin').map((refusal) => strings.reduce(
    (text, string, index) => text.replaceAll(`\`${string}\``, `\`${inspect(values[index])}\``),
    refusal,
  ));
}

// proves R-SCHED-10
test('unrenderable values at one kind\'s maker and at another kind\'s judge earn the refusals their string twin earns, never a throw', () => {
  for (const [what, make] of Object.entries(UNRENDERABLE)) {
    const values = [make(), make()];
    const build = ([maker, role]) => {
      const config = live();
      config.kinds.change.maker = maker;
      config.kinds.spec.judges[0].role = role;
      return config;
    };
    assert.deepEqual(answer(build(values), what), fromTwin(build, values), what);
  }
});

// proves R-SCHED-10
test('a kind\'s maker that cannot be made a string earns one refusal naming the maker and the value as inspect renders it', () => {
  for (const [what, make] of Object.entries(UNRENDERABLE)) {
    for (const kind of Object.keys(rigger.kinds)) {
      const value = make();
      const config = live();
      config.kinds[kind].maker = value;
      const refusals = answer(config, `${what} at kinds.${kind}.maker`);
      assert.equal(refusals.length, 1, `${what} at kinds.${kind}.maker earned: ${refusals.join('; ') || 'none'}`);
      assert.ok(refusals[0].includes(`\`kinds.${kind}.maker\``), refusals[0]);
      assert.ok(refusals[0].includes(inspect(value)), refusals[0]);
    }
  }
});

// proves R-SCHED-10
test('a judge\'s role that cannot be made a string earns one refusal naming the judges and the value as inspect renders it', () => {
  for (const [what, make] of Object.entries(UNRENDERABLE)) {
    for (const [kind, { judges }] of Object.entries(rigger.kinds)) {
      judges.forEach((entry, position) => {
        if (typeof entry === 'string') return;
        const value = make();
        const config = live();
        config.kinds[kind].judges[position].role = value;
        const at = `kinds.${kind}.judges.${position}.role`;
        const refusals = answer(config, `${what} at ${at}`);
        assert.equal(refusals.length, 1, `${what} at ${at} earned: ${refusals.join('; ') || 'none'}`);
        assert.ok(refusals[0].includes(`\`kinds.${kind}.judges\``), refusals[0]);
        assert.ok(refusals[0].includes(inspect(value)), refusals[0]);
      });
    }
  }
});

// proves R-SCHED-10
test('one unrenderable value as both a kind\'s maker and one of its judges earns the refusals its string twin earns, never a throw', () => {
  for (const [what, make] of Object.entries(UNRENDERABLE)) {
    const values = [make()];
    const build = ([value]) => {
      const config = live();
      config.kinds.change.maker = value;
      config.kinds.change.judges[0].role = value;
      return config;
    };
    assert.deepEqual(answer(build(values), what), fromTwin(build, values), what);
  }
});

// proves R-SCHED-10
test('one unrenderable value as the role of two judges of a kind earns the refusals its string twin earns, never a throw', () => {
  for (const [what, make] of Object.entries(UNRENDERABLE)) {
    const values = [make()];
    const build = ([value]) => {
      const config = live();
      config.kinds.change.judges[0].role = value;
      config.kinds.change.judges[1].role = value;
      return config;
    };
    assert.deepEqual(answer(build(values), what), fromTwin(build, values), what);
  }
});

/** Row K6: the sites that already render with `inspect`. Each text is the merge base answer (journal). */
const RENDERED_SITES = [
  {
    // L413: the entry is no role name and no { role, provider }
    site: 'a plain judge entry',
    build: (config, value) => { config.kinds.change.judges[0] = value; },
    expected: {
      'a Symbol': [
        "`kinds.change.judges[0]` is neither a role name nor `{ role, provider }`, and the config gives Symbol(s)",
      ],
      'a null-prototype object': [
        "`kinds.change.judges[0].role` is required, and the config does not name it",
        "`kinds.change.judges[0].provider` is required, and the config does not name it",
        "`kinds.change.judges` names `undefined`, which is no role the config declares",
      ],
      'an object whose toString throws': [
        "`kinds.change.judges[0].role` is required, and the config does not name it",
        "`kinds.change.judges[0].provider` is required, and the config does not name it",
        "`kinds.change.judges[0].toString` is not a declaration Rigger offers",
        "`kinds.change.judges` names `undefined`, which is no role the config declares",
      ],
    },
  },
  {
    // L427: the provider is neither a name nor a map
    site: "a judge entry's provider",
    build: (config, value) => { config.kinds.change.judges[0].provider = value; },
    expected: {
      'a Symbol': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives Symbol(s)",
      ],
      'a null-prototype object': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives [Object: null prototype] {}",
      ],
      'an object whose toString throws': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives { toString: [Function: toString] }",
      ],
    },
  },
  {
    // L427, which renders the map holding it
    site: "a value in a judge entry's provider map",
    build: (config, value) => { config.kinds.change.judges[0].provider.claude = value; },
    expected: {
      'a Symbol': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives { claude: Symbol(s), codex: 'codex' }",
      ],
      'a null-prototype object': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives { claude: [Object: null prototype] {}, codex: 'codex' }",
      ],
      'an object whose toString throws': [
        "`kinds.change.judges[0].provider` must be a provider name or map provider names to provider names, and the config gives { claude: { toString: [Function: toString] }, codex: 'codex' }",
      ],
    },
  },
];

/** Row K7: the sites that interpolate a constant, a count, or a value already found to be a string. Each text is the merge base answer (journal). */
const UNREAD_SITES = [
  {
    // L329: the reserved role, whatever it holds
    site: 'roles.owner',
    build: (config, value) => { config.roles.owner = value; },
    expected: {
      'a Symbol': [
        "`roles.owner` holds no declarations, and Rigger reads Symbol(s) as none",
        "`roles.owner` is reserved: `owner` names the owner, who is never dispatched",
      ],
      'a null-prototype object': [
        "`roles.owner.agent` is required, and the config does not name it",
        "`roles.owner.provider` is required, and the config does not name it",
        "`roles.owner.tier` is required, and the config does not name it",
        "`roles.owner` is reserved: `owner` names the owner, who is never dispatched",
      ],
      'an object whose toString throws': [
        "`roles.owner.agent` is required, and the config does not name it",
        "`roles.owner.provider` is required, and the config does not name it",
        "`roles.owner.tier` is required, and the config does not name it",
        "`roles.owner.toString` is not a declaration Rigger offers",
        "`roles.owner` is reserved: `owner` names the owner, who is never dispatched",
      ],
    },
  },
  {
    // L372: the owner judges last
    site: 'a plain judge entry after the owner',
    build: (config, value) => { config.kinds.structure.judges = ['owner', value]; },
    expected: {
      'a Symbol': [
        "`kinds.structure.judges[1]` is neither a role name nor `{ role, provider }`, and the config gives Symbol(s)",
        "`kinds.structure.judges` names `owner` at position 1 of 2, and the owner judges last",
      ],
      'a null-prototype object': [
        "`kinds.structure.judges[1].role` is required, and the config does not name it",
        "`kinds.structure.judges[1].provider` is required, and the config does not name it",
        "`kinds.structure.judges` names `owner` at position 1 of 2, and the owner judges last",
        "`kinds.structure.judges` names `undefined`, which is no role the config declares",
      ],
      'an object whose toString throws': [
        "`kinds.structure.judges[1].role` is required, and the config does not name it",
        "`kinds.structure.judges[1].provider` is required, and the config does not name it",
        "`kinds.structure.judges[1].toString` is not a declaration Rigger offers",
        "`kinds.structure.judges` names `owner` at position 1 of 2, and the owner judges last",
        "`kinds.structure.judges` names `undefined`, which is no role the config declares",
      ],
    },
  },
  {
    // L435: the maker's providers are read through `names`, so the value never reaches the text
    site: "a maker role's providerLabels value",
    build: (config, value) => { config.roles.engineer.providerLabels['maker:codex'] = value; config.kinds.change.judges[0].provider = { codex: 'codex' }; },
    expected: {
      'a Symbol': [
        "`roles.engineer.providerLabels` must map label names to providers, and the config gives { 'maker:codex': Symbol(s) }",
        "`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind's maker can run on",
      ],
      'a null-prototype object': [
        "`roles.engineer.providerLabels` must map label names to providers, and the config gives { 'maker:codex': [Object: null prototype] {} }",
        "`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind's maker can run on",
      ],
      'an object whose toString throws': [
        "`roles.engineer.providerLabels` must map label names to providers, and the config gives { 'maker:codex': { toString: [Function: toString] } }",
        "`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind's maker can run on",
      ],
    },
  },
  {
    // L643: the steps are no list
    site: 'kinds.change.provisioning',
    build: (config, value) => { config.kinds.change.provisioning = value; },
    expected: {
      'a Symbol': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
      'a null-prototype object': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
      'an object whose toString throws': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
    },
  },
  {
    // L649 reads each step, but `holdsUnnamed` refuses the list at L643 first
    site: 'a step in kinds.change.provisioning',
    build: (config, value) => { config.kinds.change.provisioning = ['npm-ci', value]; },
    expected: {
      'a Symbol': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
      'a null-prototype object': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
      'an object whose toString throws': [
        "`kinds.change.provisioning` must be a list of step names",
      ],
    },
  },
  {
    // readSelectorLabel, behind readLabels and sameLabel's type check
    site: 'a label in kinds.change.select.labels',
    build: (config, value) => { config.kinds.change.select.labels = [value]; },
    expected: {
      'a Symbol': [
        "`kinds.change.select.labels` must list label names, and holds something else",
      ],
      'a null-prototype object': [
        "`kinds.change.select.labels` must list label names, and holds something else",
      ],
      'an object whose toString throws': [
        "`kinds.change.select.labels` must list label names, and holds something else",
      ],
    },
  },
];

/** Runs every site of a row for each unrenderable value, asserting the merge base's answer. */
function holdsBaseAnswers(sites) {
  for (const { site, build, expected } of sites) {
    for (const [what, make] of Object.entries(UNRENDERABLE)) {
      const config = live();
      build(config, make());
      assert.deepEqual(answer(config, `${what} at ${site}`), expected[what], `${what} at ${site}`);
    }
  }
}

// proves R-SCHED-10
test('an unrenderable value where a judge entry is read with inspect earns the refusals it earned before, never a throw', () => {
  holdsBaseAnswers(RENDERED_SITES);
});

// proves R-SCHED-10
test('an unrenderable value where a kind refusal writes a constant, a count or a checked name earns the refusals it earned before, never a throw', () => {
  holdsBaseAnswers(UNREAD_SITES);
});

/**
 * Row K8: values that convert to a string naming no declared role, and how the merge base writes
 * each one in a refusal (journal). A BigInt loses its suffix and a plain object reads as its tag,
 * as a template writes them.
 */
const RENDERABLE = [
  { what: 'a string', make: () => 'nobody', shown: 'nobody' },
  { what: 'a number', make: () => 3, shown: '3' },
  { what: 'a BigInt', make: () => 1n, shown: '1' },
  { what: 'a plain object', make: () => ({}), shown: '[object Object]' },
  { what: 'an array', make: () => ['nobody'], shown: 'nobody' },
  { what: 'a function', make: () => function nobody() {}, shown: 'function nobody() {}' },
];

test('a maker or a judge\'s role that renders as a string naming no role earns the refusals it earned before', () => {
  for (const { what, make, shown } of RENDERABLE) {
    const cases = {
      'the maker': {
        build: (config) => { config.kinds.change.maker = make(); },
        expected: [`\`kinds.change.maker\` names \`${shown}\`, which is no role the config declares`],
      },
      'a judge\'s role': {
        build: (config) => { config.kinds.change.judges[0].role = make(); },
        expected: [`\`kinds.change.judges\` names \`${shown}\`, which is no role the config declares`],
      },
      'the maker and a judge\'s role': {
        build: (config) => { const value = make(); config.kinds.change.maker = value; config.kinds.change.judges[0].role = value; },
        expected: [
          `\`kinds.change.maker\` names \`${shown}\`, which is no role the config declares`,
          `\`kinds.change\` names \`${shown}\` as both its maker and one of its judges, and no judge is the maker`,
          `\`kinds.change.judges\` names \`${shown}\`, which is no role the config declares`,
        ],
      },
      'two judges\' roles': {
        build: (config) => { const value = make(); config.kinds.change.judges[0].role = value; config.kinds.change.judges[1].role = value; },
        expected: [
          `\`kinds.change.judges\` names \`${shown}\` more than once, and each judge of a card has a directory of its own`,
          `\`kinds.change.judges\` names \`${shown}\`, which is no role the config declares`,
          `\`kinds.change.judges\` names \`${shown}\`, which is no role the config declares`,
        ],
      },
    };
    for (const [where, { build, expected }] of Object.entries(cases)) {
      const config = live();
      build(config);
      assert.deepEqual(answer(config, `${what} at ${where}`), expected, `${what} at ${where}`);
    }
  }
});

test('a maker naming a role that roles inherits rather than declares earns the refusals it earned before, its inherited providers read', () => {
  // Row K12: a config on which the merge base returns keeps that answer, text included. The maker
  // is no own role, so it is refused, and the merge base still read the inherited role's providers
  // and refused a judge map with no key for one of them. The texts are the merge base's (journal).
  const config = live();
  Object.setPrototypeOf(config.roles, { ghost: { provider: 'claude' } });
  config.kinds.change.maker = 'ghost';
  config.kinds.change.judges[0].provider = { codex: 'codex' };
  assert.deepEqual(answer(config, 'an inherited maker'), [
    '`kinds.change.maker` names `ghost`, which is no role the config declares',
    '`kinds.change.judges[0].provider` holds no key for `claude`, a provider the kind\'s maker can run on',
  ]);
});
