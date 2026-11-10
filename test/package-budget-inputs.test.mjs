// ABOUTME: Checks that the package budget follows the independently supplied architecture amount.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packageBudget } from '../scripts/package-budget.mjs';

test('packageBudget follows independently supplied package amounts', () => {
  const firstArchitecture = '# Architecture fixture\n\n## Budgets\n\n| Budget | Production lines |\n|---|---|\n| L0 | 3,000 |\n| **Package** | **9,731** |\n';
  const secondArchitecture = '# Architecture fixture\n\n## Budgets\n\n| Budget | Production lines |\n|---|---|\n| L0 | 2,911 |\n| **Package** | **14,207** |\n';

  assert.equal(packageBudget(firstArchitecture), 9731);
  assert.equal(packageBudget(secondArchitecture), 14207);
});
