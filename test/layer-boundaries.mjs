// ABOUTME: Reads every module under src/ as syntax and reports each boundary it crosses: the forge
// adapter's sides a directory may not import, the facts a layer may not touch, and what may spawn.

import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokensIn } from '../scripts/build-test-matrix.mjs';

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

/** The names a layer may not touch in code, as a word or as a string, and the rule barring each. */
const NAMES = [
  { rule: 'rule 2', directory: 'src/scheduling/', names: ['kinds', 'labels', 'body'], says: 'L3 never reads kinds, a card\'s labels or a card\'s body' },
  { rule: 'rule 4', directory: 'src/cli/', names: ['concurrency'], says: 'the CLI never reads concurrency; L3 reads N from the config it is handed' },
];

/** The modules that may import `node:child_process`: the runners, and two local tool probes. */
const SPAWNERS = [RUNNERS, 'src/cli/doctor.mjs', 'src/cli/init.mjs'];
const CHILD_PROCESS = ['node:child_process', 'child_process'];

/** The one dynamic import allowed an unresolvable specifier: doctor's load of the consumer's config. */
const CONFIG_LOAD = { file: 'src/cli/doctor.mjs', argument: 'pathToFileURL ( path )' };

/** The loaders besides `import()` that bind a module at run time, out of the import graph's sight. */
const LOADERS = ['createRequire', 'getBuiltinModule'];

/** The single-character escapes a quoted run may carry, decoded. */
const ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' };

/** A quoted run's value, from the text between its quotes as the source wrote it. */
const decoded = (raw) => raw.replace(
  /\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|(\r\n|[\n\r\u2028\u2029])|([\s\S]))/g,
  (_, hex, braced, unicode, continued, single) => {
    if (continued) return '';
    if (single) return ESCAPES[single] ?? single;
    return String.fromCodePoint(parseInt(hex ?? braced ?? unicode, 16));
  },
);

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

const isPunct = (token, value) => token?.kind === 'punct' && token.value === value;
const isWord = (token, value) => token?.kind === 'word' && (value === undefined || token.value === value);
/** A token's value as code reads it: a word as written, a string decoded, anything else nothing. */
const valueOf = (token) => {
  if (token?.kind === 'word') return token.value;
  if (token?.kind === 'string') return decoded(token.value);
  return undefined;
};

/**
 * One module read as syntax: what it imports, what it exports, its dynamic imports, and its
 * top-level declarations with the names each references. Throws, naming the file and line, on a
 * shape it cannot read, so a module it does not understand is refused rather than passed.
 */
function parsed(file, source) {
  const { tokens } = tokensIn(source, file);
  const imports = [];
  const exported = new Map();
  const stars = [];
  const dynamic = [];
  const declared = new Map();
  const carries = new Map();
  const refuse = (at, what) => {
    throw Object.assign(new Error(`${what}, which this test cannot read`), { line: tokens[at]?.line ?? '?' });
  };
  const specifierAt = (at) => {
    if (!isWord(tokens[at], 'from') || tokens[at + 1]?.kind !== 'string') refuse(at, 'an import or export with no quoted specifier');
    return decoded(tokens[at + 1].value);
  };
  // A braced list of `name` or `name as other`, from the `{` at `at`; returns the pairs and where it ends.
  const braced = (at) => {
    const pairs = [];
    let i = at + 1;
    while (!isPunct(tokens[i], '}')) {
      const name = valueOf(tokens[i]);
      if (name === undefined) refuse(i, 'a braced import or export list');
      let as = name;
      i += 1;
      if (isWord(tokens[i], 'as')) {
        as = valueOf(tokens[i + 1]);
        i += 2;
      }
      pairs.push([name, as]);
      if (isPunct(tokens[i], ',')) i += 1;
    }
    return { pairs, end: i + 1 };
  };

  // Where a top-level statement opens: after a `;`, after a block, or on a new line after a token
  // that can end an expression, which is where a source leaving its semicolons to the parser ends
  // one. A new line after an operator, or before a word that continues one, is still the statement.
  const ends = (token) => token.kind === 'string' || token.kind === 'regex' || token.kind === 'template'
    || (token.kind === 'word' && !CONTINUING.has(token.value))
    || [')', ']', '}'].some((value) => isPunct(token, value));
  const startsStatement = (i) => tokens[i].depth === 0 && isWord(tokens[i])
    && (i === 0 || isPunct(tokens[i - 1], ';') || isPunct(tokens[i - 1], '}')
      || (tokens[i - 1].endLine < tokens[i].line && ends(tokens[i - 1]) && !INFIX.has(tokens[i].value)));

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isWord(token, 'import') && isPunct(tokens[i + 1], '(') && !isPunct(tokens[i - 1], '.')) {
      const inner = [];
      let j = i + 2;
      while (!(isPunct(tokens[j], ')') && tokens[j].depth === tokens[i + 1].depth)) inner.push(tokens[j++]);
      const lone = inner.length === 1 && inner[0].kind === 'string' ? decoded(inner[0].value) : null;
      dynamic.push({ line: token.line, specifier: lone, argument: inner.map((held) => held.value ?? held.kind).join(' ') });
      continue;
    }
    if (token.depth !== 0 || !isWord(token)) continue;
    if (token.value === 'import' && !isPunct(tokens[i + 1], '.')) {
      let j = i + 1;
      if (tokens[j].kind === 'string') continue;
      const bound = [];
      if (isWord(tokens[j]) && !isWord(tokens[j], 'from')) {
        bound.push(['default', tokens[j].value]);
        j += 1;
        if (isPunct(tokens[j], ',')) j += 1;
      }
      if (isPunct(tokens[j], '*')) {
        bound.push(['*', tokens[j + 2].value]);
        j += 3;
      } else if (isPunct(tokens[j], '{')) {
        const list = braced(j);
        bound.push(...list.pairs);
        j = list.end;
      }
      const from = specifierAt(j);
      for (const [imported, local] of bound) imports.push({ local, imported, from, line: token.line });
      if (bound.length === 0) imports.push({ local: null, imported: null, from, line: token.line });
    } else if (token.value === 'export') {
      const next = tokens[i + 1];
      if (isPunct(next, '*')) {
        if (isWord(tokens[i + 2], 'as')) exported.set(valueOf(tokens[i + 3]), { from: specifierAt(i + 4), imported: '*', line: token.line });
        else stars.push({ from: specifierAt(i + 2), line: token.line });
      } else if (isPunct(next, '{')) {
        const list = braced(i + 1);
        const from = isWord(tokens[list.end], 'from') ? specifierAt(list.end) : null;
        for (const [name, as] of list.pairs) {
          exported.set(as, from ? { from, imported: name, line: token.line } : { local: name, line: token.line });
        }
      } else if (isWord(next, 'default')) {
        exported.set('default', { local: 'default', line: token.line });
      } else {
        exported.set(declaredName(tokens, i + 1, refuse), { local: declaredName(tokens, i + 1, refuse), line: token.line });
      }
    }
  }

  // Each top-level statement, read for the names it binds or assigns and what it gives them.
  const starts = tokens.map((_, i) => i).filter((i) => startsStatement(i));
  starts.forEach((start, n) => {
    const segment = tokens.slice(start, starts[n + 1] ?? tokens.length);
    if (isWord(segment[0], 'import')) return;
    const at = isWord(segment[0], 'export') ? 1 : 0;
    if (isPunct(segment[at], '{') || isPunct(segment[at], '*')) return;
    const kind = segment[at]?.value;
    let targets;
    if (kind === 'default') {
      targets = ['default'];
    } else if (['const', 'let', 'var'].includes(kind) && (isPunct(segment[at + 1], '{') || isPunct(segment[at + 1], '['))) {
      // A destructuring declaration binds every name in its pattern, and each carries what the
      // whole declaration gives, so a runner handed out through one is still reached.
      if (at === 1) refuse(start, 'an exported destructuring declaration');
      const close = segment.findIndex((held, k) => k > at + 1 && held.depth === segment[at + 1].depth);
      targets = segment.slice(at + 2, close).filter((held) => isWord(held)).map((held) => held.value);
    } else if (['async', 'function', 'class', 'const', 'let', 'var'].includes(kind)) {
      if (['const', 'let', 'var'].includes(kind) && segment.some((held) => held.depth === 0 && isPunct(held, ','))) {
        refuse(start, 'a declaration binding more than one name');
      }
      targets = [declaredName(tokens, start + at, refuse)];
    } else if (isWord(segment[0]) && ['=', '.', '['].some((value) => isPunct(segment[1], value))) {
      // An assignment gives what it assigns to the binding it writes into, a property of it included.
      targets = [segment[0].value];
    } else {
      return;
    }
    const words = segment.filter((held) => isWord(held)).map((held) => held.value);
    const values = valuesOf(segment);
    for (const target of targets) {
      declared.set(target, new Set([...(declared.get(target) ?? []), ...words]));
      carries.set(target, new Set([...(carries.get(target) ?? []), ...values].filter((name) => name !== target)));
    }
  });
  return { file, tokens, imports, exported, stars, dynamic, declared, carries };
}

/** The words that, opening a line, join it to the expression on the line before. */
const INFIX = new Set(['in', 'instanceof', 'of', 'as', 'from', 'extends']);

/** The words that, ending a line, carry the statement on to the next one. */
const CONTINUING = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw',
  'typeof', 'void', 'yield', 'extends', 'async', 'export', 'default', 'const', 'let', 'var',
  'function', 'class', 'import', 'from', 'as', 'static', 'get', 'set',
]);

/**
 * The names a statement hands on as values: every word it holds outside a function body and not
 * behind a dot. A function's body runs when it is called, and calling a side is a module's own
 * business; a value handed on is the side itself, whatever expression carries it.
 */
function valuesOf(segment) {
  const inside = new Set();
  const closeOf = (open) => {
    let close = open + 1;
    while (close < segment.length && segment[close].depth > segment[open].depth) close++;
    return close;
  };
  for (let k = 0; k < segment.length; k++) {
    const token = segment[k];
    // A body a `)` opens, which is not an `if`'s or a loop's: a function, a method, an accessor.
    if (isPunct(token, '{') && isPunct(segment[k - 1], ')') && !segment[k - 1].control) {
      for (let m = k; m <= closeOf(k); m++) inside.add(m);
    }
    // An arrow's body: its block, or its expression up to what ends it at the arrow's own depth.
    if (isPunct(token, '=') && isPunct(segment[k + 1], '>')) {
      const body = k + 2;
      if (isPunct(segment[body], '{')) {
        for (let m = body; m <= closeOf(body); m++) inside.add(m);
      } else {
        let m = body;
        while (m < segment.length && segment[m].depth >= token.depth
          && !(segment[m].depth === token.depth && [',', ';', ':'].some((value) => isPunct(segment[m], value)))) inside.add(m++);
      }
    }
  }
  return segment.filter((held, k) => isWord(held) && !inside.has(k) && !isPunct(segment[k - 1], '.')).map((held) => held.value);
}

/** The name the declaration at `at` binds, refusing a destructured or unnamed one. */
function declaredName(tokens, at, refuse) {
  let i = at;
  while (['async', 'function', 'class', 'const', 'let', 'var'].includes(tokens[i]?.value) || isPunct(tokens[i], '*')) i += 1;
  if (!isWord(tokens[i])) refuse(at, 'a declaration that binds no single name');
  return tokens[i].value;
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
    if (runners && !runners.declared.has(runnerOf(side))) throw new Error(`${RUNNERS} declares no ${runnerOf(side)}, the ${side} side's runner, so no rule over it could fail`);
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
    if (entry?.from !== undefined && entry.from !== null) return resolveExport(target(file, entry.from), entry.imported, seen);
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
   * where it is defined, or this module's own, together with every binding the name was given as
   * a value.
   */
  const resolveLocal = (file, local, seen = new Set()) => {
    const key = `${file}@${local}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const module = modules.get(file);
    const imported = module.imports.find((entry) => entry.local === local);
    if (imported) return resolveExport(target(file, imported.from), imported.imported, seen);
    const given = [...(module.carries.get(local) ?? [])]
      .filter((name) => module.carries.has(name) || module.imports.some((entry) => entry.local === name));
    return [{ file, local }, ...given.flatMap((name) => resolveLocal(file, name, seen))];
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
   * runners module every declaration from which that side's runner is reachable within the module.
   */
  const sidesOf = ({ file, local }) => {
    const found = GUARDED.filter((side) => file === sideModule(side));
    if (file === RUNNERS) {
      const reached = new Set([local]);
      const queue = [local];
      while (queue.length > 0) {
        for (const name of runners.declared.get(queue.pop()) ?? []) {
          if (runners.declared.has(name) && !reached.has(name)) {
            reached.add(name);
            queue.push(name);
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
          bindings.push({ line: call.line, name: `import(${call.specifier})`, definitions: resolveExport(target(file, call.specifier), '*') });
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
        const definitions = entry.from ? resolveExport(target(file, entry.from), entry.imported) : resolveLocal(file, entry.local);
        if (entry.from) bindings.push({ line: entry.line, name, definitions });
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

    // What each layer may touch in code: its words and strings, never its comments.
    for (const { rule, directory, names, says } of NAMES) {
      if (!file.startsWith(directory)) continue;
      for (const token of module.tokens) {
        if (names.includes(valueOf(token))) report(file, token.line, rule, `it names \`${valueOf(token)}\`, and ${says}`);
      }
    }
    if (file.startsWith('src/scheduling/')) {
      for (const line of priorityReads(module.tokens)) report(file, line, 'rule 3', 'it reads `board.priority` from the config, which L0 reads and hands L3 as each item\'s rank');
      for (const line of boardKeyReads(module.tokens)) {
        report(file, line, 'rule 3', 'it reads the `board` key, under which the config holds `board.priority`; the board\'s settings are L0\'s (`ARCHITECTURE.md`, Engine settings), and L0 hands L3 each item\'s rank');
      }
    }

    // A loader the import graph cannot follow binds something nobody can name.
    for (const token of module.tokens) {
      if (isWord(token) && LOADERS.includes(token.value)) {
        report(file, token.line, 'the dynamic-import rule', `it names \`${token.value}\`, which loads a module this test cannot follow, so what it binds is unknown`);
      }
    }

    // Who may spawn a process, and who may name the forge's command.
    if (!SPAWNERS.includes(file)) {
      for (const entry of [...module.imports, ...[...module.exported.values()].filter((held) => held.from), ...module.stars]) {
        if (CHILD_PROCESS.includes(entry.from)) report(file, entry.line, 'rule 7', `it imports \`${entry.from}\`, which only the forge runners, doctor.mjs and init.mjs may`);
      }
    }
    if (file !== RUNNERS) {
      for (const token of module.tokens) {
        if (token.kind === 'string' && decoded(token.value) === 'gh') report(file, token.line, 'rule 7', 'it holds `gh` as a string literal, and only the forge runners name the forge\'s command');
      }
    }
  }
  return { violations, exempt };
}

/**
 * The lines on which `tokens` read the key `board` off anything: as a member (`.board`,
 * `?.board`, `['board']`), or as a key in a braced pattern (`{ board }`, `{ board: b }`). Reading
 * the key at all is what rule 3 bars, because once `board` is bound to another name, which of its
 * keys is read is a question the tokens cannot answer.
 */
function boardKeyReads(tokens) {
  const lines = [];
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at];
    if (valueOf(token) !== 'board') continue;
    const member = (isWord(token) && isPunct(tokens[at - 1], '.'))
      || (token.kind === 'string' && isPunct(tokens[at - 1], '[') && isPunct(tokens[at + 1], ']'));
    let open = at - 1;
    while (open >= 0 && tokens[open].depth >= token.depth) open--;
    const keyed = isPunct(tokens[open], '{') && ['{', ','].some((value) => isPunct(tokens[at - 1], value))
      && [':', ',', '}', '='].some((value) => isPunct(tokens[at + 1], value));
    if (member || keyed) lines.push(token.line);
  }
  return lines;
}

/**
 * The lines on which `tokens` read `priority` off something named `board`: as a member
 * (`board.priority`, `board?.priority`, `board['priority']`), or by destructuring it out of
 * `board`, whether the pattern is keyed `board:` or assigned from an expression ending in `board`.
 */
function priorityReads(tokens) {
  const lines = [];
  const isBoard = (at) => valueOf(tokens[at]) === 'board' && (isWord(tokens[at]) || (isPunct(tokens[at - 1], '[') && isPunct(tokens[at + 1], ']')));
  // The index of the token naming the object a member at `at` is read from, or -1.
  const objectOf = (at) => {
    let i = at - 1;
    if (isPunct(tokens[i], '.')) i -= 1;
    else if (isPunct(tokens[i], '[') && isPunct(tokens[at + 1], ']')) i -= 1;
    else return -1;
    if (isPunct(tokens[i], '?')) i -= 1;
    return isPunct(tokens[i], ']') ? i - 1 : i;
  };
  for (let at = 0; at < tokens.length; at++) {
    if (valueOf(tokens[at]) !== 'priority') continue;
    const object = objectOf(at);
    if (object >= 0 && isBoard(object)) {
      lines.push(tokens[at].line);
      continue;
    }
    // Inside a braced pattern: find the `{` that opens it, and what the pattern is read from.
    let open = at - 1;
    while (open >= 0 && !(isPunct(tokens[open], '{') && tokens[open].depth === tokens[at].depth - 1)) open--;
    if (open < 0) continue;
    if (isPunct(tokens[open - 1], ':') && isBoard(open - 2)) {
      lines.push(tokens[at].line);
      continue;
    }
    let close = at + 1;
    while (close < tokens.length && !(isPunct(tokens[close], '}') && tokens[close].depth === tokens[open].depth)) close++;
    if (!isPunct(tokens[close + 1], '=')) continue;
    let last = close + 2;
    while (last + 1 < tokens.length && !(tokens[last + 1].depth <= tokens[open].depth && [';', ',', ')'].some((end) => isPunct(tokens[last + 1], end)))) last++;
    if (isBoard(last) || (isPunct(tokens[last], ']') && isBoard(last - 1))) lines.push(tokens[at].line);
  }
  return lines;
}
