// ABOUTME: Parses every module under src/ and reports each boundary it crosses: the forge adapter's
// sides a directory may not import, the facts a layer may not touch, and what may spawn.

import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The forge adapter's sides (`ARCHITECTURE.md`, boundary rule 2). Each side is its own module in
 * the adapter's directory, together with its runner, which lives in the one module holding all
 * three and is named for its side: the item-write side's is `itemWriteRunner`.
 */
const FORGE = 'src/substrate/forge';
const SIDES = ['read', 'schema-write', 'item-write'];
const RUNNERS = `${FORGE}/runners.mjs`;
const sideModule = (side) => `${FORGE}/${side}.mjs`;
const runnerOf = (side) => `${side.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())}Runner`;

/**
 * Which directories may import each write side, and the rule that says so. The read side has no
 * entry because any layer or verb may import it. A side's own modules are its module and the
 * runners module, and neither is held to its side's rule.
 */
const IMPORTERS = [
  { rule: 'rule 1', sides: ['schema-write', 'item-write'], barred: (file) => file.startsWith('src/scheduling/'), says: 'src/scheduling/ imports the read side only' },
  { rule: 'rule 5', sides: ['item-write'], barred: (file) => !file.startsWith('src/workflow/'), says: 'only src/workflow/ imports the item-write side' },
  { rule: 'rule 6', sides: ['schema-write'], barred: (file) => !file.startsWith('src/cli/'), says: 'only src/cli/ imports the schema-write side' },
];

/** The write sides a module may never hand on, whichever directory it is in. */
const GUARDED = ['schema-write', 'item-write'];

/** The names a layer may not touch in code, as a name or as a string, and the rule barring each. */
const NAMES = [
  { rule: 'rule 2', directory: 'src/scheduling/', names: ['kinds', 'labels', 'body'], says: 'L3 never reads kinds, a card\'s labels or a card\'s body' },
  { rule: 'rule 4', directory: 'src/cli/', names: ['concurrency'], says: 'the CLI never reads concurrency; L3 reads N from the config it is handed' },
];

/** The modules that may import `node:child_process`: the runners, and two local tool probes. */
const SPAWNERS = [RUNNERS, 'src/cli/doctor.mjs', 'src/cli/init.mjs'];
const CHILD_PROCESS = ['node:child_process', 'child_process'];

/** The one dynamic import allowed an unresolvable specifier: doctor's load of the consumer's config. */
const CONFIG_LOAD = { file: 'src/cli/doctor.mjs', argument: 'pathToFileURL(path)' };

/** The loaders besides `import()` that bind a module at run time, out of the import graph's sight. */
const LOADERS = ['createRequire', 'getBuiltinModule'];

/** The local name a default export that declares no name of its own is held under. */
const DEFAULT = '*default*';

/** Every module under `src/`, as a map of its repository path to its source. */
export function sourceTree(root = ROOT) {
  const tree = new Map();
  for (const entry of readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:m|c)?js$/.test(entry.name)) continue;
    const path = posix.join('src', posix.relative(join(root, 'src'), join(entry.parentPath, entry.name)).split('\\').join('/'));
    tree.set(path, readFileSync(join(root, path), 'utf8'));
  }
  return tree;
}

/** The syntax nodes directly under `node`, in source order. */
function childrenOf(node) {
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    for (const held of Array.isArray(value) ? value : [value]) {
      if (held && typeof held.type === 'string') found.push(held);
    }
  }
  return found;
}

/** Calls `visit(node, parent)` on `node` and every node under it. */
function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const child of childrenOf(node)) walk(child, visit, node);
}

/** Every name `node` references anywhere under it, function bodies included. */
function namesIn(node) {
  const found = [];
  if (node) walk(node, (held) => { if (held.type === 'Identifier') found.push(held.name); });
  return found;
}

const isFunction = (node) => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

/**
 * The string an expression always evaluates to, where the source fixes it: a string literal, a
 * template whose every part is fixed, or a `+` of two fixed strings. Undefined anywhere else.
 */
function fixed(node) {
  if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node?.type === 'TemplateLiteral') {
    const parts = node.expressions.map(fixed);
    if (parts.some((part) => part === undefined)) return undefined;
    return node.quasis.map((quasi, i) => quasi.value.cooked + (parts[i] ?? '')).join('');
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const [left, right] = [fixed(node.left), fixed(node.right)];
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/** The name a key or member property spells: a plain name, or a fixed string in brackets. */
const keyOf = (node, computed) => (!computed && node?.type === 'Identifier' ? node.name : fixed(node));

/** Every name a binding pattern binds, or the binding an assignment target writes into. */
function boundBy(pattern) {
  switch (pattern?.type) {
    case 'Identifier': return [pattern.name];
    case 'ObjectPattern': return pattern.properties.flatMap((held) => boundBy(held.type === 'RestElement' ? held.argument : held.value));
    case 'ArrayPattern': return pattern.elements.flatMap(boundBy);
    case 'RestElement': return boundBy(pattern.argument);
    case 'AssignmentPattern': return boundBy(pattern.left);
    case 'MemberExpression': return boundBy(pattern.object);
    default: return [];
  }
}

/** The name a resolvable dynamic `import()` of `specifier` is carried under: that module, whole. */
const IMPORTED = 'import:';

/**
 * The function expression a call runs where it is written, however the call wraps it: a comma
 * whose last operand it is, `.call` or `.apply` on it, or both. `mode` says how the call passes
 * its arguments. Null where the callee is anything else.
 */
function calledFunction(callee) {
  let node = callee;
  let mode = 'direct';
  for (;;) {
    if (node?.type === 'SequenceExpression') {
      node = node.expressions.at(-1);
    } else if (mode === 'direct' && node?.type === 'MemberExpression' && ['call', 'apply'].includes(keyOf(node.property, node.computed))) {
      mode = keyOf(node.property, node.computed);
      node = node.object;
    } else {
      return isFunction(node) ? { fn: node, mode } : null;
    }
  }
}

/** Whether a node opens a scope of its own for `let`, `const`, `class` and `function`. */
const BLOCKS = new Set(['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause', 'StaticBlock']);

/**
 * Reads what every binding in one module holds, scope by scope, and gives each top-level binding
 * in `carries` the names whose values it can hold. Module scope is where a name resolves to the
 * module's own binding or import; every block and every function has a scope of its own, which
 * persists across passes so a chain of aliases settles.
 */
function holdings(program, topLevel, carries) {
  const scopes = new WeakMap();
  const returns = new WeakMap();
  const moduleScope = { vars: null, parent: null, fn: null };
  let changed = false;

  const scopeFor = (node, parent, fn) => {
    if (!scopes.has(node)) scopes.set(node, { vars: new Map(), parent, fn });
    return scopes.get(node);
  };
  const functionScope = (scope) => {
    let at = scope;
    while (at.vars && !at.fn) at = at.parent;
    return at;
  };
  const addAll = (set, names) => {
    for (const held of names) {
      if (!set.has(held)) {
        set.add(held);
        changed = true;
      }
    }
  };
  // A name in `scope` resolves to the nearest scope declaring it, or to the module's own binding.
  const lookup = (name, scope) => {
    for (let at = scope; at.vars; at = at.parent) if (at.vars.has(name)) return [...at.vars.get(name)];
    return [name];
  };
  const declare = (scope, names, values) => {
    for (const bound of names) {
      if (!scope.vars) {
        if (carries.has(bound)) addAll(carries.get(bound), values.filter((held) => held !== bound));
        continue;
      }
      if (!scope.vars.has(bound)) scope.vars.set(bound, new Set());
      addAll(scope.vars.get(bound), values);
    }
  };
  // An assignment writes into the nearest scope declaring the name, else the module's binding.
  const assign = (names, values, scope) => {
    for (const bound of names) {
      let at = scope;
      while (at.vars && !at.vars.has(bound)) at = at.parent;
      declare(at, [bound], values);
    }
  };

  /**
   * Reads a function's body in its own scope, its parameters holding `passed` (one list of values
   * per parameter) or their defaults, and returns that scope. A function not called where it is
   * written is read with its parameters holding nothing, so what its body writes into a module
   * binding is still seen.
   */
  const readFunction = (fn, parent, passed = []) => {
    const scope = scopeFor(fn, parent, fn);
    if (!returns.has(fn)) returns.set(fn, new Set());
    if (fn.id && fn.type === 'FunctionExpression') declare(scope, [fn.id.name], []);
    fn.params.forEach((param, i) => {
      const given = param.type === 'RestElement' ? passed.slice(i).flat() : passed[i] ?? [];
      const defaults = param.type === 'AssignmentPattern' ? valuesOf(param.right, scope) : [];
      declare(scope, boundBy(param), [...given, ...defaults]);
      if (param.type === 'AssignmentPattern') read(param.right, scope);
    });
    if (fn.body.type === 'BlockStatement') for (const statement of fn.body.body) read(statement, scope);
    else {
      addAll(returns.get(fn), valuesOf(fn.body, scope));
      read(fn.body, scope);
    }
    return scope;
  };

  /** What a function called where it is written hands back, given what the call passes it. */
  const invoked = (fn, passed, scope) => {
    readFunction(fn, scope, passed);
    return [...returns.get(fn)];
  };

  /**
   * The names whose values an expression can evaluate to in `scope`. A function is a value of its
   * own and hands on nothing until it is called, because calling a side through L2 is the ruled
   * path; a function called where it is written hands on what it returns. A call to anything else
   * may hand back its callee or any argument, so it carries all of them. A resolvable dynamic
   * `import()` carries its module whole.
   */
  const valuesOf = (node, scope) => {
    if (!node) return [];
    const of = (held) => valuesOf(held, scope);
    switch (node.type) {
      case 'Identifier': return lookup(node.name, scope);
      case 'MemberExpression': return of(node.object);
      case 'ChainExpression': return of(node.expression);
      case 'ConditionalExpression': return [...of(node.consequent), ...of(node.alternate)];
      case 'LogicalExpression': return [...of(node.left), ...of(node.right)];
      case 'SequenceExpression': return of(node.expressions.at(-1));
      case 'AssignmentExpression': return of(node.right);
      case 'AwaitExpression':
      case 'SpreadElement':
      case 'YieldExpression': return of(node.argument);
      case 'ArrayExpression': return node.elements.flatMap(of);
      case 'ObjectExpression':
        return node.properties.flatMap((held) => {
          if (held.type === 'SpreadElement') return of(held.argument);
          return held.kind === 'init' && !held.method ? of(held.value) : [];
        });
      case 'ClassExpression':
      case 'ClassDeclaration':
        return node.body.body.filter((member) => member.static && member.type === 'PropertyDefinition').flatMap((member) => of(member.value));
      case 'ImportExpression': {
        const specifier = fixed(node.source);
        return specifier === undefined ? [] : [`${IMPORTED}${specifier}`];
      }
      case 'CallExpression':
      case 'NewExpression': {
        const called = calledFunction(node.callee);
        const given = node.arguments.map(of);
        if (!called) return [...of(node.callee), ...given.flat()];
        if (called.mode === 'direct') return invoked(called.fn, given, scope);
        if (called.mode === 'call') return invoked(called.fn, given.slice(1), scope);
        const list = node.arguments[1];
        const spread = list?.type === 'ArrayExpression' ? list.elements.map(of) : called.fn.params.map(() => of(list));
        return invoked(called.fn, spread, scope);
      }
      case 'TaggedTemplateExpression': {
        const called = calledFunction(node.tag);
        const given = node.quasi.expressions.map(of);
        if (!called) return [...of(node.tag), ...given.flat()];
        return invoked(called.fn, called.mode === 'call' ? given : [[], ...given], scope);
      }
      default: return [];
    }
  };

  /** Reads `node` in `scope`: every declaration, assignment, call and return in it. */
  const read = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
        return;
      case 'FunctionDeclaration':
        declare(scope, [node.id.name], []);
        readFunction(node, scope);
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        readFunction(node, scope);
        return;
      case 'ClassDeclaration':
        declare(scope, [node.id.name], valuesOf(node, scope));
        break;
      case 'VariableDeclaration':
        for (const each of node.declarations) {
          declare(node.kind === 'var' ? functionScope(scope) : scope, boundBy(each.id), valuesOf(each.init, scope));
          read(each.init, scope);
        }
        return;
      case 'ExportDefaultDeclaration':
        if (!node.declaration.id) declare(moduleScope, [DEFAULT], valuesOf(node.declaration, scope));
        break;
      case 'ReturnStatement': {
        const fn = functionScope(scope).fn;
        if (fn && node.argument) addAll(returns.get(fn), valuesOf(node.argument, scope));
        break;
      }
      case 'AssignmentExpression':
        assign(boundBy(node.left), valuesOf(node.right, scope), scope);
        break;
      case 'CallExpression':
      case 'NewExpression':
      case 'TaggedTemplateExpression': {
        const args = node.type === 'TaggedTemplateExpression' ? node.quasi.expressions : node.arguments;
        const callee = node.type === 'TaggedTemplateExpression' ? node.tag : node.callee;
        // A call handed a binding, or made on one, may put any argument into it.
        const receivers = [
          ...args.filter((held) => held.type === 'Identifier').map((held) => held.name),
          ...(callee.type === 'MemberExpression' ? boundBy(callee.object) : []),
        ];
        assign(receivers, args.flatMap((held) => valuesOf(held, scope)), scope);
        if (calledFunction(callee)) {
          valuesOf(node, scope);
          for (const held of args) read(held, scope);
          return;
        }
        break;
      }
      default:
        if (BLOCKS.has(node.type)) {
          const inner = scopeFor(node, scope, null);
          for (const child of childrenOf(node)) read(child, inner);
          return;
        }
    }
    for (const child of childrenOf(node)) read(child, scope);
  };

  // Each pass lets one more link in a chain of aliases take what the link before it was given.
  for (let pass = 0; pass < 50; pass++) {
    changed = false;
    for (const statement of program.body) read(statement, moduleScope);
    if (!changed) return;
  }
  throw new Error('what its bindings hold did not settle in 50 passes');
}

/**
 * One module parsed: what it imports and exports, its dynamic imports, and for each top-level
 * binding the names it references (`reaches`, which the runners module's sides are read from) and
 * the names it was given as a value (`carries`, which a hand-on is read from). Throws, naming the
 * line, on a module that does not parse, so one it cannot read is refused rather than passed.
 */
function parsed(file, source) {
  let program;
  try {
    program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (error) {
    throw Object.assign(new Error(`it does not parse as a module: ${error.message}`), { line: error.loc?.line ?? '?' });
  }
  const imports = [];
  const exported = new Map();
  const stars = [];
  const dynamic = [];
  const name = (node) => node.name ?? node.value;
  const lineOf = (node) => node.loc.start.line;

  // The top-level bindings, before anything is read about them.
  const topLevel = new Set([DEFAULT]);
  for (const statement of program.body) {
    const declaration = statement.type.startsWith('Export') ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration') declaration.declarations.forEach((each) => boundBy(each.id).forEach((bound) => topLevel.add(bound)));
    if (declaration?.id && ['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type)) topLevel.add(declaration.id.name);
  }
  // A `var` in a top-level block belongs to the module, as one written at its top level does.
  const hoisted = (node) => {
    if (isFunction(node) || node.type === 'FunctionDeclaration') return;
    if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach((each) => boundBy(each.id).forEach((bound) => topLevel.add(bound)));
    for (const child of childrenOf(node)) hoisted(child);
  };
  hoisted(program);
  const reaches = new Map([...topLevel].map((bound) => [bound, new Set()]));
  const carries = new Map([...topLevel].map((bound) => [bound, new Set()]));
  const give = (map, targets, names) => {
    for (const target of targets) {
      if (!map.has(target)) continue;
      for (const held of names) if (held !== target) map.get(target).add(held);
    }
  };

  for (const statement of program.body) {
    const line = lineOf(statement);
    if (statement.type === 'ImportDeclaration') {
      const from = statement.source.value;
      for (const specifier of statement.specifiers) {
        const imported = specifier.type === 'ImportDefaultSpecifier' ? 'default'
          : specifier.type === 'ImportNamespaceSpecifier' ? '*' : name(specifier.imported);
        imports.push({ local: specifier.local.name, imported, from, line });
      }
      if (statement.specifiers.length === 0) imports.push({ local: null, imported: null, from, line });
      continue;
    }
    if (statement.type === 'ExportAllDeclaration') {
      if (statement.exported) exported.set(name(statement.exported), { from: statement.source.value, imported: '*', line });
      else stars.push({ from: statement.source.value, line });
      continue;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      for (const specifier of statement.specifiers) {
        exported.set(name(specifier.exported), statement.source
          ? { from: statement.source.value, imported: name(specifier.local), line }
          : { local: name(specifier.local), line });
      }
      const declaration = statement.declaration;
      if (declaration?.type === 'VariableDeclaration') {
        declaration.declarations.forEach((each) => boundBy(each.id).forEach((bound) => exported.set(bound, { local: bound, line })));
      } else if (declaration?.id) {
        exported.set(declaration.id.name, { local: declaration.id.name, line });
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration;
      const named = declaration.id && ['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type);
      exported.set('default', { local: named ? declaration.id.name : DEFAULT, line });
    }

    // What the statement declares: each name reaches every name its own declarator or
    // declaration references, which is how the runners module's bindings join a side.
    const declaration = statement.type.startsWith('Export') ? statement.declaration : statement;
    if (statement.type === 'ExportDefaultDeclaration') give(reaches, [DEFAULT], namesIn(declaration));
    if (declaration?.type === 'VariableDeclaration') {
      for (const each of declaration.declarations) give(reaches, boundBy(each.id), namesIn(each));
    }
    if (declaration?.id && ['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type)) {
      give(reaches, [declaration.id.name], namesIn(declaration));
    }
    walk(statement, (node) => {
      // A write into a top-level binding, wherever it sits, reaches what is written.
      if (node.type === 'AssignmentExpression') give(reaches, boundBy(node.left).filter((bound) => topLevel.has(bound)), namesIn(node.right));
      // A call handed a top-level binding, or made on one, may put any argument into it.
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const receivers = [
          ...node.arguments.filter((held) => held.type === 'Identifier').map((held) => held.name),
          ...(node.callee.type === 'MemberExpression' ? boundBy(node.callee.object) : []),
        ].filter((bound) => topLevel.has(bound));
        give(reaches, receivers, node.arguments.flatMap(namesIn));
      }
    });
  }
  holdings(program, topLevel, carries);

  const names = [];
  const strings = [];
  walk(program, (node) => {
    if (node.type === 'ImportExpression') {
      const specifier = fixed(node.source);
      dynamic.push({ line: lineOf(node), specifier: specifier ?? null, argument: source.slice(node.source.start, node.source.end) });
    }
    if (node.type === 'Identifier') names.push({ value: node.name, line: lineOf(node) });
    const value = fixed(node);
    if (value !== undefined) strings.push({ value, line: lineOf(node) });
  });
  return { file, program, imports, exported, stars, dynamic, reaches, carries, topLevel, names, strings };
}

/**
 * The lines on which a module spells the config path `board.priority`: a member access from
 * `board` to `priority`, by `.`, `?.` or a fixed string in brackets, or a destructuring pattern
 * that takes `priority` from a `board` key or from what `board` names. Any other use of the name
 * `board` passes, so L3's board handle does; a read through an alias or a computed key is a review
 * finding (the card's Rule 3 item).
 */
function priorityReads(program) {
  const lines = [];
  const isBoard = (node) => (node?.type === 'Identifier' && node.name === 'board')
    || (node?.type === 'MemberExpression' && keyOf(node.property, node.computed) === 'board');
  const takesPriority = (pattern) => pattern?.type === 'ObjectPattern'
    && pattern.properties.some((held) => held.type === 'Property' && keyOf(held.key, held.computed) === 'priority');
  const unwrapped = (pattern) => (pattern?.type === 'AssignmentPattern' ? pattern.left : pattern);
  walk(program, (node) => {
    if (node.type === 'MemberExpression' && keyOf(node.property, node.computed) === 'priority' && isBoard(node.object)) {
      lines.push(node.loc.start.line);
    }
    if (node.type === 'ObjectPattern') {
      for (const held of node.properties) {
        if (held.type === 'Property' && keyOf(held.key, held.computed) === 'board' && takesPriority(unwrapped(held.value))) lines.push(held.loc.start.line);
      }
    }
    if (node.type === 'VariableDeclarator' && takesPriority(node.id) && isBoard(node.init)) lines.push(node.loc.start.line);
    if (node.type === 'AssignmentExpression' && takesPriority(node.left) && isBoard(node.right)) lines.push(node.loc.start.line);
  });
  return lines;
}

/**
 * Everything the rules read about `tree`, a map of each module's path under src/ to its source.
 *
 * Returns `violations`, each `{ file, line, rule, message }` with a message naming the file and
 * the rule it broke, and `exempt`, the dynamic imports admitted under the config-load exception.
 * Throws where a side has no module or no runner, because rules over a side that is not there
 * pass vacuously.
 */
export function boundaryReport(tree) {
  for (const side of SIDES) {
    if (!tree.has(sideModule(side))) throw new Error(`the ${side} side has no module at ${sideModule(side)}, so no rule over it could fail`);
  }
  if (!tree.has(RUNNERS)) throw new Error(`the forge adapter has no runners module at ${RUNNERS}, so no rule over them could fail`);

  const modules = new Map();
  const violations = [];
  const exempt = [];
  const report = (file, line, rule, what) => violations.push({ file, line, rule, message: `${file} line ${line} breaks ${rule}: ${what}` });
  for (const [file, source] of tree) {
    try {
      modules.set(file, parsed(file, source));
    } catch (error) {
      report(file, error.line ?? '?', 'the unreadable-module rule', error.message);
    }
  }
  const runners = modules.get(RUNNERS);
  for (const side of SIDES) {
    if (runners && !runners.topLevel.has(runnerOf(side))) throw new Error(`${RUNNERS} declares no ${runnerOf(side)}, the ${side} side's runner, so no rule over it could fail`);
  }

  /** The module a specifier in `file` names: a path in the tree, null for a Node built-in, or a throw. */
  const target = (file, specifier) => {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const path = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!modules.has(path)) throw new Error(`\`${specifier}\` names no module under src/ this test can read`);
      return path;
    }
    if (builtinModules.includes(specifier.replace(/^node:/, ''))) return null;
    throw new Error(`\`${specifier}\` is neither a module under src/ nor a Node built-in`);
  };

  /** The definitions, each `{ file, local }`, that `name` exported from `file` resolves to. */
  const resolveExport = (file, name, seen = new Set()) => {
    if (file === null) return [];
    const key = `${file}#${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const module = modules.get(file);
    if (name === '*') return [...exportNames(file)].flatMap((each) => resolveExport(file, each, seen));
    const entry = module.exported.get(name);
    if (entry?.from !== undefined) return resolveExport(target(file, entry.from), entry.imported, seen);
    if (entry) return resolveLocal(file, entry.local, seen);
    if (name !== 'default') {
      for (const star of module.stars) {
        const from = target(file, star.from);
        if (from !== null && exportNames(from).has(name)) return resolveExport(from, name, seen);
      }
    }
    throw new Error(`${file} exports no \`${name}\``);
  };

  /**
   * The definitions the top-level name `local` in `file` resolves to: an import's, followed to
   * where it is defined, or this module's own, together with every binding it was given as a value.
   */
  const resolveLocal = (file, local, seen = new Set()) => {
    const key = `${file}@${local}`;
    if (seen.has(key)) return [];
    seen.add(key);
    if (local.startsWith(IMPORTED)) return resolveExport(target(file, local.slice(IMPORTED.length)), '*', seen);
    const module = modules.get(file);
    const imported = module.imports.find((entry) => entry.local === local);
    if (imported) return resolveExport(target(file, imported.from), imported.imported, seen);
    const given = [...(module.carries.get(local) ?? [])]
      .filter((held) => held.startsWith(IMPORTED) || module.topLevel.has(held) || module.imports.some((entry) => entry.local === held));
    return [{ file, local }, ...given.flatMap((held) => resolveLocal(file, held, seen))];
  };

  /** Every name `file` exports, its star exports' included. */
  const exportNames = (file, seen = new Set()) => {
    const names = new Set();
    if (file === null || seen.has(file)) return names;
    seen.add(file);
    for (const name of modules.get(file).exported.keys()) names.add(name);
    for (const star of modules.get(file).stars) {
      for (const name of exportNames(target(file, star.from), seen)) if (name !== 'default') names.add(name);
    }
    return names;
  };

  /**
   * The write sides a definition belongs to: every binding a side's module defines, and in the
   * runners module every binding from which that side's runner is reachable within the module.
   */
  const sidesOf = ({ file, local }) => {
    const found = GUARDED.filter((side) => file === sideModule(side));
    if (file === RUNNERS) {
      const reached = new Set([local]);
      const queue = [local];
      while (queue.length > 0) {
        for (const held of runners.reaches.get(queue.pop()) ?? []) {
          if (runners.reaches.has(held) && !reached.has(held)) {
            reached.add(held);
            queue.push(held);
          }
        }
      }
      found.push(...GUARDED.filter((side) => reached.has(runnerOf(side))));
    }
    return new Set(found);
  };

  const ownModule = (file, side) => file === sideModule(side) || file === RUNNERS;

  for (const module of modules.values()) {
    const { file } = module;
    const attempt = (line, action) => {
      try {
        action();
      } catch (error) {
        report(file, line, 'the unresolved-import rule', error.message);
      }
    };

    // What each import binds, and each rule on which directories may bind a write side.
    const bindings = [];
    for (const entry of module.imports) {
      attempt(entry.line, () => {
        const from = target(file, entry.from);
        if (entry.imported !== null) bindings.push({ line: entry.line, name: entry.local, definitions: resolveExport(from, entry.imported) });
      });
    }
    for (const call of module.dynamic) {
      if (call.specifier !== null && (call.specifier.startsWith('./') || call.specifier.startsWith('../'))) {
        try {
          bindings.push({ line: call.line, name: `import(${call.argument})`, definitions: resolveExport(target(file, call.specifier), '*') });
          continue;
        } catch {
          // Falls through to the refusal below, which names what could not be resolved.
        }
      }
      if (file === CONFIG_LOAD.file && call.argument === CONFIG_LOAD.argument) {
        exempt.push({ file, line: call.line });
        continue;
      }
      report(file, call.line, 'the dynamic-import rule', `\`import(${call.argument})\` resolves to no module under src/ this test can read, so what it binds is unknown`);
    }
    const handedOn = [];
    for (const [name, entry] of module.exported) {
      attempt(entry.line, () => {
        const definitions = entry.from !== undefined ? resolveExport(target(file, entry.from), entry.imported) : resolveLocal(file, entry.local);
        if (entry.from !== undefined) bindings.push({ line: entry.line, name, definitions });
        handedOn.push({ line: entry.line, name, definitions: definitions.filter((definition) => definition.file !== file) });
      });
    }
    for (const star of module.stars) {
      attempt(star.line, () => {
        const definitions = resolveExport(target(file, star.from), '*');
        bindings.push({ line: star.line, name: '*', definitions });
        handedOn.push({ line: star.line, name: '*', definitions });
      });
    }

    for (const { line, name, definitions } of bindings) {
      const sides = new Set(definitions.flatMap((definition) => [...sidesOf(definition)]));
      for (const { rule, sides: ruled, barred, says } of IMPORTERS) {
        for (const side of ruled) {
          if (sides.has(side) && barred(file) && !ownModule(file, side)) report(file, line, rule, `it imports \`${name}\`, which is the ${side} side's, and ${says}`);
        }
      }
    }
    for (const { line, name, definitions } of handedOn) {
      const sides = new Set(definitions.flatMap((definition) => [...sidesOf(definition)]));
      for (const side of GUARDED) {
        if (sides.has(side) && !ownModule(file, side)) report(file, line, 'the re-export rule', `it hands on \`${name}\`, which is the ${side} side's, so a module barred from that side could import it from here`);
      }
    }

    // What each layer may touch in code: its names and its fixed strings, never its comments.
    for (const { rule, directory, names, says } of NAMES) {
      if (!file.startsWith(directory)) continue;
      for (const { value, line } of [...module.names, ...module.strings]) {
        if (names.includes(value)) report(file, line, rule, `it names \`${value}\`, and ${says}`);
      }
    }
    if (file.startsWith('src/scheduling/')) {
      for (const line of priorityReads(module.program)) report(file, line, 'rule 3', 'it reads `board.priority` from the config, which L0 reads and hands L3 as each item\'s rank');
    }

    // A loader the import graph cannot follow binds something nobody can name.
    for (const { value, line } of module.names) {
      if (LOADERS.includes(value)) report(file, line, 'the dynamic-import rule', `it names \`${value}\`, which loads a module this test cannot follow, so what it binds is unknown`);
    }

    // Who may spawn a process, and who may name the forge's command.
    if (!SPAWNERS.includes(file)) {
      for (const entry of [...module.imports, ...[...module.exported.values()].filter((held) => held.from !== undefined), ...module.stars]) {
        if (CHILD_PROCESS.includes(entry.from)) report(file, entry.line, 'rule 7', `it imports \`${entry.from}\`, which only the forge runners, doctor.mjs and init.mjs may`);
      }
    }
    if (file !== RUNNERS) {
      for (const { value, line } of module.strings) {
        if (value === 'gh') report(file, line, 'rule 7', 'it holds `gh` as a fixed string, and only the forge runners name the forge\'s command');
      }
    }
  }
  return { violations, exempt };
}
