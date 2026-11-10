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
// however written. A test there is not a top-level call.
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

// A binding that hides the runner's name inside a block, so a call there reaches no runner.
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
  ['a sibling block', '{ const test = () => {}; }\nCALL;'],
  ['a destructured key that binds another name', '{ const { test: other } = { test: () => {} }; CALL; }'],
  // The default reads the runner without calling it, so the scan lists it as unidentified too.
  ['a default inside a pattern', '{ const { other = test } = {}; CALL; }', { references: 1 }],
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
    for (const [how, call] of CALLS) all.push({ group: 'deferred', name: `${how} in ${where}`, source: source(place, call), registers: [], identified: true });
  }
  for (const [where, place] of SHADOWED) {
    all.push({ group: 'shadowed', name: `a shadowed test in ${where}`, source: source(place, `test('t', ${body})`), registers: [], identified: true });
  }
  for (const [where, place, { references = 0 } = {}] of UNSHADOWED) {
    all.push({ group: 'unshadowed', name: `an unshadowed test beside ${where}`, source: source(place, `test('t', ${body})`), registers: ['t'], identified: true, references });
  }
  return all;
}
