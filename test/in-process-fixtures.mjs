// ABOUTME: Supplies callable fixture answers without starting executable stand-ins.

import { fixedAnswer } from './stub-gh.mjs';

export function fixedCommand(options) {
  const answer = fixedAnswer(options);
  const calls = [];
  return {
    run: async (args) => {
      calls.push([...args]);
      return { ...answer };
    },
    calls: () => calls.map((args) => [...args]),
  };
}
