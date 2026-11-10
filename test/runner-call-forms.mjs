// ABOUTME: The matrix of module sources the test scanner must read: each places runner calls in a
// statement, block, expression, function body or binding scope, with the tests node:test registers.

const header = "import { test, it, describe, suite } from 'node:test';\nimport check from 'node:test';\n";
const body = '() => {}';

// A call form: how the runner is called, and the title the call registers. A form the scanner
// cannot name is still a registered test, so the scanner must list it as unidentified.
export const CALLS = [
  ['test', `test('t', ${body})`],
  ['it', `it('t', ${body})`],
  ['describe', `describe('t', ${body})`],
  ['suite', `suite('t', ${body})`],
  ['default import', `check('t', ${body})`],
  ['skip member', `test.skip('t', ${body})`],
  ['only member', `it.only('t', ${body})`],
  ['todo member', `describe.todo('t', ${body})`],
  ['computed only member', `test['only']('t', ${body})`],
  ['computed skip member', `suite["skip"]('t', ${body})`],
  ['comma-expression callee', `(0, test)('t', ${body})`, { identified: false }],
  ['parenthesised member callee', `(test.skip)('t', ${body})`, { identified: false }],
  ['tagged template', 'test`t`', { identified: false, title: '<anonymous>' }],
  ['array-held callee', `[test][0]('t', ${body})`, { identified: false }],
  ['call member', `test.call(null, 't', ${body})`, { identified: false }],
];

// A place for a call that node:test reaches while the module evaluates, so the call registers its
// test. `CALL` marks the call. Each is valid module source when CALL is a call expression.
export const REACHED = [
  ['a statement', 'CALL;'],
  ['a statement ended by a line break', 'CALL\n'],
  ['an awaited statement', 'await CALL;'],
  ['a bare block', '{ CALL; }'],
  ['a bare block after an import with no semicolon', '{ CALL }', { header: "import { test, it, describe, suite } from 'node:test'\nimport check from 'node:test'\n" }],
  ['a bare block after a call with no semicolon', 'const noop = () => {}\nnoop()\n{ CALL }'],
  ['a bare block after a declaration with no semicolon', 'const value = 1\n{ CALL }'],
  ['a labelled block', 'registration: { CALL; }'],
  ['an if block', 'if (true) { CALL; }'],
  ['an if statement with no block', 'if (true) CALL;'],
  ['an else block', 'if (false) {} else { CALL; }'],
  ['a for block', 'for (let i = 0; i < 1; i++) { CALL; }'],
  ['a for-of block', 'for (const value of [0]) { CALL; }'],
  ['a for-await block', 'for await (const value of [0]) { CALL; }'],
  ['a while block', 'let once = true;\nwhile (once) { once = false; CALL; }'],
  ['a do-while block', 'do { CALL; } while (false);'],
  ['a try block', 'try { CALL; } catch {}'],
  ['a catch block', 'try { throw new Error(); } catch (error) { CALL; }'],
  ['a finally block', 'try {} finally { CALL; }'],
  ['a switch case', 'switch (1) { case 1: { CALL; } }'],
  ['an array element', 'const calls = [CALL];'],
  ['an object property value', 'const calls = { first: CALL };'],
  ['a template substitution', 'const text = `${CALL}`;'],
  ['a parenthesised expression', 'void (CALL);'],
  ['a declaration initialiser', 'export const registered = CALL;'],
  ['a block nested in a block', '{ { CALL; } }'],
  ['a static class field', 'class Holder { static registered = CALL; }'],
  ['a static class block', 'class Holder { static { CALL; } }'],
  ['a computed class member key', 'class Holder { [CALL]() {} }'],
];

// A place for a call that the module's evaluation does not reach on its own: a function body,
// however written. A call there is no identified test; it is an unidentified runner reference.
export const DEFERRED = [
  ['a function declaration body', 'function later() { CALL; }'],
  ['a function expression body', 'const later = function () { CALL; };'],
  ['an arrow block body', 'const later = () => { CALL; };'],
  ['a concise arrow body', 'const later = () => CALL;'],
  ['a concise arrow body ended by a line break', 'const later = () => CALL\nconst after = 1;'],
  ['a concise async arrow body', 'const later = async (value) => CALL;'],
  ['an object method body', 'const holder = { later() { CALL; } };'],
  ['an object getter body', 'const holder = { get later() { return CALL; } };'],
  ['a class method body', 'class Holder { later() { CALL; } }'],
  ['a function in a block', '{ function later() { CALL; } }'],
  ['a function declared after a call with no semicolon', 'const noop = () => {}\nnoop()\nfunction later() { CALL }'],
  ['an arrow parameter default', 'const later = (value = CALL) => {};'],
  ['an async arrow parameter default', 'const later = async (value = CALL) => 1;'],
  ['a function parameter default', 'function later(value = CALL) {}'],
  ['an object method parameter default', 'const holder = { later(value = CALL) {} };'],
  ['a class method parameter default', 'class Holder { later(value = CALL) {} }'],
  ['a class instance field', 'class Holder { later = CALL; }'],
  ['a class instance field ended by a line break', 'class Holder {\n  later = CALL\n  other = 1\n}'],
];

// A binding that hides the runner's name inside a block, so a call there reaches no runner. The
// scan reads no scopes, so it lists these rather than staying silent: a false refusal fails closed.
export const SHADOWED = [
  ['a block const', '{ const test = () => {}; CALL; }'],
  ['a block let', '{ let test = () => {}; CALL; }'],
  ['a block function', '{ function test() {} CALL; }'],
  ['a block class', '{ class test {} try { CALL; } catch {} }'],
  ['a destructured block const', '{ const { test } = { test: () => {} }; CALL; }'],
  ['a renamed destructured block const', '{ const { other: test } = { other: () => {} }; CALL; }'],
  ['a for-of head', 'for (const test of [() => {}]) { CALL; }'],
  ['a catch parameter', 'try { throw () => {}; } catch (test) { CALL; }'],
  ['an enclosing block', '{ const test = () => {}; { CALL; } }'],
];

// Bindings that leave the runner's name alone, so the call still registers its test.
export const UNSHADOWED = [
  // The block's own declaration of the name is listed, with no scope analysis.
  ['a sibling block', '{ const test = () => {}; }\nCALL;', { references: 1 }],
  ['a destructured key that binds another name', '{ const { test: other } = { test: () => {} }; CALL; }'],
  // The default reads the runner without calling it, so the scan lists it as unidentified too.
  ['a default inside a pattern', '{ const { other = test } = {}; CALL; }', { references: 1 }],
];


// Module sources from the round-2 attack on #1294, each registering the tests listed. The scan must
// leave none of them silent: each is identified by its title or covered by an unidentified entry.
export const COVERED = [
  ["a default export imported by name", "import { default as t } from 'node:test';\nt('default-as', () => {});\n", ["default-as"]],
  ["a string import name carrying an escape", "import { 'te\\u0073t' as t } from 'node:test';\nt('string-escape-name', () => {});\n", ["string-escape-name"]],
  ["an identifier escape in the call", "import { test } from 'node:test';\nt\\u0065st('ident-escape-call', () => {});\n", ["ident-escape-call"]],
  ["an identifier escape in the local name", "import { test as \\u0074 } from 'node:test';\nt('ident-escape-import', () => {});\n", ["ident-escape-import"]],
  ["a static field read by a static block", "import { test } from 'node:test';\nclass H { static t = test; static { this.t('static-this', () => {}); } }\n", ["static-this"]],
  ["an identifier escape in a default import", "import \\u0074 from 'node:test';\nt('ident-escape-default', () => {});\n", ["ident-escape-default"]],
  ["a static field holding the runner", "import { test } from 'node:test';\nclass H { static t = test; }\nH.t('static-field', () => {});\n", ["static-field"]],
  ["a block whose arrow declares the same name", "import { test } from 'node:test';\n{\n  const f = () => { const test = 1; return test; };\n  test('arrow-local-hides-outer', () => {});\n}\n", ["arrow-local-hides-outer"]],
  ["a named function expression of the same name", "import { test } from 'node:test';\n{\n  void function test() {};\n  test('named-fn-expression-hides', () => {});\n}\n", ["named-fn-expression-hides"]],
  ["an object key spelled as a keyword", "import { test } from 'node:test';\nconst o = { const: test };\no.const('const-key', () => {});\n", ["const-key"]],
  ["a namespace import, by member, computed member and destructuring", "import * as nt from 'node:test';\nnt.test('ns-test', () => {});\nnt['it']('ns-it', () => {});\nconst { describe: d } = nt;\nd('ns-destructured', () => {});\n", ["ns-test", "ns-it", "ns-destructured"]],
  ["a default import's suite and test members", "import t from 'node:test';\nt.describe('default-describe-member', () => {});\nt.test('default-test-member', () => {});\n", ["default-describe-member", "default-test-member"]],
  ["the runner passed to the mock", "import { test, mock } from 'node:test';\nmock.fn(test)('via-mock', () => {});\n", ["via-mock"]],
  ["a member passed through the runner's mock", "import { test } from 'node:test';\ntest.mock.fn(test.skip)('via-hook-chain', () => {});\n", ["via-hook-chain"]],
  ["a runner passed through its own mock", "import { it } from 'node:test';\nit.mock.fn(it)('mock-of-it', () => {});\n", ["mock-of-it"]],
  ["a block holding a function whose parameter has the same name", "import { test } from 'node:test';\nif (true) {\n  function helper(test) { return test; }\n  test('fn-decl-param-or-body', () => {});\n}\n", ["fn-decl-param-or-body"]],
  ["a loop block holding a function whose body declares the same name", "import { test } from 'node:test';\nfor (const x of [1]) {\n  function helper() { let test; return test; }\n  test('fn-body-let-hides-outer-block', () => {});\n}\n", ["fn-body-let-hides-outer-block"]],
  ["a static field ended by a line break", "import { test } from 'node:test';\nclass H {\n  static t = test\n}\nH.t('static-field-newline', () => {});\n", ["static-field-newline"]],
  ["a class expression of the same name", "import { test } from 'node:test';\n{\n  [class test {}];\n  test('class-expr-hides', () => {});\n}\n", ["class-expr-hides"]],
  ["an object value holding the runner", "import { test } from 'node:test';\nconst holder = { t: test };\nholder.t('object-value', () => {});\n", ["object-value"]],
  ["a specifier carrying a unicode escape", "import { test } from \"node:t\\u0065st\";\ntest(\"specifier-escape\", () => {});\n", ["specifier-escape"]],
  ["a specifier carrying a hex escape", "import test from \"node\\x3atest\";\ntest(\"specifier-hex-escape\", () => {});\n", ["specifier-hex-escape"]],
];

/** One module source: the header, then the place with the call written into it. */
export function source(place, call, { header: own } = {}) {
  return (own ?? header) + place.replace('CALL', call) + '\n';
}

/**
 * Every case of the matrix: its group, its name, its source, whether the scanner must name its
 * test rather than list it as unidentified, how many other references to the runner it reads, and the titles of the top-level tests node:test
 * registers from it. A call the scanner may refuse to name instead is still a registered test.
 */
export function cases() {
  const all = [];
  for (const [where, place, options] of REACHED) {
    for (const [how, call, { identified = true, title = 't' } = {}] of CALLS) {
      all.push({ group: 'reached', name: `${how} in ${where}`, source: source(place, call, options), registers: [title], identified });
    }
  }
  for (const [where, place] of DEFERRED) {
    // A reference in a function body is listed, with no reasoning about whether the body runs.
    for (const [how, call] of CALLS) all.push({ group: 'deferred', name: `${how} in ${where}`, source: source(place, call), registers: [], identified: true, references: 1 });
  }
  for (const [where, place] of SHADOWED) {
    all.push({ group: 'shadowed', name: `a shadowed test in ${where}`, source: source(place, `test('t', ${body})`), registers: [], identified: true });
  }
  for (const [where, text, registers] of COVERED) {
    all.push({ group: 'covered', name: `the attack's module with ${where}`, source: text, registers, identified: false });
  }
  for (const [where, place, { references = 0 } = {}] of UNSHADOWED) {
    all.push({ group: 'unshadowed', name: `an unshadowed test beside ${where}`, source: source(place, `test('t', ${body})`), registers: ['t'], identified: true, references });
  }
  return all;
}
