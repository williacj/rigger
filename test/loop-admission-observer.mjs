// ABOUTME: Observes original admission results on one loop import edge, leaving producers and suite guards unchanged.

import { registerHooks } from 'node:module';
import { admission as actualAdmission } from '../src/scheduling/admission.mjs';

let nextToken = 0;
const invocations = new Map();

/** Runs use with an unmodified loop and private admission histories, releasing both on completion. */
export async function withObservedAdmission(use) {
  const token = ++nextToken;
  const captures = new Map();
  invocations.set(token, captures);
  const observedLoopURL = new URL('../src/scheduling/loop.mjs', import.meta.url);
  observedLoopURL.search = `?admission-observer=${token}`;
  const actualURL = new URL('../src/scheduling/admission.mjs', import.meta.url).href;
  const source = `import { admissionForObservation } from ${JSON.stringify(import.meta.url)};
export { admissionPath, admissions } from ${JSON.stringify(actualURL)};
export const admission = (options) => admissionForObservation(${token}, options);
`;
  const observerModuleURL = `data:text/javascript,${encodeURIComponent(source)}`;
  try {
    const hook = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL === observedLoopURL.href && specifier === './admission.mjs') {
          return { url: observerModuleURL, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
    });
    let observed;
    try { observed = await import(observedLoopURL.href); }
    finally { hook.deregister(); }
    return await use(observed.loop, captures);
  } finally {
    captures.clear();
    invocations.delete(token);
  }
}

/** The in-memory bridge delegates each admitted operation once, preserving even the returned Promise. */
export function admissionForObservation(token, options) {
  const captures = invocations.get(token);
  if (captures === undefined) throw new Error('the admission observation has ended');
  const actual = actualAdmission(options);
  let history = captures.get(options.directory);
  if (history === undefined) {
    history = { calls: [] };
    captures.set(options.directory, history);
  }
  const observed = { ...actual };
  for (const method of ['read', 'rename', 'open']) {
    observed[method] = (...args) => {
      const call = { method, ordinal: history.calls.length + 1, args };
      history.calls.push(call);
      try {
        const result = Reflect.apply(actual[method], actual, args);
        call.returned = result;
        if (result instanceof Promise) {
          result.then((value) => { call.value = value; }, (reason) => { call.reason = reason; });
        } else call.value = result;
        return result;
      } catch (reason) {
        call.reason = reason;
        throw reason;
      }
    };
  }
  return observed;
}
