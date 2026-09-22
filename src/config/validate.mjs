// ABOUTME: The config core: the declarations a consumer may make, which of them Rigger requires,
// ABOUTME: and the refusal of anything else, each refusal naming what it refused.

/**
 * Every declaration a consumer may make, by the shape it sits in.
 *
 * `ARCHITECTURE.md`'s extension points are the whole of what a consumer may name, and the config
 * shape published under that table is where each one is spelled. This table is that spelling and
 * nothing besides: `test/config.test.mjs` runs the published shape and holds the two to each
 * other, so a declaration the architecture does not spell is not offered here.
 *
 * A rule carries three things. `required` says Rigger can do nothing without the key and no
 * default is fixed anywhere in the corpus — which is why `repo` is required and `concurrency` is
 * not, the engine-settings row defaulting N to three. `keys` names the shape the value's own
 * keys are read against. `entries` names the shape each value under a consumer-named key is read
 * against, which is how `roles`, `kinds` and `provisioning` hold names Rigger never fixes.
 */
export const SHAPES = {
  config: {
    repo: { required: true },
    board: { required: true, keys: 'board' },
    concurrency: {},
    roles: { required: true, entries: 'role' },
    kinds: { required: true, entries: 'kind' },
    provisioning: { entries: 'step' },
    escalate: {},
    telemetry: { keys: 'telemetry' },
  },
  board: {
    project: { required: true },
    columns: { required: true, keys: 'columns' },
  },
  // Every column the config declares, which M1 reads off the board. A display name has no
  // default: a board whose columns are named differently drives the same loop only because the
  // consumer says what they are called.
  columns: {
    ready: { required: true },
    coding: { required: true },
    review: { required: true },
    owner: { required: true },
    done: { required: true },
  },
  role: {
    agent: { required: true },
    provider: { required: true },
    tier: { required: true },
  },
  kind: {
    select: { required: true, keys: 'select' },
    maker: { required: true },
    judges: { required: true },
    // `rounds` omitted is the default of three (`R-LOOP-9`), and a kind needing no provisioning
    // names none: an absent block is a tested state rather than a degraded one (`R-OPTION-1`).
    rounds: {},
    provisioning: {},
  },
  select: {
    labels: { required: true },
  },
  step: {
    run: { required: true },
    // A step that declares nothing is optional (`R-PROV-1`), so `required` is the declaration and
    // never the state, and a step that selects no labels is selected by the kinds that name it.
    required: {},
    select: { keys: 'select' },
  },
  telemetry: {
    push: {},
  },
};

/** Where a key sits, written as a reader of a refusal would look for it in the file. */
const at = (path, key) => (path ? `${path}.${key}` : key);

/** Reads one value's keys against its shape, and every shape nested under it. */
function readShape(value, shape, path, refusals) {
  const rules = SHAPES[shape];
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in value)) {
      if (rule.required) {
        refusals.push(`\`${at(path, key)}\` is required, and the config does not name it`);
      }
      continue;
    }
    if (rule.keys) readShape(value[key], rule.keys, at(path, key), refusals);
    if (rule.entries) {
      for (const [name, entry] of Object.entries(value[key])) {
        readShape(entry, rule.entries, at(at(path, key), name), refusals);
      }
    }
  }
  for (const key of Object.keys(value)) {
    if (!(key in rules)) refusals.push(`\`${at(path, key)}\` is not a declaration Rigger offers`);
  }
}

/** Every refusal this config earns. An accepted config earns none, so the list is empty. */
export function validate(config) {
  const refusals = [];
  readShape(config, 'config', '', refusals);
  return refusals;
}
