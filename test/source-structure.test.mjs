// ABOUTME: Exercises the finite source variants and structural faults the gate and verdict tests classify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleProgram, importBindings, verdictInputs, gateDependency, clockReads, environmentReads } from './source-structure.mjs';

// These expectations are fixed by #1357, independently of the inspected program.
const REQUIRED = [['./rule.mjs', ['kindOf', 'panelOf']]];

// A parse failure is a broken fixture, never a predicate's structural rejection.
function classified(predicate, source, expected, label) {
  moduleProgram(source);
  assert.equal(predicate(source), expected, label);
}

test('import bindings admit order, layout, quotes, whitespace and comments and reject changed relations', async (t) => {
  const cases = [
    ['named order', "import { panelOf, kindOf } from './rule.mjs';", true],
    ['multiline layout', "import {\n kindOf,\n panelOf\n} from './rule.mjs';", true],
    ['double quotes', 'import { kindOf, panelOf } from "./rule.mjs";', true],
    ['whitespace', "import{kindOf,panelOf}from'./rule.mjs';", true],
    ['token comments', "import /* source */ { kindOf, /* member */ panelOf } from /* path */ './rule.mjs';", true],
    ['missing binding', "import { kindOf } from './rule.mjs';", false],
    ['wrong module', "import { kindOf, panelOf } from './other.mjs';", false],
    ['wrong export', "import { other as kindOf, panelOf } from './rule.mjs';", false],
    ['wrong local', "import { kindOf as other, panelOf } from './rule.mjs';", false],
  ];
  for (const [label, source, expected] of cases) await t.test(label, () => classified((text) => importBindings(text, REQUIRED), source, expected, label));
});

test('verdict input keys admit either order and reject extra channels or changed defaults', async (t) => {
  const cases = [
    ['args first', '{ args = [], push } = {}', true],
    ['push first', '{ push, args = [] } = {}', true],
    ['missing args', '{ push } = {}', false],
    ['missing push', '{ args = [] } = {}', false],
    ['additional key', '{ args = [], push, yes } = {}', false],
    ['rest channel', '{ args = [], push, ...rest } = {}', false],
    ['positional channel', '{ args = [], push } = {}, other', false],
    ['missing args default', '{ args, push } = {}', false],
    ['changed args default', '{ args = [1], push } = {}', false],
    ['missing outer default', '{ args = [], push }', false],
    ['changed outer default', '{ args = [], push } = { yes: true }', false],
  ];
  for (const [label, parameters, expected] of cases) await t.test(label, () => classified(verdictInputs, `export function verdict(${parameters}) {}`, expected, label));
});

test('gate dependency admits formatting and rejects substituted or additional loaders', async (t) => {
  const cases = [
    ['single line', "import { readMarkers } from './marker.mjs';", true],
    ['multiline layout', "import {\n readMarkers\n} from './marker.mjs';", true],
    ['double quotes', 'import { readMarkers } from "./marker.mjs";', true],
    ['whitespace', "import{readMarkers}from'./marker.mjs';", true],
    ['token comments', "import /* reader */ { readMarkers } from /* dependency */ './marker.mjs';", true],
    ['missing reader', '', false],
    ['wrong export', "import { other as readMarkers } from './marker.mjs';", false],
    ['wrong source', "import { readMarkers } from './other.mjs';", false],
    ['extra dependency', "import { readMarkers } from './marker.mjs';\nimport './extra.mjs';", false],
    ['dynamic loader', "import { readMarkers } from './marker.mjs';\nconst load = () => import('./extra.mjs');", false],
    ['re-export loader', "import { readMarkers } from './marker.mjs';\nexport { other } from './extra.mjs';", false],
    ['require loader', "import { readMarkers } from './marker.mjs';\nconst load = () => require('./extra.mjs');", false],
  ];
  for (const [label, source, expected] of cases) await t.test(label, () => classified(gateDependency, source, expected, label));
});

test('clock reads ignore inert words and reject the fixed executable clock forms', async (t) => {
  const cases = [
    ['inert comment', '// Date and performance describe clocks.\nexport const fixed = 1;', false],
    ['inert string', 'export const words = "Date performance";', false],
    ['Date.now call', 'export const read = () => Date.now();', true],
    ['Date construction', 'export const read = () => new Date();', true],
    ['performance.now call', 'export const read = () => performance.now();', true],
    ['global Date.now call', 'export const read = () => globalThis.Date.now();', true],
    ['global performance.now call', 'export const read = () => globalThis.performance.now();', true],
  ];
  for (const [label, source, expected] of cases) await t.test(label, () => classified(clockReads, source, expected, label));
});

test('environment reads admit a local env binding and inert words and reject process environment channels', async (t) => {
  const cases = [
    ['given local', 'function ruling(args) { const given = { args }; return given.args; }', false],
    ['env local', 'function ruling(args) { const env = { args }; return env.args; }', false],
    ['inert comment', '// env is a local word.\nexport const fixed = 1;', false],
    ['inert string', 'export const words = "env";', false],
    ['process dotted environment', 'export const read = () => process.env.NAME;', true],
    ['process quoted environment', "export const read = () => process['env'].NAME;", true],
    ['process destructured environment', 'export const read = () => { const { env: settings } = process; return settings.NAME; };', true],
    ['process assigned environment', 'let settings; ({ env: settings } = process);', true],
    ['process quoted destructured environment', "const { 'env': settings } = process;", true],
    ['process imported environment', "import { env as settings } from 'node:process'; export const read = () => settings.NAME;", true],
  ];
  for (const [label, source, expected] of cases) await t.test(label, () => classified(environmentReads, source, expected, label));
});
