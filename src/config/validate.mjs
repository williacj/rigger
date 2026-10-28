// ABOUTME: The config core: the declarations a consumer may make, which of them Rigger requires,
// the values only the consumer can answer, and the refusal of anything else, each
// refusal naming what it refused.

import { posix } from 'node:path';
import { inspect } from 'node:util';

import { ADAPTERS } from '../substrate/providers/adapters.mjs';
import { KILL_BOUND, READ_TIMEOUT } from '../substrate/process.mjs';
import { kindOf } from '../workflow/next-action.mjs';
import { checkAcceptanceForm } from '../workflow/form-check.mjs';

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
    worktrees: { keys: 'worktrees' },
    roles: { required: true, entries: 'role' },
    kinds: { required: true, entries: 'kind' },
    // Optional: where it is absent no label marks an epic, and every card is selected by the
    // kinds' own labels alone (`ARCHITECTURE.md`, below the extension-point table).
    epicLabel: {},
    provisioning: { entries: 'step' },
    // Optional: a destination per escalation category, and a category given none goes to the
    // owner (`ARCHITECTURE.md`, the Escalation destinations row).
    escalate: { type: 'object' },
    telemetry: { keys: 'telemetry' },
    clock: { keys: 'clock' },
  },
  clock: {
    poll: { required: true },
    triggers: { entries: 'trigger' },
  },
  trigger: {
    interval: { required: true },
    anchor: { required: true },
    catchUp: { required: true },
    card: { keys: 'card' },
    job: {},
  },
  card: {
    title: { required: true },
    labels: { required: true },
    acceptance: { required: true },
    author: {},
  },
  board: {
    // Optional: where it is absent the board's owner is the repository's owner, which only the
    // forge adapter supplies (`ARCHITECTURE.md`, below the extension-point table).
    owner: {},
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
    // Optional: a card label mapped to the tier it selects for this role, and the milliseconds the
    // role's dispatch may run. A role declaring neither runs at its `tier` for the default time
    // (`ARCHITECTURE.md`, below the extension-point table).
    labels: {},
    timeout: {},
    // Optional: a card label mapped to the provider it selects for this role. A role declaring
    // none runs on its `provider` (`ARCHITECTURE.md`, below the extension-point table).
    providerLabels: {},
  },
  // A judge entry that is not a plain role name: the role, and its provider rule, a provider name
  // or a map from the maker's provider to the judge's (`D24` rule 1). The owner is never one.
  judge: {
    role: { required: true },
    provider: { required: true },
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
    cwd: {},
    timeout: {},
  },
  worktrees: {
    root: {},
    topic: {},
  },
  telemetry: {
    push: {},
  },
};

/**
 * The owner, who judges a kind of work last if at all and is never dispatched (`R-LOOP-11`). It
 * is the one judge that is not a role, which is why a kind may name it and `roles` may not.
 */
export const OWNER = 'owner';

/** The role a kind's judge entry names: the entry itself where it is a role name, or its `role`. */
export const judgeRole = (entry) => (typeof entry === 'string' ? entry : entry?.role);

/**
 * The escalation categories, which are Rigger's and not the consumer's (`R-ESCALATE-19`). A
 * consumer names where each of them goes and adds none (`R-ESCALATE-13`), so a config naming
 * anything else names a category Rigger does not offer.
 */
export const CATEGORIES = ['recorded-decision', 'critical', 'ambiguous'];

/** Labels Rigger fixes, shared by provisioning, selector validation and L2 (`D27`). */
export const FIXED_LABELS = { escalated: 'rigger:escalated', status: 'rigger:status' };

/**
 * The tiers a role may run at, which are Rigger's and not the consumer's (`O4` on #467): each
 * provider adapter maps every one of them to a model of its own, so a config naming another names
 * a tier no adapter can run (`ARCHITECTURE.md`, below the extension-point table).
 */
export const TIERS = ['standard', 'high'];

/** The tiers as a refusal names them. */
const TIER_NAMES = TIERS.map((tier) => `\`${tier}\``).join(' or ');

/** Where a key sits, written as a reader of a refusal would look for it in the file. */
const at = (path, key) => (path ? `${path}.${key}` : key);

/** What a refusal calls each type a rule can ask for, and whether a value is one. */
const SAYS = { boolean: 'true or false', array: 'a list', object: 'an object' };
const holds = (value, type) => {
  if (type === 'array') return Array.isArray(value);
  return type === 'object' ? declares(value) : typeof value === type;
};

/** Whether a value is a set of declarations, which is what a shape and a container both hold. */
const declares = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Whether a value is a name: a string holding something other than whitespace. A label and a
 * priority option are each read by name, and a string of only whitespace names nothing either
 * could match.
 */
const names = (value) => typeof value === 'string' && value.trim() !== '';

/** A label name with every ASCII letter given one case: the spelling two names share when GitHub holds them as one label. */
const folded = (name) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * Whether two label names are one label, as GitHub holds them: equal once every ASCII letter in
 * both is given one case (#301's measurement, which covers ASCII letters only). Anything that is
 * no string is one label with nothing.
 */
export const sameLabel = (one, other) => typeof one === 'string' && typeof other === 'string' && folded(one) === folded(other);

/** A fixed label cannot select a kind of work or mark a card as an epic (`R-SCHED-19`). */
function readSelectorLabel(label, where, refusals) {
  if (Object.values(FIXED_LABELS).some((fixed) => sameLabel(label, fixed))) {
    refusals.push(`\`${where}\` names \`${label}\`, a label Rigger fixes and reserves from kind and epic selectors`);
  }
}

/**
 * Whether a list holds anything that is no name. Read through `Array.from`, which visits every
 * index, because `some` skips an empty slot.
 */
const holdsUnnamed = (list) => Array.from(list).some((entry) => !names(entry));

/**
 * The refusal a value earns where Rigger reads declarations and finds something else.
 *
 * Refused where it sits rather than read as an empty set, which would report every key under it
 * as missing and bury the one fault that caused them. A container earns this as a shape does: a
 * string read as a set of names yields one refusal per character, each naming an index the
 * author never wrote.
 */
function holdsNothing(path, value) {
  let shown;
  try { shown = JSON.stringify(value) ?? String(value); }
  catch { shown = inspect(value); }
  return `\`${path || 'the config'}\` holds no declarations, and Rigger reads ${shown} as none`;
}

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
 * What a `select.labels` may be, for a kind or a provisioning step alike: the labels a card
 * carries to be selected by it, as a list the engine reads when it selects cards.
 *
 * A select that is no set of declarations, or that does not name `labels`, earned its refusal
 * where the shape was read.
 */
function readLabels(select, where, refusals) {
  if (!declares(select) || !Object.hasOwn(select, 'labels')) return;
  const { labels } = select;
  // The engine reads the value as a list, so anything else reaches it as a throw.
  if (!Array.isArray(labels)) {
    refusals.push(`\`${where}\` must be a list of label names`);
    return;
  }
  // A selector takes a card carrying any one of its labels, so one naming none selects nothing:
  // a kind's work would never run, and a step would never provision a card.
  if (labels.length === 0) {
    refusals.push(`\`${where}\` names no label, so it selects no card`);
  }
  // A card carries labels by name, so an entry that is no name selects nothing.
  if (holdsUnnamed(labels)) {
    refusals.push(`\`${where}\` must list label names, and holds something else`);
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
    readLabels(kind?.select, `${where}.select.labels`, refusals);
    if (Array.isArray(kind?.select?.labels)) {
      for (const label of kind.select.labels) readSelectorLabel(label, `${where}.select.labels`, refusals);
    }
    if (kind?.judges === undefined) continue;
    if (!Array.isArray(kind.judges) || kind.judges.length === 0) {
      // One maker and at least one judge, in the order they judge in (`README.md`, "The
      // guarantee"). A kind naming none would deliver work no judge ruled on.
      refusals.push(`\`${where}.judges\` must be an ordered list naming at least one judge`);
      continue;
    }
    // Every check below reads an entry's role through `judgeRole`, whichever form names it (`D24`
    // rule 1). An entry that is neither form earns its one refusal here, and names no role to check.
    const formed = kind.judges.map((entry, position) => readJudgeEntry(entry, `${where}.judges[${position}]`, makerProviders(roles[kind.maker]), refusals));
    const named = kind.judges.map((entry, position) => (formed[position] ? judgeRole(entry) : undefined));
    // No judge is the maker, and no configuration removes that separation (`R-LOOP-3`). An engine
    // that could approve its own work would be a faster way to merge mistakes.
    if (named.includes(kind.maker)) {
      refusals.push(`\`${where}\` names \`${kind.maker}\` as both its maker and one of its judges, and no judge is the maker`);
    }
    // Each judge of a card runs in a directory named for its role, so a judge named twice would
    // be two dispatches sharing one directory (ruling 1 Q3 on #467; `R-WORK-12`). The owner is
    // never dispatched, and named twice is named before last, which the owner's own rule below
    // refuses.
    const repeated = named.filter((judge, position) => formed[position] && judge !== undefined && judge !== OWNER && named.indexOf(judge) !== position);
    for (const judge of new Set(repeated)) {
      refusals.push(`\`${where}.judges\` names \`${judge}\` more than once, and each judge of a card has a directory of its own`);
    }
    named.forEach((judge, position) => {
      if (!formed[position]) return;
      if (judge !== OWNER && !(typeof judge === 'string' && Object.hasOwn(roles, judge))) {
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
 * The providers the maker declared as `maker` can run on: its `provider`, and each provider its
 * `providerLabels` selects, where each is a name. A maker that declares neither runs on none the
 * validator can read, and earned its refusal where its role was read.
 */
function makerProviders(maker) {
  if (!declares(maker)) return [];
  const labelled = mapsNamesToStrings(maker.providerLabels) ? Object.values(maker.providerLabels) : [];
  return [...new Set([maker.provider, ...labelled].filter(names))];
}

/** Whether `provider` names a provider Rigger has an adapter for, read from L0's adapter map. */
const adapted = (provider) => typeof provider === 'string' && Object.hasOwn(ADAPTERS, provider);

/**
 * Whether a value is a plain object whose every enumerable own key is a name: what `mapsNamesToStrings`
 * asks of an object besides the type of its values.
 */
function plainWithNamedKeys(value) {
  if (!declares(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  if (Object.getOwnPropertySymbols(value).some((symbol) => Object.getOwnPropertyDescriptor(value, symbol).enumerable)) return false;
  return Object.keys(value).every(names);
}

/**
 * What one entry of a kind's `judges` may be, sitting at `where`: a role name, or an object holding
 * exactly `role` and `provider`, whose `provider` is a provider Rigger has an adapter for, or a map
 * from each provider in `providers`, those the kind's maker can run on, to one (`D24` rule 1). The
 * entry object and a map are read as a role's `labels` is (`mapsNamesToStrings`). The owner has no
 * provider, so it is written only as a plain name. It answers whether the entry is either form, so
 * the kind's checks read a role from it through `judgeRole`.
 */
function readJudgeEntry(entry, where, providers, refusals) {
  if (typeof entry === 'string') return true;
  if (!declares(entry)) {
    refusals.push(`\`${where}\` is neither a role name nor \`{ role, provider }\`, and the config gives ${inspect(entry)}`);
    return false;
  }
  readShape(entry, 'judge', where, refusals);
  if (judgeRole(entry) === OWNER) {
    refusals.push(`\`${where}\` names \`${OWNER}\` as \`{ role, provider }\`, and the owner, who has no provider, is written only as a plain name`);
  }
  const { provider } = entry;
  if (typeof provider === 'string') {
    if (!mapsNamesToStrings(entry)) refusals.push(`\`${where}\` must be a plain object of names to strings, and the config gives ${inspect(entry)}`);
    else if (!adapted(provider)) refusals.push(`\`${where}.provider\` names ${inspect(provider)}, which is no provider Rigger has an adapter for`);
  } else if (Object.hasOwn(entry, 'provider')) {
    if (!plainWithNamedKeys(entry)) refusals.push(`\`${where}\` must be a plain object of names, and the config gives ${inspect(entry)}`);
    if (!mapsNamesToStrings(provider)) {
      refusals.push(`\`${where}.provider\` must be a provider name or map provider names to provider names, and the config gives ${inspect(provider)}`);
    } else {
      for (const [from, to] of Object.entries(provider)) {
        for (const named of [from, to]) {
          if (!adapted(named)) refusals.push(`\`${where}.provider\` maps ${inspect(named)}, which is no provider Rigger has an adapter for`);
        }
      }
      for (const held of providers) {
        if (!Object.hasOwn(provider, held)) refusals.push(`\`${where}.provider\` holds no key for \`${held}\`, a provider the kind's maker can run on`);
      }
    }
  }
  return true;
}

/**
 * What a declared `timeout` may be, on a step or a role alike: the milliseconds L1 lets it run,
 * which is a count. One that declares none runs for its default, so only a declared one has
 * anything to read.
 */
function readTimeout(holder, where, refusals) {
  if (Object.hasOwn(holder, 'timeout') && !(Number.isInteger(holder.timeout) && holder.timeout >= 1)) {
    refusals.push(`\`${where}.timeout\` must be a positive whole number of milliseconds, and the config gives ${inspect(holder.timeout)}`);
  }
}

/**
 * Whether a value is a plain object whose every key is a name holding a string: what an object
 * literal mapping names to strings is. A Map, a class instance, an inherited or computed entry,
 * and an enumerable symbol key each hold something `Object.entries` would never show, so the
 * validator would pass what the engine later reads differently.
 *
 * A key of `labels` is an enumerable own key, as for every declaration the validator reads. A key
 * the config defines as non-enumerable is no declaration: the validator neither reads nor refuses
 * it, as for every other declaration in the config (ruling 16 on #467).
 */
function mapsNamesToStrings(value) {
  if (!declares(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  if (Object.getOwnPropertySymbols(value).some((symbol) => Object.getOwnPropertyDescriptor(value, symbol).enumerable)) return false;
  return Object.keys(value).every((key) => names(key) && typeof Object.getOwnPropertyDescriptor(value, key).value === 'string');
}

/**
 * What a role's `labels` may be: card labels, each mapped to the tier it selects for the role.
 * A card carries labels by name, and the tier a label selects is one of the tiers Rigger fixes.
 */
function readTierLabels(labels, where, refusals) {
  if (!mapsNamesToStrings(labels)) {
    refusals.push(`\`${where}\` must map label names to tiers, and the config gives ${inspect(labels)}`);
    return;
  }
  for (const [label, tier] of Object.entries(labels)) {
    if (!TIERS.includes(tier)) {
      refusals.push(`\`${where}\` maps \`${label}\` to ${inspect(tier)}, and a label selects ${TIER_NAMES}`);
    }
  }
}

/**
 * What a role's `providerLabels` may be: card labels, each mapped to the provider it selects for
 * the role, read as `labels` is, and each a provider Rigger has an adapter for.
 */
function readProviderLabels(labels, where, refusals) {
  if (!mapsNamesToStrings(labels)) {
    refusals.push(`\`${where}\` must map label names to providers, and the config gives ${inspect(labels)}`);
    return;
  }
  for (const [label, provider] of Object.entries(labels)) {
    if (!adapted(provider)) refusals.push(`\`${where}\` maps \`${label}\` to ${inspect(provider)}, which is no provider Rigger has an adapter for`);
  }
}

/**
 * What each role may be: a name holding no `/`, and declarations naming a provider Rigger has an
 * adapter for, the tier it runs at, the labels that select another, and the time it may run.
 */
function readRoles(roles, refusals) {
  // Roles that are no set of declarations earned their refusal where the shape was read.
  if (!declares(roles)) return;
  for (const [name, role] of Object.entries(roles)) {
    const where = `roles.${name}`;
    // A judge's directory is named for its role, directly under the card's topic, so a `/` would
    // place it somewhere else (ruling 1 Q3 on #467).
    if (name.includes('/')) {
      refusals.push(`\`${where}\` holds a \`/\` in its name, and a role's name names a directory`);
    }
    // Each of these resolves to the directory above the role's own, or to that directory itself,
    // so making it fresh would remove what every other card holds there (#558; ruling 19 on #555).
    if (['..', '.', ''].includes(name)) {
      refusals.push(`\`${where}\` names no directory of its own beside the others, and a role's name names a directory`);
    }
    // A role that is no set of declarations, or names no tier, earned its refusal where the shape
    // was read.
    if (!declares(role)) continue;
    if (Object.hasOwn(role, 'tier') && !TIERS.includes(role.tier)) {
      refusals.push(`\`${where}.tier\` must be ${TIER_NAMES}, and the config gives ${inspect(role.tier)}`);
    }
    // L0's adapter map holds every provider a role can name, so the names are its and never
    // typed here (ruling 3 P11 on #467; `D8`).
    if (Object.hasOwn(role, 'provider') && !adapted(role.provider)) {
      refusals.push(`\`${where}.provider\` names ${inspect(role.provider)}, which is no provider Rigger has an adapter for`);
    }
    if (Object.hasOwn(role, 'labels')) readTierLabels(role.labels, `${where}.labels`, refusals);
    if (Object.hasOwn(role, 'providerLabels')) readProviderLabels(role.providerLabels, `${where}.providerLabels`, refusals);
    readTimeout(role, where, refusals);
  }
}

/**
 * What the epic label may be: one label name, which a card carries to mark it an epic. A config
 * that declares none marks no card, so only a declared one has anything to read.
 *
 * No kind may select it. Every card that kind selected would be an epic, which Rigger never pulls
 * (`R-SCHED-11`), so the kind's work would never run and nobody would be told why.
 */
function readEpicLabel(config, refusals) {
  if (!Object.hasOwn(config, 'epicLabel')) return;
  const { epicLabel } = config;
  if (!names(epicLabel)) {
    refusals.push('`epicLabel` must be one label name');
    return;
  }
  readSelectorLabel(epicLabel, 'epicLabel', refusals);
  // Kinds that are no set of declarations, and labels that are no list, earned their refusal
  // where they were read.
  if (!declares(config.kinds)) return;
  for (const [name, kind] of Object.entries(config.kinds)) {
    const labels = kind?.select?.labels;
    if (Array.isArray(labels) && labels.some((label) => sameLabel(label, epicLabel))) {
      refusals.push(`\`epicLabel\` names \`${epicLabel}\`, which \`kinds.${name}\` selects, so no card that kind selects would ever be pulled`);
    }
  }
}

/**
 * What a declared board owner may be: the login of one GitHub user or organisation, which is a
 * name. A config that declares none works the repository's owner's board, so only a declared one
 * has anything to read.
 */
function readBoardOwner(board, refusals) {
  // A board that is no set of declarations earned its refusal where the shape was read.
  if (!declares(board) || !Object.hasOwn(board, 'owner')) return;
  if (!names(board.owner)) refusals.push('`board.owner` must be one login: a string holding something other than whitespace');
}

/**
 * What a declared concurrency may be: N, the number of cards L3 works at once, which is a
 * positive whole number. A config that declares none runs at the default, so only a declared one
 * has anything to read.
 */
function readConcurrency(config, refusals) {
  if (!Object.hasOwn(config, 'concurrency')) return;
  const { concurrency } = config;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    // Named as a module would write it: JSON spells NaN and Infinity as null, and throws on a BigInt.
    refusals.push(`\`concurrency\` must be a positive whole number, and the config gives ${inspect(concurrency)}`);
  }
}

/**
 * What a step's working directory may be: a relative path naming a directory under the card's
 * workspace, which L1 runs the step in.
 */
function readStepDirectory(cwd, where, refusals) {
  if (typeof cwd !== 'string') {
    refusals.push(`\`${where}.cwd\` must be a path under the card's workspace, and the config gives ${inspect(cwd)}`);
    return;
  }
  // An absolute path names its directory wherever the workspace is.
  if (posix.isAbsolute(cwd)) {
    refusals.push(`\`${where}\` runs in \`${cwd}\`, which is absolute, and a step runs under the card's workspace`);
    return;
  }
  // Normalised, a relative path that climbs out of the workspace begins with a `..` segment.
  const normal = posix.normalize(cwd);
  if (normal === '..' || normal.startsWith('../')) {
    refusals.push(`\`${where}\` runs in \`${cwd}\`, which resolves outside the card's workspace`);
  }
}

/**
 * What each provisioning step may declare: a command line, and a selector. A step that selects
 * nothing is selected by the kinds that name it, so only a step that declares `select` has labels
 * to read.
 */
function readProvisioning(provisioning, refusals) {
  // Provisioning that is no set of declarations earned its refusal where the shape was read.
  if (!declares(provisioning)) return;
  for (const [name, step] of Object.entries(provisioning)) {
    const where = `provisioning.${name}`;
    readLabels(step?.select, `${where}.select.labels`, refusals);
    // A step that is no set of declarations, or names no `run`, earned its refusal where the shape
    // was read. L1 runs the command line under `/bin/sh`, so anything else is nothing it can run.
    if (!declares(step)) continue;
    if (Object.hasOwn(step, 'run') && !names(step.run)) {
      refusals.push(`\`${where}.run\` must be a command line: a string holding something other than whitespace`);
    }
    if (Object.hasOwn(step, 'cwd')) readStepDirectory(step.cwd, where, refusals);
    readTimeout(step, where, refusals);
  }
}

/**
 * What a kind's provisioning may be: the steps it runs, as a list of step names. A kind that
 * declares none runs no step, so only a declared list has anything to read.
 */
function readKindSteps(config, refusals) {
  // Kinds or provisioning that are no set of declarations earned their refusal where the shape
  // was read. A config that declares no provisioning declares no step.
  const declared = Object.hasOwn(config, 'provisioning') ? config.provisioning : {};
  if (!declares(config.kinds) || !declares(declared)) return;
  for (const [name, kind] of Object.entries(config.kinds)) {
    if (!declares(kind) || !Object.hasOwn(kind, 'provisioning')) continue;
    const steps = kind.provisioning;
    // L2 reads the steps as a list of names, so a string would be read a character at a time.
    if (!Array.isArray(steps) || holdsUnnamed(steps)) {
      refusals.push(`\`kinds.${name}.provisioning\` must be a list of step names`);
      continue;
    }
    // A step the config does not declare is one Rigger has no command for (`R-SCHED-10`).
    for (const step of steps) {
      if (!Object.hasOwn(declared, step)) {
        refusals.push(`\`kinds.${name}\` names the step \`${step}\`, which \`provisioning\` does not declare`);
      }
    }
  }
}

/**
 * What a declared worktree root and topic may be: a path naming a directory, and the rule naming
 * each card's workspace directly under it. A key the config does not declare takes the default the
 * Engine settings row states, so only a declared one has anything to read.
 */
function readWorktrees(worktrees, refusals) {
  // A declaration that is no set of declarations earned its refusal where the shape was read.
  if (!declares(worktrees)) return;
  if (Object.hasOwn(worktrees, 'root') && !names(worktrees.root)) {
    refusals.push('`worktrees.root` must be a path: a string holding something other than whitespace');
  }
  if (!Object.hasOwn(worktrees, 'topic')) return;
  const { topic } = worktrees;
  if (typeof topic !== 'string') {
    refusals.push(`\`worktrees.topic\` must be a string, and the config gives ${inspect(topic)}`);
    return;
  }
  // The issue number is what tells one card's workspace and branch from another's, so a topic
  // that never places it names one of each for every card (`R-WORK-9`).
  if (!topic.includes('{number}')) {
    refusals.push(`\`worktrees.topic\` is \`${topic}\`, which holds no \`{number}\`, so it names one workspace for every card`);
  }
  // A workspace sits directly under the root. A `/` would make directories there that Rigger never
  // removes, and a branch git refuses wherever one holds the part before it. An absolute topic and
  // a `..` segment are each such a topic (ruling 3, P2).
  if (topic.includes('/')) {
    refusals.push(`\`worktrees.topic\` is \`${topic}\`, which holds a \`/\`, and a workspace sits directly under the root`);
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
  if (holdsUnnamed(options)) {
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

/**
 * What `escalate` may hold: a destination for any of the fixed categories, and nothing else
 * (`R-ESCALATE-13`). A config that declares none sends every category to the owner, so only a
 * declared one has anything to read, and one that is no object earned its refusal where the shape
 * was read.
 */
function readEscalate(config, refusals) {
  if (!Object.hasOwn(config, 'escalate') || !declares(config.escalate)) return;
  for (const [key, destination] of Object.entries(config.escalate)) {
    const where = `escalate.${key}`;
    if (!CATEGORIES.includes(key)) refusals.push(`\`${where}\` is no escalation category Rigger offers`);
    else if (typeof destination !== 'string') {
      refusals.push(`\`${where}\` must name a destination, \`${OWNER}\` or a role, and the config gives ${inspect(destination)}`);
    } else if (destination !== OWNER && declares(config.roles) && !Object.hasOwn(config.roles, destination)) {
      refusals.push(`\`${where}\` names \`${destination}\`, which is neither \`${OWNER}\` nor a role the config declares`);
    } else if (destination !== OWNER && key !== 'ambiguous') {
      // Only an ambiguity may go to a role. Critical and a recorded-decision change are the
      // owner's alone (`R-ESCALATE-14`).
      refusals.push(`\`${where}\` names the role \`${destination}\`, and ${key} goes only to the owner`);
    }
  }
}

/** A duration in milliseconds is a positive whole number, as readTimeout requires. */
const milliseconds = (value) => Number.isInteger(value) && value >= 1;

/** The shared refusal text for an invalid millisecond duration, preserving readTimeout's rendering. */
const durationReason = (value) => `must be a positive whole number of milliseconds, and the config gives ${inspect(value)}`;

/** The anchor's epoch milliseconds, or NaN for a spelling outside the accepted anchor grammar. */
function anchorInstant(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value || match[8] === '-00:00') return NaN;
  const [, year, month, day, hour, minute, second = '0', fraction = '0', , sign, offsetHour = '0', offsetMinute = '0'] = match;
  if (+hour > 23 || +minute > 59 || +second > 59 || +offsetHour > 23 || +offsetMinute > 59) return NaN;
  const local = new Date(0);
  // setUTCFullYear preserves years 0000 to 0099, which Date.UTC maps to 1900 to 1999.
  local.setUTCFullYear(+year, +month - 1, +day);
  local.setUTCHours(+hour, +minute, +second, +fraction.padEnd(3, '0'));
  if (local.getUTCFullYear() !== +year || local.getUTCMonth() !== +month - 1 || local.getUTCDate() !== +day) return NaN;
  const offset = (+offsetHour * 60 + +offsetMinute) * 60000 * (sign === '-' ? -1 : 1);
  return local.getTime() - offset;
}

/**
 * Parse a trigger's schedule and answer its adjacent occurrences at instant (epoch milliseconds).
 * Invalid schedules answer refusals as { key, reason }. Valid ones also answer newest and next,
 * each in epoch milliseconds or null where no occurrence exists in ECMA-262's time range.
 */
export function schedule(trigger, instant) {
  const refusals = [];
  if (!milliseconds(trigger.interval)) refusals.push({ key: 'interval', reason: durationReason(trigger.interval) });
  const anchor = anchorInstant(trigger.anchor);
  if (!Number.isFinite(anchor)) refusals.push({ key: 'anchor', reason: `must name an existing date and time carrying its offset, and the config gives ${inspect(trigger.anchor)}` });
  if (refusals.length) return { refusals };
  if (instant < anchor) return { refusals, newest: null, next: anchor };
  const newest = anchor + Math.floor((instant - anchor) / trigger.interval) * trigger.interval;
  const following = newest + trigger.interval;
  return { refusals, newest, next: following <= 8640000000000000 ? following : null };
}

/** A plain label list, read once by length and own index without consumer traversal methods. */
const plainLabels = (labels) => Array.isArray(labels) ? Array.from({ length: labels.length }, (_, index) => Object.hasOwn(labels, index) ? labels[index] : undefined) : labels;

/** Card-template values; readShape already refused a malformed card and its missing keys. */
function readClockCard(config, card, where, refusals, canSelect) {
  if (!declares(card)) return;
  const labels = Object.hasOwn(card, 'labels') ? plainLabels(card.labels) : undefined;
  if (Object.hasOwn(card, 'title') && !names(card.title)) {
    refusals.push(`\`${where}.title\` must be a string holding something other than whitespace`);
  }
  if (Object.hasOwn(card, 'labels') && (!Array.isArray(labels) || holdsUnnamed(labels))) refusals.push(`\`${where}.labels\` must be a list of label names`);
  if (Object.hasOwn(card, 'acceptance') && typeof card.acceptance !== 'string') {
    refusals.push(`\`${where}.acceptance\` must be one string`);
  }
  if (names(card.title) && typeof card.acceptance === 'string') {
    const form = checkAcceptanceForm({ title: card.title, body: `## Acceptance\n\n${card.acceptance}` });
    if (!form.admitted) refusals.push(`\`${where}.acceptance\` ${form.reason}`);
  }
  if (Object.hasOwn(card, 'author') && (typeof card.author !== 'string'
      || (card.author !== OWNER && declares(config.roles) && !Object.hasOwn(config.roles, card.author)))) {
    refusals.push(`\`${where}.author\` must name \`owner\` or a declared role, and the config gives ${inspect(card.author)}`);
  }
  if (Array.isArray(labels)) {
    if (canSelect) {
      const { answer } = kindOf({ labels }, config.kinds, config.epicLabel);
      if (answer) refusals.push(`\`${where}.labels\` ${inspect(labels)}: ${answer.reason ?? 'selects no kind'}`);
    }
    if (labels.some((label) => sameLabel(label, FIXED_LABELS.status))) {
      refusals.push(`\`${where}.labels\` ${inspect(labels)} holds the status label`);
    }
  }
}

/** The values of a clock's declarations; readShape already refused malformed containers. */
function readClock(config, refusals) {
  if (!Object.hasOwn(config, 'clock') || !declares(config.clock)) return;
  // kindOf assumes valid selectors. An already-refused kind or epic label earns no second
  // refusal from its template's selection (card 1077, C33 and C34).
  const canSelect = !refusals.some((reason) => ['`kinds`', '`kinds.', '`epicLabel`'].some((path) => reason.startsWith(path)));
  if (Object.hasOwn(config.clock, 'poll') && !milliseconds(config.clock.poll)) {
    refusals.push(`\`clock.poll\` ${durationReason(config.clock.poll)}`);
  }
  if (!Object.hasOwn(config.clock, 'triggers') || !declares(config.clock.triggers)) return;
  for (const [name, trigger] of Object.entries(config.clock.triggers)) {
    if (!declares(trigger)) continue;
    const where = `clock.triggers.${name}`;
    for (const { key, reason } of schedule(trigger, 0).refusals) {
      if (Object.hasOwn(trigger, key)) refusals.push(`\`${where}.${key}\` ${reason}`);
    }
    if (Object.hasOwn(trigger, 'card') === Object.hasOwn(trigger, 'job')) {
      refusals.push(`\`${where}\` must declare exactly one of \`card\` and \`job\``);
    }
    if (Object.hasOwn(trigger, 'catchUp') && !['fire', 'skip'].includes(trigger.catchUp)) {
      refusals.push(`\`${where}.catchUp\` must name \`fire\` or \`skip\`, and the config gives ${inspect(trigger.catchUp)}`);
    }
    if (Object.hasOwn(trigger, 'job') && trigger.job !== 'report') {
      refusals.push(`\`${where}.job\` must name \`report\`, and the config gives ${inspect(trigger.job)}`);
    }
    if (Object.hasOwn(trigger, 'card')) readClockCard(config, trigger.card, `${where}.card`, refusals, canSelect);
  }
}

/** Every refusal this config earns. An accepted config earns none, so the list is empty. */
export function validate(config) {
  const refusals = [];
  readShape(config, 'config', '', refusals);
  // A config file with no `export default` hands this `undefined`, and the rules below read
  // declarations there are none of. The refusal for that is already the one above.
  if (!declares(config)) return refusals;
  readRoles(config.roles, refusals);
  readKinds(config, refusals);
  readKindSteps(config, refusals);
  readEpicLabel(config, refusals);
  readConcurrency(config, refusals);
  readWorktrees(config.worktrees, refusals);
  readProvisioning(config.provisioning, refusals);
  readBoardOwner(config.board, refusals);
  readPriority(config.board?.priority, refusals);
  readEscalate(config, refusals);
  readClock(config, refusals);
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

/**
 * The milliseconds a provisioning step may run: its own `timeout`, or 1,800,000, which is 30
 * minutes, where it declares none (`ARCHITECTURE.md`, "Extension points").
 */
export const stepTimeout = (step) => step.timeout ?? 1_800_000;

/**
 * The milliseconds a role's dispatch may run: its own `timeout`, or 14,400,000, which is four
 * hours, where it declares none (`O7` on #467; `ARCHITECTURE.md`, below the extension-point
 * table). This is the one place the number is held (ruling 3 P10 on #467).
 */
export const roleTimeout = (role) => role.timeout ?? 14_400_000;

/** N when the config declares none (the Engine settings extension point). */
export const DEFAULT_CONCURRENCY = 3;

/** The milliseconds launchd must allow for serial cleanup of concurrent cards' largest judge panel. */
export function launchdExitTimeout(config) {
  const panel = Math.max(1, ...Object.values(config.kinds).map((kind) =>
    kind.judges.filter((entry) => judgeRole(entry) !== OWNER).length));
  return (config.concurrency ?? DEFAULT_CONCURRENCY) * panel * (KILL_BOUND + READ_TIMEOUT);
}

/**
 * The rule that derives a card's workspace and line of work from its number: the config's
 * `worktrees.topic`, or `rigger-{number}` where it declares none (`ARCHITECTURE.md`, the Engine
 * settings row). This is the one place the default is held, for L1's workspace and L2's line of work.
 */
export const worktreeTopic = (config = {}) => config.worktrees?.topic ?? 'rigger-{number}';

/**
 * Every label an accepted config's kinds and provisioning steps select, each once, kinds first and
 * each in the order declared: the labels a card carries to be selected. The epic label is not
 * among them, because no selector names it.
 */
export function selectedLabels(config) {
  const selectors = [...Object.values(config.kinds), ...Object.values(config.provisioning ?? {})];
  return [...new Set(selectors.flatMap((selector) => selector.select?.labels ?? []))];
}

/**
 * Every label an accepted config declares, each once: those its kinds and steps select, then its
 * epic label where it declares one, then those its roles' `labels` map to a tier, then those
 * its roles' `providerLabels` map to a provider, roles in the order declared, then the clock
 * triggers' card-template labels, triggers in the order declared, then Rigger's fixed labels.
 * These are the labels `setup-board` gives the repository. Two names GitHub holds
 * as one label are one label here, spelled as the first of them declared.
 */
export function declaredLabels(config) {
  const declared = [
    ...selectedLabels(config),
    ...(Object.hasOwn(config, 'epicLabel') ? [config.epicLabel] : []),
    ...Object.values(config.roles).flatMap((role) => Object.keys(role.labels ?? {})),
    ...Object.values(config.roles).flatMap((role) => Object.keys(role.providerLabels ?? {})),
    ...(Object.hasOwn(config, 'clock') && Object.hasOwn(config.clock, 'triggers')
      ? Object.values(config.clock.triggers).flatMap((trigger) => Object.hasOwn(trigger, 'card') ? plainLabels(trigger.card.labels) : []) : []),
    ...Object.values(FIXED_LABELS),
  ];
  return declared.filter((name, at) => !declared.slice(0, at).some((earlier) => sameLabel(earlier, name)));
}
