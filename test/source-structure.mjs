// ABOUTME: Inspects the gate and verdict test contracts through parsed module syntax.

import { parse } from 'acorn';

export const moduleProgram = (source) => parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

/** The syntax nodes under `node`, `node` first. */
export function* nodesOf(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    for (const held of Array.isArray(value) ? value : [value]) if (held && typeof held === 'object') yield* nodesOf(held);
  }
}

/** Each expected module/export/local binding must remain imported. */
export function importBindings(source, expected) {
  const imports = moduleProgram(source).body.filter((node) => node.type === 'ImportDeclaration');
  return expected.every(([from, names]) => names.every((name) => imports.some((node) => node.source.value === from
    && node.specifiers.some((specifier) => specifier.type === 'ImportSpecifier'
      && specifier.imported.name === name && specifier.local.name === name))));
}

/** The verb accepts only its defaulted args and push input object. */
export function verdictInputs(source) {
  const exported = moduleProgram(source).body.find((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'verdict')?.declaration;
  const [parameter] = exported?.params ?? [];
  if (exported?.params.length !== 1 || parameter?.type !== 'AssignmentPattern'
      || parameter.left.type !== 'ObjectPattern' || parameter.right.type !== 'ObjectExpression'
      || parameter.right.properties.length !== 0) return false;
  const properties = parameter.left.properties;
  if (properties.length !== 2 || properties.some((property) => property.type !== 'Property' || property.computed)) return false;
  if (properties.map((property) => property.key.name).sort().join(',') !== 'args,push') return false;
  const args = properties.find((property) => property.key.name === 'args').value;
  const push = properties.find((property) => property.key.name === 'push').value;
  return args.type === 'AssignmentPattern' && args.left.type === 'Identifier' && args.left.name === 'args'
    && args.right.type === 'ArrayExpression' && args.right.elements.length === 0
    && push.type === 'Identifier' && push.name === 'push';
}

/** The loaders visited by the gate's existing dependency restriction. */
export function moduleLoads(source) {
  const loads = [];
  for (const node of nodesOf(moduleProgram(source))) {
    if (node.type === 'ImportDeclaration') loads.push(['import', node.source.value]);
    if (node.type === 'ImportExpression') loads.push(['dynamic import']);
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) loads.push(['re-export', node.source.value]);
    if (node.type === 'CallExpression' && (
      node.callee.name === 'require' || node.callee.name === 'createRequire' ||
      (node.callee.type === 'MemberExpression' && (node.callee.property.name === 'require' || node.callee.property.value === 'require'))
    )) loads.push(['require']);
  }
  return loads;
}

/** The gate's sole dependency is the named marker reader. */
export function gateDependency(source) {
  const loads = moduleLoads(source);
  const imports = moduleProgram(source).body.filter((node) => node.type === 'ImportDeclaration');
  return loads.length === 1 && loads[0][0] === 'import' && loads[0][1] === './marker.mjs'
    && imports[0].specifiers.length === 1
    && importBindings(source, [['./marker.mjs', ['readMarkers']]]);
}

/** Whether the gate reads a clock through the card's finite executable forms. */
export function clockReads(source) {
  for (const node of nodesOf(moduleProgram(source))) {
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Date') return true;
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || memberName(node.callee) !== 'now') continue;
    const clock = node.callee.object;
    if (clock.type === 'Identifier' && ['Date', 'performance'].includes(clock.name)) return true;
    if (clock.type === 'MemberExpression' && clock.object.type === 'Identifier' && clock.object.name === 'globalThis'
        && ['Date', 'performance'].includes(memberName(clock))) return true;
  }
  return false;
}

/** A fixed member name, whether dotted or a quoted computed property. */
function memberName(node) {
  return node.computed ? (node.property.type === 'Literal' ? node.property.value : undefined) : node.property.name;
}

/** Whether the verb reads the environment through the card's finite process forms. */
export function environmentReads(source) {
  for (const node of nodesOf(moduleProgram(source))) {
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'process'
        && memberName(node) === 'env') return true;
    const from = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentExpression' && node.operator === '=' ? node.right : undefined;
    const pattern = node.type === 'VariableDeclarator' ? node.id : node.left;
    if (from?.type === 'Identifier' && from.name === 'process' && pattern?.type === 'ObjectPattern'
        && pattern.properties.some((property) => property.type === 'Property'
          && (property.key.type === 'Literal' ? property.key.value : !property.computed && property.key.name) === 'env')) return true;
    if (node.type === 'ImportDeclaration' && node.source.value === 'node:process'
        && node.specifiers.some((specifier) => specifier.type === 'ImportSpecifier' && specifier.imported.name === 'env')) return true;
  }
  return false;
}
