// ABOUTME: The config core: the declarations a consumer may make, which of them Rigger requires,
// the values only the consumer can answer, and the refusal of anything else, each
// refusal naming what it refused.

/**
 * The value the starter config carries where only the consumer can answer, by the key it sits
 * under. A placeholder is a name where a value belongs, so a config still holding one is refused.
 *
 * `repo` is here because a repository not yet pushed anywhere has no `origin` for `init` to read.
 * `project` is here for the stronger reason: a board number is GitHub's fact and nothing `init`
 * can read names it. Asking GitHub for the boards linked to the repository answers three for
 * `nodejs/node`, none for `cli/cli`, and a permission error for a repository behind an
 * organization's SAML enforcement, each measured with `gh api graphql` on 2026-09-23 — so which
 * board Rigger works is the consumer's to say, and a plausible number shipped as a default would
 * have Rigger work whatever board it happens to name.
 */
export const PLACEHOLDER = {
  repo: 'OWNER/REPOSITORY',
  project: 'PROJECT_NUMBER',
};

/**
 * Every declaration a consumer may make, by the shape it sits in.
 *
 * `ARCHITECTURE.md`'s extension points are the whole of what a consumer may name, and the config
 * shape published under that table is where each one is spelled. This table is that spelling and
 * nothing besides: `test/config.test.mjs` runs the published shape and holds the two to each
 * other, so a declaration the architecture does not spell is not offered here.
 *
 * A rule carries four things. `required` says Rigger can do nothing without the key and no
 * default is fixed anywhere in the binding documents — which is why `repo` is required and
 * `concurrency` is not, the engine-settings row defaulting N to three. `keys` names the shape the
 * value's own keys are read against. `entries` names the shape each value under a consumer-named
 * key is read against, which is how `roles`, `kinds` and `provisioning` hold names Rigger never
 * fixes. `placeholder` names the value the starter config arrives holding, which is a name rather
 * than an answer and is refused as one.
 */
export const SHAPES = {
  config: {
    repo: { required: true, placeholder: PLACEHOLDER.repo },
    board: { required: true, keys: 'board' },
    concurrency: {},
    roles: { required: true, entries: 'role' },
    kinds: { required: true, entries: 'kind' },
    provisioning: { entries: 'step' },
    escalate: { type: 'array' },
    telemetry: { keys: 'telemetry' },
  },
  board: {
    project: { required: true, placeholder: PLACEHOLDER.project },
    columns: { required: true, keys: 'columns' },
    // Optional: a board that declares no priority ranks every card alike, oldest first, which is
    // the Engine settings row's shared bottom rank with nothing above it.
    priority: { keys: 'priority' },
  },
  // The board field holding a card's priority, and that field's option display names, highest
  // rank first. The declared order ranks cards, whatever order the board's own field holds.
  priority: {
    field: { required: true },
    options: { required: true, type: 'array' },
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
    // The declaration is a boolean because it answers whether: anything else is read by `required
    // === true` as a step that declared nothing, which is not what its author wrote.
    required: { type: 'boolean' },
    select: { keys: 'select' },
  },
  telemetry: {
    push: {},
  },
};

/**
 * The owner, who judges a kind of work last if at all and is never dispatched (`R-LOOP-11`). It
 * is the one judge that is not a role, which is why a kind may name it and `roles` may not.
 */
const OWNER = 'owner';

/**
 * The escalation categories, which are Rigger's and not the consumer's (`R-ESCALATE-3`). A
 * consumer chooses which of them are the owner's to decide and adds none (`R-ESCALATE-2`), so a
 * config naming anything else names a route to the owner Rigger does not offer.
 */
export const CATEGORIES = ['recorded-decision', 'critical', 'ambiguous'];

/** Where a key sits, written as a reader of a refusal would look for it in the file. */
const at = (path, key) => (path ? `${path}.${key}` : key);

/** What a refusal calls each type a rule can ask for, and whether a value is one. */
const SAYS = { boolean: 'true or false', array: 'a list' };
const holds = (value, type) => (type === 'array' ? Array.isArray(value) : typeof value === type);

/** Whether a value is a set of declarations, which is what a shape and a container both hold. */
const declares = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The refusal a value earns where Rigger reads declarations and finds something else.
 *
 * Refused where it sits rather than read as an empty set, which would report every key under it
 * as missing and bury the one fault that caused them. A container earns this as a shape does: a
 * string read as a set of names yields one refusal per character, each naming an index the
 * author never wrote.
 */
const holdsNothing = (path, value) =>
  `\`${path || 'the config'}\` holds no declarations, and Rigger reads ${JSON.stringify(value) ?? String(value)} as none`;

/** Reads one value's keys against its shape, and every shape nested under it. */
function readShape(value, shape, path, refusals) {
  const rules = SHAPES[shape];
  if (!declares(value)) {
    refusals.push(holdsNothing(path, value));
    return;
  }
  // Both questions below ask about an object's own keys, as `readKinds` does. A key an object
  // inherits was written by nobody: read through the prototype chain, a required key is answered
  // by `Object.prototype` rather than by the consumer, and every name that object carries —
  // `toString`, `constructor`, `valueOf`, and a `__proto__` a JSON parse made own — reads as a
  // declaration Rigger offers.
  for (const [key, rule] of Object.entries(rules)) {
    if (!Object.hasOwn(value, key)) {
      if (rule.required) {
        refusals.push(`\`${at(path, key)}\` is required, and the config does not name it`);
      }
      continue;
    }
    if (rule.type && !holds(value[key], rule.type)) {
      refusals.push(`\`${at(path, key)}\` must be ${SAYS[rule.type]}`);
    }
    // `undefined` on both sides is a rule that names no placeholder against a key declared with
    // no value, which is a refusal the shape earns elsewhere and not this one.
    if (rule.placeholder !== undefined && value[key] === rule.placeholder) {
      refusals.push(
        `\`${at(path, key)}\` still holds \`${rule.placeholder}\`, which is the name the starter `
        + 'config carries where only you can answer it',
      );
    }
    if (rule.keys) readShape(value[key], rule.keys, at(path, key), refusals);
    if (rule.entries) {
      if (!declares(value[key])) refusals.push(holdsNothing(at(path, key), value[key]));
      else {
        for (const [name, entry] of Object.entries(value[key])) {
          readShape(entry, rule.entries, at(at(path, key), name), refusals);
        }
      }
    }
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(rules, key)) refusals.push(`\`${at(path, key)}\` is not a declaration Rigger offers`);
  }
}

/**
 * What each kind of work may name: one maker role, and the judges that review it.
 *
 * The names a kind uses are the ones the config declares under `roles`, so a kind naming anything
 * else names something Rigger cannot dispatch (`R-SCHED-10`).
 */
function readKinds(config, refusals) {
  // Neither rule below can be read where the declarations they read are missing: a maker cannot
  // be held to the roles when there are none, and every kind would be refused for a fault that
  // is one refusal already, naming the container that holds nothing.
  if (!declares(config.roles) || !declares(config.kinds)) return;
  const roles = config.roles;
  if (Object.hasOwn(roles, OWNER)) {
    refusals.push(`\`roles.${OWNER}\` is reserved: \`${OWNER}\` names the owner, who is never dispatched`);
  }
  for (const [name, kind] of Object.entries(config.kinds)) {
    const where = `kinds.${name}`;
    if (kind?.maker !== undefined && !Object.hasOwn(roles, kind.maker)) {
      refusals.push(`\`${where}.maker\` names \`${kind.maker}\`, which is no role the config declares`);
    }
    if (kind?.judges === undefined) continue;
    if (!Array.isArray(kind.judges) || kind.judges.length === 0) {
      // One maker and at least one judge, in the order they judge in (`README.md`, "The
      // guarantee"). A kind naming none would deliver work no judge ruled on.
      refusals.push(`\`${where}.judges\` must be an ordered list naming at least one judge`);
      continue;
    }
    // No judge is the maker, and no configuration removes that separation (`R-LOOP-3`). An engine
    // that could approve its own work would be a faster way to merge mistakes.
    if (kind.judges.includes(kind.maker)) {
      refusals.push(`\`${where}\` names \`${kind.maker}\` as both its maker and one of its judges, and no judge is the maker`);
    }
    kind.judges.forEach((judge, position) => {
      if (judge !== OWNER && !Object.hasOwn(roles, judge)) {
        refusals.push(`\`${where}.judges\` names \`${judge}\`, which is no role the config declares`);
      }
      // The owner judges last if at all (`R-LOOP-11`), so the owner is asked once every agent
      // judge is satisfied rather than before one of them.
      if (judge === OWNER && position !== kind.judges.length - 1) {
        refusals.push(`\`${where}.judges\` names \`${OWNER}\` at position ${position + 1} of ${kind.judges.length}, and the owner judges last`);
      }
    });
  }
}

/**
 * What a priority declaration's options may be: the ranking itself, highest first, so it names at
 * least one option.
 */
function readPriority(priority, refusals) {
  const options = priority?.options;
  // A declaration that is no set of declarations, or options that are no list, earned their
  // refusal where the shape was read.
  if (!Array.isArray(options)) return;
  const where = 'board.priority.options';
  if (options.length === 0) refusals.push(`\`${where}\` must list at least one option, highest rank first`);
  // An option is named by its display name on the board, so anything else names no option.
  if (options.some((option) => typeof option !== 'string' || option === '')) {
    refusals.push(`\`${where}\` must list option display names, and holds something else`);
  }
  // An option listed twice holds two ranks, and a card holding it has no one rank to take.
  const seen = new Set();
  const repeated = new Set();
  for (const option of options) (seen.has(option) ? repeated : seen).add(option);
  for (const option of repeated) {
    refusals.push(`\`${where}\` names \`${option}\` more than once, so it holds no one rank`);
  }
}

/** Every refusal this config earns. An accepted config earns none, so the list is empty. */
export function validate(config) {
  const refusals = [];
  readShape(config, 'config', '', refusals);
  // A config file with no `export default` hands this `undefined`, and the rules below read
  // declarations there are none of. The refusal for that is already the one above.
  if (!declares(config)) return refusals;
  readKinds(config, refusals);
  readPriority(config.board?.priority, refusals);
  for (const category of Array.isArray(config.escalate) ? config.escalate : []) {
    if (!CATEGORIES.includes(category)) {
      refusals.push(`\`escalate\` names \`${category}\`, which is no escalation category Rigger offers`);
    }
  }
  return refusals;
}

/**
 * Whether the work requires this provisioning step.
 *
 * `R-PROV-1`: a step declares whether the work requires it, and a step that does not declare it
 * is optional. D12 gives the reason the silence falls that way — the commoner step is a warmup
 * that can fail and cost nothing, where a setup that fails dispatches a maker into a worktree
 * that cannot run the work.
 */
export const workRequires = (step) => step?.required === true;
