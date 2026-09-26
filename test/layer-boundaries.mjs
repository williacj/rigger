// ABOUTME: Parses every module under src/ and reports each boundary it crosses: the forge adapter's
// sides a directory may not import, the facts a layer may not touch, what may spawn, and who may
// hold L3's dispatching entry point.

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

/**
 * L3's dispatching entry point, which no module outside src/scheduling/ may bind (rule 8; the
 * architect's ruling 5, §4): the function its module exports as `exported`, whatever that function
 * is called where it is defined. A binding holds it as a binding holds a write side: through the
 * hand-on steps the reader of what each binding holds follows, and no further.
 */
const ENTRY = { file: 'src/scheduling/loop.mjs', exported: 'loop' };

/** The modules that may import `node:child_process`: the runners, and two local tool probes. */
const SPAWNERS = [RUNNERS, 'src/cli/doctor.mjs', 'src/cli/init.mjs'];
const CHILD_PROCESS = ['node:child_process', 'child_process'];

/** The one dynamic import allowed an unresolvable specifier: doctor's load of the consumer's config. */
const CONFIG_LOAD = { file: 'src/cli/doctor.mjs', argument: 'pathToFileURL(path)' };

/**
 * The loaders besides `import()` that bind a module at run time, out of the import graph's sight,
 * refused wherever a module names one, as a name or as a string. `require` is among them however a
 * module reaches it, by that name, through a binding or as `module.require`, so this test never
 * has to follow what it loads; `process.mainModule` is a CommonJS module, holding its `require`.
 */
const LOADERS = ['createRequire', 'getBuiltinModule', 'require', 'mainModule'];

/** The built-in whose exports reach `require` by routes no name or string shows. */
const LOADER_MODULES = ['node:module', 'module'];

/**
 * A module this test cannot read as an ES module: a `.cjs` module, whose wrapper hands it
 * `require`, `module` and `arguments`, and a `package.json`, which can make the `.js` modules beside
 * it CommonJS.
 */
const isCommonJs = (file) => file.endsWith('.cjs') || posix.basename(file) === 'package.json';

/** The local name a default export that declares no name of its own is held under. */
const DEFAULT = '*default*';

/** Every module and every `package.json` under `src/`, as a map of its repository path to its source. */
export function sourceTree(root = ROOT) {
  const tree = new Map();
  for (const entry of readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !(/\.(?:m|c)?js$/.test(entry.name) || entry.name === 'package.json')) continue;
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
  const { node, mode } = unwrapCall(callee);
  return isFunction(node) ? { fn: node, mode } : null;
}

/** The callee a call runs once its comma and its `.call` or `.apply` are taken off, and `mode`. */
function unwrapCall(callee) {
  let node = callee;
  let mode = 'direct';
  for (;;) {
    if (node?.type === 'SequenceExpression') {
      node = node.expressions.at(-1);
    } else if (mode === 'direct' && node?.type === 'MemberExpression' && ['call', 'apply'].includes(keyOf(node.property, node.computed))) {
      mode = keyOf(node.property, node.computed);
      node = node.object;
    } else {
      return { node, mode };
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
      // A binding first met on this pass is a change: an assignment read earlier in the pass, as
      // to a `var` before its declaration, went past it and lands only on the next pass.
      if (!scope.vars.has(bound)) {
        scope.vars.set(bound, new Set());
        changed = true;
      }
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
   * Each name a pattern binds, with what it holds when the pattern takes `values`: the value it
   * destructures, or the default written beside it for when that value is missing.
   */
  const patternHoldings = (pattern, values, scope) => {
    switch (pattern?.type) {
      case 'Identifier': return [[pattern.name, values]];
      case 'MemberExpression': return boundBy(pattern).map((bound) => [bound, values]);
      case 'AssignmentPattern': return patternHoldings(pattern.left, [...values, ...valuesOf(pattern.right, scope)], scope);
      case 'RestElement': return patternHoldings(pattern.argument, values, scope);
      case 'ArrayPattern': return pattern.elements.flatMap((element) => patternHoldings(element, values, scope));
      case 'ObjectPattern':
        return pattern.properties.flatMap((held) => patternHoldings(held.type === 'RestElement' ? held.argument : held.value, values, scope));
      default: return [];
    }
  };
  const declarePattern = (scope, pattern, values, readIn = scope) => {
    for (const [bound, held] of patternHoldings(pattern, values, readIn)) declare(scope, [bound], held);
  };
  const assignPattern = (pattern, values, scope) => {
    for (const [bound, held] of patternHoldings(pattern, values, scope)) assign([bound], held, scope);
  };

  /**
   * What a call passes each parameter, from its argument list: one list of values per position
   * before the first spread, and `tail`, what every position from that spread on may hold. A
   * spread can land its elements at any position from its own, so all of them are given to each.
   */
  const argumentsOf = (args, scope) => {
    const first = args.findIndex((held) => held?.type === 'SpreadElement');
    const before = first === -1 ? args : args.slice(0, first);
    const from = first === -1 ? [] : args.slice(first);
    return { slots: before.map((held) => valuesOf(held, scope)), tail: from.flatMap((held) => valuesOf(held, scope)) };
  };
  /** The same passing with its first position dropped, as `.call` drops its `this`. */
  const withoutFirst = ({ slots, tail }) => (slots.length > 0 ? { slots: slots.slice(1), tail } : { slots, tail });

  /**
   * Reads a function's body in its own scope, its parameters holding what `passed` gives each
   * position (see `argumentsOf`) or their defaults, and returns that scope. A function not called
   * where it is written is read with its parameters holding nothing, so what its body writes into
   * a module binding is still seen.
   */
  const readFunction = (fn, parent, passed = { slots: [], tail: [] }) => {
    const scope = scopeFor(fn, parent, fn);
    if (!returns.has(fn)) returns.set(fn, new Set());
    if (fn.id && fn.type === 'FunctionExpression') declare(scope, [fn.id.name], []);
    const at = (i) => [...(passed.slots[i] ?? []), ...passed.tail];
    // A function's own `arguments` holds everything the call passes; an arrow has none of its own.
    if (fn.type !== 'ArrowFunctionExpression') declare(scope, ['arguments'], [...passed.slots.flat(), ...passed.tail]);
    fn.params.forEach((param, i) => {
      const given = param.type === 'RestElement' ? [...passed.slots.slice(i).flat(), ...passed.tail] : at(i);
      declarePattern(scope, param, given);
      read(param, scope);
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
        if (!called) return [...of(node.callee), ...node.arguments.flatMap(of)];
        const given = argumentsOf(node.arguments, scope);
        if (called.mode === 'direct') return invoked(called.fn, given, scope);
        if (called.mode === 'call') return invoked(called.fn, withoutFirst(given), scope);
        // `.apply` passes the elements of its second argument, laid out as a call would lay them.
        // Where a spread hides which argument is the list, every value any argument holds may land
        // at any position.
        const [self, list] = node.arguments;
        if ([self, list].some((held) => held?.type === 'SpreadElement')) return invoked(called.fn, { slots: [], tail: node.arguments.flatMap(of) }, scope);
        const applied = list?.type === 'ArrayExpression' ? argumentsOf(list.elements, scope) : { slots: [], tail: of(list) };
        return invoked(called.fn, applied, scope);
      }
      case 'TaggedTemplateExpression': {
        const called = calledFunction(node.tag);
        const expressions = node.quasi.expressions;
        if (!called) return [...of(node.tag), ...expressions.flatMap(of)];
        const given = argumentsOf(expressions, scope);
        // As a tag, `.call` takes the strings as its `this`, and `.apply` takes the first
        // substitution as its list, which may land at any position.
        if (called.mode === 'call') return invoked(called.fn, given, scope);
        if (called.mode === 'apply') return invoked(called.fn, { slots: [], tail: expressions.flatMap(of) }, scope);
        return invoked(called.fn, { slots: [[], ...given.slots], tail: given.tail }, scope);
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
        // A default export may declare no name; `ExportDefaultDeclaration` holds its value instead.
        if (node.id) declare(scope, [node.id.name], []);
        readFunction(node, scope);
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        readFunction(node, scope);
        return;
      case 'ClassDeclaration':
        if (node.id) declare(scope, [node.id.name], valuesOf(node, scope));
        break;
      case 'VariableDeclaration':
        for (const each of node.declarations) {
          declarePattern(node.kind === 'var' ? functionScope(scope) : scope, each.id, valuesOf(each.init, scope), scope);
          read(each.id, scope);
          read(each.init, scope);
        }
        return;
      case 'ExportDefaultDeclaration':
        if (!node.declaration.id) declare(moduleScope, [DEFAULT], valuesOf(node.declaration, scope));
        break;
      case 'CatchClause': {
        // What is thrown is a review finding, so the parameter holds only its pattern's defaults.
        const inner = scopeFor(node, scope, null);
        declarePattern(inner, node.param, []);
        for (const child of childrenOf(node)) read(child, inner);
        return;
      }
      case 'ReturnStatement': {
        const fn = functionScope(scope).fn;
        if (fn && node.argument) addAll(returns.get(fn), valuesOf(node.argument, scope));
        break;
      }
      case 'AssignmentExpression':
        assignPattern(node.left, valuesOf(node.right, scope), scope);
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
  // What a binding holds only grows, and only from the module's own names and specifiers, so the
  // passes end: the last one is the pass in which nothing grew.
  do {
    changed = false;
    for (const statement of program.body) read(statement, moduleScope);
  } while (changed);
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
  // The keys an object literal or a class defines, which name a member and read no value: a plain
  // name, or a string in brackets. A computed key of any other kind is an expression, read as one.
  // A walk meets the literal or the class member before its key, so each key is known when met.
  const keys = new Set();
  const defines = (held) => (!held.computed || held.key.type === 'Literal') && keys.add(held.key);
  walk(program, (node) => {
    if (node.type === 'ObjectExpression') node.properties.forEach((held) => held.type === 'Property' && defines(held));
    if (node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') defines(node);
    if (node.type === 'ImportExpression') {
      const specifier = fixed(node.source);
      dynamic.push({ line: lineOf(node), specifier: specifier ?? null, argument: source.slice(node.source.start, node.source.end) });
    }
    const key = keys.has(node);
    if (node.type === 'Identifier') names.push({ value: node.name, line: lineOf(node), key });
    const value = fixed(node);
    if (value !== undefined) strings.push({ value, line: lineOf(node), key });
  });
  return { file, program, imports, exported, stars, dynamic, reaches, carries, topLevel, names, strings };
}

/** The statements that run their body again, so a definition in one may run after anything. */
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

/**
 * What each call in a module can run, read by lexical scope and by the values that reach the call.
 *
 * A name resolves to the binding its scope reaches, shadowing and hoisting included. A binding
 * holds what each of its definitions gives it: a declaration, or an assignment anywhere. A value is
 * a function, a class, an object literal, or an instance a `new` builds, which the `new` names so a
 * write to one instance reaches no other. A member read takes the member from each value its
 * receiver can hold:
 * - an object's property, or a function assigned to it;
 * - an instance's own property assigned through it, and its class's method or field;
 * - a class's static member, with what is assigned to it;
 * - failing a class's own, the same member of the class it extends.
 *
 * `this` holds its own object, or its class and every subclass that can have an instance: one the
 * module builds or hands on, since that subclass's instance may run a base class's method. `super`
 * holds the class extended, and reads its methods only.
 *
 * Every definition that can reach the call is kept, so where the reader cannot tell which runs, it
 * reads them all. The one it drops is a definition an unconditional replacement overwrote first:
 * - the replacement is an assignment statement written after it, whose receiver, if any, is one
 *   object that runs once, not one of several or one of many a loop builds;
 * - the definition has run for good before the replacement can: both in one function, or the
 *   definition in module code outside a loop and the replacement in a function expression after it;
 * - the call is written after the replacement in its block, with no hoisted function declaration
 *   between the block and the call.
 *
 * A parameter, an import, a global, a call's result and any receiver the module does not define
 * hold nothing this reader can see. Returns the lookup: the functions the callee `node` can run.
 */
function callables(program) {
  const scopeOf = new Map();
  const parentOf = new Map();
  const newScope = (parent, fn) => ({ parent, fn, names: new Map() });
  const moduleScope = newScope(null, true);
  const declare = (scope, name) => {
    if (!scope.names.has(name)) scope.names.set(name, []);
    return scope.names.get(name);
  };
  const functionScope = (scope) => (scope.fn ? scope : functionScope(scope.parent));
  const lookup = (name, scope) => {
    if (!scope) return null;
    return scope.names.has(name) ? scope.names.get(name) : lookup(name, scope.parent);
  };
  const classes = [];
  const memberWrites = [];
  const nameWrites = [];
  const identifiers = [];

  // Every node is given the scope it is read in, and every declaration its binding, before any
  // callee is resolved, so a declaration later in its scope is already there: hoisting.
  const visit = (node, scope, parent) => {
    if (!node || typeof node.type !== 'string') return;
    scopeOf.set(node, scope);
    parentOf.set(node, parent);
    if (node.type === 'Identifier') identifiers.push(node);
    let inner = scope;
    if (node.type === 'FunctionDeclaration' && node.id) declare(scope, node.id.name).push({ node, value: node });
    if (node.type === 'ClassDeclaration' && node.id) declare(scope, node.id.name).push({ node, value: node });
    if (isFunction(node) || node.type === 'FunctionDeclaration') {
      inner = newScope(scope, true);
      if (node.type === 'FunctionExpression' && node.id) declare(inner, node.id.name).push({ node, value: node });
      for (const param of node.params) for (const bound of boundBy(param)) declare(inner, bound);
    } else if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
      classes.push(node);
      inner = newScope(scope, false);
      if (node.type === 'ClassExpression' && node.id) declare(inner, node.id.name).push({ node, value: node });
    } else if (node.type === 'CatchClause') {
      inner = newScope(scope, false);
      for (const bound of boundBy(node.param)) declare(inner, bound);
    } else if (BLOCKS.has(node.type)) {
      inner = newScope(scope, false);
    } else if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) declare(scope, specifier.local.name);
    } else if (node.type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? functionScope(scope) : scope;
      for (const each of node.declarations) {
        for (const bound of boundBy(each.id)) {
          const definitions = declare(target, bound);
          if (each.id.type === 'Identifier' && each.init) definitions.push({ node: each, value: each.init });
        }
      }
    } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
      nameWrites.push({ node, scope });
    } else if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
      memberWrites.push(node);
    }
    for (const child of childrenOf(node)) visit(child, inner, node);
  };
  visit(program, moduleScope, null);
  for (const { node, scope } of nameWrites) lookup(node.left.name, scope)?.push({ node, value: node.right, replaces: node.operator === '=' });

  const enclosingFunction = (node) => {
    for (let at = parentOf.get(node); at; at = parentOf.get(at)) if (isFunction(at) || at.type === 'FunctionDeclaration') return at;
    return null;
  };
  // The block a replacing assignment is a statement of, where every later statement runs after it.
  const statementBlock = (definition) => {
    if (!definition.replaces) return null;
    const statement = parentOf.get(definition.node);
    const block = statement?.type === 'ExpressionStatement' ? parentOf.get(statement) : null;
    return ['Program', 'BlockStatement', 'StaticBlock'].includes(block?.type) ? block : null;
  };
  // Whether `at` can run only once `replacement` has: it is written after it in its block, and no
  // hoisted function declaration, which could be called before the replacement, holds it.
  const runsAfter = (at, replacement, block) => {
    if (at.start < replacement.node.end || at.start < block.start || at.end > block.end) return false;
    for (let node = parentOf.get(at); node && node !== block; node = parentOf.get(node)) if (node.type === 'FunctionDeclaration') return false;
    return true;
  };
  /**
   * Whether `definition` has run, for good, before `replacement` can: both in one function, or the
   * definition in module code outside any loop, which runs once, and the replacement inside a
   * function expression written after it, which cannot run before it exists.
   */
  const settledBefore = (definition, replacement) => {
    const own = enclosingFunction(definition.node);
    if (own === enclosingFunction(replacement.node)) return true;
    if (own !== null) return false;
    for (let at = parentOf.get(definition.node); at; at = parentOf.get(at)) if (LOOPS.has(at.type)) return false;
    const around = [];
    for (let at = parentOf.get(replacement.node); at; at = parentOf.get(at)) if (isFunction(at) || at.type === 'FunctionDeclaration') around.push(at);
    return around.every((fn) => fn.type !== 'FunctionDeclaration') && around.at(-1).start >= definition.node.end;
  };
  /** The definitions that can reach `at`: all but those an unconditional replacement overwrote. */
  const reaching = (definitions, at) => definitions.filter((definition) => !definitions.some((replacement) => {
    const block = replacement === definition ? null : statementBlock(replacement);
    return block !== null && definition.node.end <= replacement.node.start
      && settledBefore(definition, replacement) && runsAfter(at, replacement, block);
  }));

  /** The object literal or class `this` is in at `node`, and whether it is the class's static side. */
  const thisAt = (node) => {
    for (let at = node, from = null; at; from = at, at = parentOf.get(at)) {
      if (at.type === 'PropertyDefinition' && from === at.value) return { object: parentOf.get(parentOf.get(at)), statics: Boolean(at.static) };
      if (at.type === 'StaticBlock') return { object: parentOf.get(parentOf.get(at)), statics: true };
      if (at.type === 'FunctionExpression' || at.type === 'FunctionDeclaration') {
        const holder = parentOf.get(at);
        if (holder?.type === 'MethodDefinition') return { object: parentOf.get(parentOf.get(holder)), statics: Boolean(holder.static) };
        if (holder?.type === 'Property' && parentOf.get(holder)?.type === 'ObjectExpression') return { object: parentOf.get(holder), statics: false };
        return null;
      }
    }
    return null;
  };

  const pending = new Set();
  const superclasses = (klass) => (klass.superClass ? valuesOf(klass.superClass).filter((value) => value.kind === 'class').map((value) => value.node) : []);
  const subclasses = (klass, seen = new Set([klass])) => classes
    .filter((other) => !seen.has(other) && superclasses(other).includes(klass))
    .flatMap((other) => {
      seen.add(other);
      return [other, ...subclasses(other, seen)];
    });
  /**
   * Whether an instance of `klass` can exist for a base class's method to run on: the module builds
   * one or hands the class on. A class the module names only in its declaration and in another
   * class's `extends` has no instance; any other mention, an export included, may make one.
   */
  const instantiable = (klass) => {
    const holder = parentOf.get(klass);
    let name;
    if (klass.type === 'ClassDeclaration' && klass.id && !holder?.type.startsWith('Export')) name = klass.id.name;
    else if (holder?.type === 'VariableDeclarator' && holder.init === klass && holder.id.type === 'Identifier') name = holder.id.name;
    else return true;
    const binding = lookup(name, scopeOf.get(klass));
    return identifiers.some((node) => {
      if (node.name !== name || lookup(name, scopeOf.get(node)) !== binding) return false;
      const parent = parentOf.get(node);
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
      if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && parent.key === node && !parent.computed) return false;
      if ((parent?.type === 'ClassDeclaration' || parent?.type === 'ClassExpression') && (parent.id === node || parent.superClass === node)) return false;
      return !(parent?.type === 'VariableDeclarator' && parent.id === node);
    });
  };

  /**
   * An instance is `{ kind: 'instance', node: its class, site }`. `site` is the `new` that built it,
   * so a write to one instance reaches that instance alone. It is null for `this`, which may be any
   * instance, and 'prototype' for `super`, which reads the class's methods and never an instance's.
   */
  const side = (klasses, statics, site = null) => klasses.map((node) => (statics ? { kind: 'class', node } : { kind: 'instance', node, site }));
  const same = (a, b) => a.kind === b.kind && a.node === b.node
    && (a.kind !== 'instance' || a.site === null || b.site === null || a.site === b.site);
  const distinct = (values) => values.filter((value, i) => values.findIndex((other) => other.kind === value.kind && other.node === value.node && other.site === value.site) === i);

  /** Whether `node` sits in a loop of its own function, so it may run many times in one call. */
  const inLoop = (node) => {
    for (let at = parentOf.get(node); at && !isFunction(at) && at.type !== 'FunctionDeclaration'; at = parentOf.get(at)) if (LOOPS.has(at.type)) return true;
    return false;
  };
  /**
   * Whether `value` is one object: an object literal or a `new` that runs once in its function,
   * rather than any instance or one of many built by the same expression.
   */
  const single = (value) => {
    if (value.kind === 'object' || value.kind === 'class') return !inLoop(value.node);
    return value.kind === 'instance' && typeof value.site === 'object' && value.site !== null && !inLoop(value.site);
  };
  /**
   * The writes to `key` on `value`. Each replaces what came before it only where its receiver can be
   * one object and nothing else; a receiver that may be one of several, any instance, or one of
   * the objects a loop builds adds a definition and replaces none.
   */
  const writesTo = (value, key) => memberWrites
    .filter((write) => keyOf(write.left.property, write.left.computed) === key)
    .flatMap((write) => {
      const receivers = distinct(valuesOf(write.left.object));
      if (!receivers.some((held) => same(held, value))) return [];
      const definite = receivers.length === 1 && single(receivers[0]);
      return [{ node: write, value: write.right, replaces: definite && write.operator === '=' }];
    });
  /** The members `klass` itself writes under `key`, on its static side or its prototype. */
  const classMembers = (klass, key, statics) => klass.body.body
    .filter((member) => member.kind !== 'constructor' && member.kind !== 'get' && member.kind !== 'set' && member.value)
    .filter((member) => Boolean(member.static) === statics && keyOf(member.key, member.computed) === key)
    .map((member) => ({ node: member, value: member.value }));
  /**
   * The definitions a member read of `key` from `value` can meet: an object's property and what is
   * assigned to it; an instance's own properties, then its class's prototype; a class's static
   * members and what is assigned to them. A class that defines nothing under `key` passes the read
   * to the class it extends.
   */
  const memberDefinitions = (value, key) => {
    if (value.kind === 'object') {
      const written = value.node.properties.filter((held) => held.type === 'Property' && keyOf(held.key, held.computed) === key);
      return [...written.map((held) => ({ node: held, value: held.value })), ...writesTo(value, key)];
    }
    if (value.kind !== 'class' && value.kind !== 'instance') return [];
    const statics = value.kind === 'class';
    const own = statics || value.site === 'prototype' ? [] : writesTo(value, key);
    // A chain of classes that extends itself never runs, and reads as holding nothing more.
    const seen = new Set();
    for (let level = [value.node]; level.length > 0; level = level.flatMap(superclasses).filter((klass) => !seen.has(klass))) {
      level.forEach((klass) => seen.add(klass));
      const here = level.flatMap((klass) => [...classMembers(klass, key, statics), ...(statics ? writesTo({ kind: 'class', node: klass }, key) : [])]);
      if (here.length > 0) return [...own, ...here];
    }
    return own;
  };
  /** What a member read of `key` from `value` can give at `at`. */
  const memberValues = (value, key, at) => reaching(memberDefinitions(value, key), at).flatMap((definition) => valuesOf(definition.value));

  // What an expression can evaluate to, through the operators Hand-ons step 7 names.
  function valuesOf(node) {
    if (!node || pending.has(node)) return [];
    pending.add(node);
    try {
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': return [{ kind: 'fn', node }];
        case 'ClassDeclaration':
        case 'ClassExpression': return [{ kind: 'class', node }];
        case 'ObjectExpression': return [{ kind: 'object', node }];
        case 'ChainExpression': return valuesOf(node.expression);
        case 'ConditionalExpression': return [...valuesOf(node.consequent), ...valuesOf(node.alternate)];
        case 'LogicalExpression': return [...valuesOf(node.left), ...valuesOf(node.right)];
        case 'AwaitExpression': return valuesOf(node.argument);
        case 'SequenceExpression': return valuesOf(node.expressions.at(-1));
        case 'AssignmentExpression': return valuesOf(node.right);
        case 'NewExpression': return side(valuesOf(node.callee).filter((value) => value.kind === 'class').map((value) => value.node), false, node);
        case 'Identifier': {
          const definitions = lookup(node.name, scopeOf.get(node));
          return definitions ? reaching(definitions, node).flatMap((definition) => valuesOf(definition.value)) : [];
        }
        case 'ThisExpression': {
          const self = thisAt(node);
          if (!self) return [];
          if (self.object.type === 'ObjectExpression') return [{ kind: 'object', node: self.object }];
          return side([self.object, ...subclasses(self.object).filter(instantiable)], self.statics);
        }
        case 'MemberExpression': {
          const key = keyOf(node.property, node.computed);
          if (key === undefined) return [];
          let receivers;
          if (node.object.type === 'Super') {
            const self = thisAt(node);
            receivers = self && self.object.type !== 'ObjectExpression' ? side(superclasses(self.object), self.statics, 'prototype') : [];
          } else {
            receivers = valuesOf(node.object);
          }
          return receivers.flatMap((value) => memberValues(value, key, node));
        }
        default: return [];
      }
    } finally {
      pending.delete(node);
    }
  }

  /** The constructor a class runs: its own, or the one it inherits. */
  const constructorsOf = (klass, seen = new Set()) => {
    if (seen.has(klass)) return [];
    seen.add(klass);
    const own = klass.body.body.filter((member) => member.kind === 'constructor').map((member) => member.value);
    return own.length > 0 ? own : superclasses(klass).flatMap((base) => constructorsOf(base, seen));
  };
  return (callee) => valuesOf(callee).flatMap((value) => {
    if (value.kind === 'fn') return [value.node];
    return value.kind === 'class' ? constructorsOf(value.node) : [];
  });
}

/**
 * The argument expressions a call gives each parameter of a function it runs, as
 * `[parameter, arguments]` pairs: one called where it is written, or one `functionsOf` (see
 * `callables`) finds the callee can run. None where the callee runs nothing the module defines.
 * An argument after a spread may land at any parameter from the spread's position on, and a rest
 * parameter is left out.
 */
function parametersGiven(node, functionsOf) {
  const tagged = node.type === 'TaggedTemplateExpression';
  const { node: callee, mode } = unwrapCall(tagged ? node.tag : node.callee);
  const fns = functionsOf(callee);
  // A tag's first argument is its strings, which no expression in the source spells.
  let args = tagged ? [null, ...node.quasi.expressions] : node.arguments;
  if (mode === 'call') args = args.slice(1);
  if (mode === 'apply') args = args[1]?.type === 'ArrayExpression' ? args[1].elements : [];
  const first = args.findIndex((held) => held?.type === 'SpreadElement');
  const spread = first === -1 ? args.length : first;
  // A spread of a list written in place hands on its elements; any other spread's are unknown.
  const after = args.slice(spread)
    .flatMap((held) => (held?.type !== 'SpreadElement' ? [held] : held.argument.type === 'ArrayExpression' ? held.argument.elements : []))
    .filter((held) => held && held.type !== 'SpreadElement');
  return fns.flatMap((fn) => fn.params
    .map((param, i) => [param, i < spread ? [args[i]] : after])
    .filter(([param]) => param.type !== 'RestElement'));
}

/**
 * The lines on which a module spells the config path `board.priority`: a member access from
 * `board` to `priority`, by `.`, `?.` or a fixed string in brackets, or a destructuring pattern
 * that takes `priority` from a `board` key or from what `board` names. What `board` names may be
 * reached through an expression whose result can be one of its operands, and a pattern takes it as
 * the value it is given, as its default, or as an argument to a function the call can run. That is
 * one called where it is written, or one `callables` finds the callee reaches through scope, a
 * binding, a member of an object, class or instance the module defines, `this` or `super`. Any
 * other use of the name `board` passes, so L3's board handle does; a read through a computed key,
 * and a call whose callee this reader cannot follow, is a review finding (the card's Rule 3 item).
 */
function priorityReads(program) {
  const lines = [];
  const functionsOf = callables(program);
  // An optional chain is the member access it wraps, so `config?.board` is read as `config.board`.
  const unchained = (node) => (node?.type === 'ChainExpression' ? node.expression : node);
  const isBoard = (wrapped) => {
    const node = unchained(wrapped);
    return (node?.type === 'Identifier' && node.name === 'board')
      || (node?.type === 'MemberExpression' && keyOf(node.property, node.computed) === 'board');
  };
  // `board`, or an expression whose result can be an operand that is: Hand-ons step 7's list.
  const namesBoard = (wrapped) => {
    const node = unchained(wrapped);
    switch (node?.type) {
      case 'ConditionalExpression': return namesBoard(node.consequent) || namesBoard(node.alternate);
      case 'LogicalExpression': return namesBoard(node.left) || namesBoard(node.right);
      case 'AwaitExpression': return namesBoard(node.argument);
      case 'SequenceExpression': return namesBoard(node.expressions.at(-1));
      default: return isBoard(node);
    }
  };
  const takesPriority = (pattern) => pattern?.type === 'ObjectPattern'
    && pattern.properties.some((held) => held.type === 'Property' && keyOf(held.key, held.computed) === 'priority');
  const unwrapped = (pattern) => (pattern?.type === 'AssignmentPattern' ? pattern.left : pattern);
  walk(program, (node) => {
    if (node.type === 'MemberExpression' && keyOf(node.property, node.computed) === 'priority' && namesBoard(node.object)) {
      lines.push(node.loc.start.line);
    }
    if (node.type === 'ObjectPattern') {
      for (const held of node.properties) {
        if (held.type === 'Property' && keyOf(held.key, held.computed) === 'board' && takesPriority(unwrapped(held.value))) lines.push(held.loc.start.line);
      }
    }
    if (node.type === 'VariableDeclarator' && takesPriority(node.id) && namesBoard(node.init)) lines.push(node.loc.start.line);
    if (node.type === 'AssignmentExpression' && takesPriority(node.left) && namesBoard(node.right)) lines.push(node.loc.start.line);
    if (node.type === 'AssignmentPattern' && takesPriority(node.left) && namesBoard(node.right)) lines.push(node.loc.start.line);
    if (['CallExpression', 'NewExpression', 'TaggedTemplateExpression'].includes(node.type)) {
      for (const [param, given] of parametersGiven(node, functionsOf)) {
        if (takesPriority(unwrapped(param)) && given.some(namesBoard)) lines.push(node.loc.start.line);
      }
    }
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
    if (isCommonJs(file)) {
      report(file, 1, 'the CommonJS rule', 'it is CommonJS or makes modules CommonJS, and this test reads ES modules only, so what it loads through `require` is unknown');
      continue;
    }
    try {
      modules.set(file, parsed(file, source));
    } catch (error) {
      report(file, error.line ?? '?', 'the unreadable-module rule', error.message);
    }
  }
  if (!tree.has(ENTRY.file)) throw new Error(`L3's dispatching entry point has no module at ${ENTRY.file}, so rule 8 could not fail`);
  if (modules.has(ENTRY.file) && !modules.get(ENTRY.file).exported.has(ENTRY.exported)) {
    throw new Error(`${ENTRY.file} exports no \`${ENTRY.exported}\`, L3's dispatching entry point, so rule 8 could not fail`);
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

  // The definitions the entry point's export resolves to. One the reader cannot resolve is already
  // refused under the unresolved-import rule, in the entry point's own module.
  let entry = [];
  try {
    if (modules.has(ENTRY.file)) entry = resolveExport(ENTRY.file, ENTRY.exported);
  } catch {
    // Reported below, where the entry point's module is read.
  }
  const isEntry = (definition) => entry.some((held) => held.file === definition.file && held.local === definition.local);

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
    if (!file.startsWith('src/scheduling/')) {
      for (const { line, name, definitions } of bindings) {
        if (definitions.some(isEntry)) report(file, line, 'rule 8', `it binds \`${name}\`, which holds L3's dispatching entry point, and only src/scheduling/ may hold it`);
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
    for (const { value, line, key } of [...module.names, ...module.strings]) {
      if (LOADERS.includes(value) && !key) report(file, line, 'the dynamic-import rule', `it names \`${value}\`, which loads a module this test cannot follow, so what it binds is unknown`);
    }
    const loaded = [...module.imports, ...[...module.exported.values()].filter((held) => held.from !== undefined), ...module.stars];
    for (const entry of loaded) {
      if (LOADER_MODULES.includes(entry.from)) report(file, entry.line, 'the dynamic-import rule', `it imports \`${entry.from}\`, whose loaders bind modules this test cannot follow`);
    }

    // Who may spawn a process, and who may name the forge's command.
    if (!SPAWNERS.includes(file)) {
      for (const entry of loaded) {
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
