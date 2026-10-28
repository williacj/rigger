// ABOUTME: Measures the repository files imported by the live gate checks and detects list drift.
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { listsOf } from './self-hosting-check.mjs';

export const ENTRIES = ['scripts/gate-check.mjs', '.github/scripts/self-hosting-check.mjs'];
/** Compare exact spans using the live check's list reader, rather than directory coverage. */
export function compare(markdown, paths) {
  const listed = listsOf(markdown);
  if (listed.problem) return [listed.problem];
  const section = markdown.split('## Self-hosting\n')[1]?.split('\n## ')[0] ?? '';
  const gate = section.match(/^- The gate's code:.*(?:\n[ \t]+\S.*)*/m)?.[0];
  if (!gate) return ['no gate-code bullet'];
  const spans = [...gate.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  return [
    ...paths.filter((path) => !listed.paths.includes(path)).map((path) => `unlisted closure file: ${path}`),
    ...spans.filter((path) => path.endsWith('.mjs') && !paths.includes(path)).map((path) => `not in closure: ${path}`),
    ...(!listed.paths.includes('src/substrate/process-table.sh') ? ['unlisted executable: src/substrate/process-table.sh'] : []),
    ...['.github/scripts/gate-closure.mjs', 'test/gate-closure.test.mjs'].flatMap((path) => [
      ...(!listed.paths.includes(path) ? [`unlisted guard: ${path}`] : []),
      ...(spans.includes(path) ? [`guard in gate-code bullet: ${path}`] : []),
    ]),
  ];
}

function walk(node, inspect) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') inspect(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, inspect));
    else if (value && typeof value === 'object') walk(value, inspect);
  }
}

/** Follow Node's exact file paths; refuse unresolved paths and paths outside this repository. */
export function measure(root, entries = ENTRIES) {
  root = realpathSync.native(root);
  const visited = new Set();
  const computed = [];
  const bare = [];
  const commonjs = [];
  function visit(path) {
    path = realpathSync.native(path);
    const file = relative(root, path);
    if (file === '..' || file.startsWith('../') || isAbsolute(file)) throw new Error(`outside repository: ${path}`);
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(path, 'utf8');
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    const requireNames = new Set(['require', 'createRequire']);
    for (const node of program.body) {
      if (node.type === 'ImportDeclaration' && node.source.value === 'node:module') {
        for (const binding of node.specifiers) {
          if (binding.imported?.name === 'createRequire') requireNames.add(binding.local.name);
        }
      }
    }
    walk(program, (node) => {
      if (node.type === 'CallExpression' && (requireNames.has(node.callee.name)
          || (node.callee.type === 'MemberExpression' && requireNames.has(node.callee.property.name ?? node.callee.property.value)))) {
        commonjs.push({ file, call: source.slice(node.start, node.end) });
      }
      if (node.type === 'ImportExpression' && typeof node.source.value !== 'string') {
        computed.push({ file, call: source.slice(node.start, node.end) });
      }
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
          && typeof node.source?.value === 'string' && !node.source.value.startsWith('node:')) {
        const specifier = node.source.value;
        if (!specifier.startsWith('./') && !specifier.startsWith('../')
            && !specifier.startsWith('/') && !specifier.startsWith('file:')) bare.push({ file, specifier });
        else {
          try { visit(fileURLToPath(new URL(specifier, pathToFileURL(path)))); }
          catch (error) { throw new Error(`${file}: ${specifier}: ${error.message}`); }
        }
      }
    });
  }
  for (const entry of entries) visit(resolve(root, entry));
  return { paths: [...visited].sort(), computed, bare, commonjs };
}

/** The CLI adapter is callable in-process by the deterministic tests. */
export function main(root, out = console.log, error = console.error) {
  try {
    const result = measure(root);
    result.paths.forEach((path) => out(path));
    for (const kind of ['computed', 'bare', 'commonjs']) {
      for (const item of result[kind]) error(`${kind}: ${item.file}: ${item.call ?? item.specifier}`);
    }
    return result.bare.length || result.commonjs.length ? 1 : 0;
  } catch (failure) { error(failure.message); return 1; }
}

if (process.argv[1] && realpathSync.native(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(fileURLToPath(new URL('../../', import.meta.url)));
}
