// ABOUTME: Tests admission of Table O's minimal config and each isolated optional-key absence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/config/validate.mjs';
import { absentConfig, atPath, fullConfig, minimalConfig, optionalCases } from './optional-config.mjs';

// SHAPES and ARCHITECTURE.md, Extension points: an absent capability is an admitted state.
// proves R-OPTION-1
test('Table O validator admits the minimal config with every optional key absent', () => {
  const config = minimalConfig();
  for (const [, key, path] of optionalCases) {
    const parent = atPath(config, path.slice(0, -1));
    assert.equal(parent != null && Object.hasOwn(parent, path.at(-1)), false, key + ' has no own declaration in the required-only fixture');
  }
  const before = structuredClone(config);
  assert.deepEqual(validate(config), [], 'the required-only config is admitted');
  assert.deepEqual(config, before, 'admission does not insert optional declarations');
});

// Table O's cited SHAPES comments and ARCHITECTURE.md, Extension points, fix these absences.
// proves R-OPTION-1
test('Table O validator admits the full config with each optional key absent alone', () => {
  assert.deepEqual(validate(fullConfig()), [], 'the full fixture is admitted before any deletion');
  for (const [row, key, path] of optionalCases) {
    const config = absentConfig(key);
    assert.equal(Object.hasOwn(atPath(config, path.slice(0, -1)), path.at(-1)), false, row + ': ' + key + ' has no own declaration');
    if (key === 'provisioning') assert.equal(Object.hasOwn(config.kinds.change, 'provisioning'), false,
      'O4 also removes the kind reference to the absent step');
    const before = structuredClone(config);
    assert.deepEqual(validate(config), [], row + ': full config without ' + key);
    assert.deepEqual(config, before, row + ': validation preserves the supplied declarations');
  }
});
