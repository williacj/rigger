// ABOUTME: Extracts the ordered event and activity-type pairs the gate workflow declares.
import { parseWorkflow } from './ci-policy-fixtures.mjs';

export function gateEventPairs(workflow) {
  return Object.entries(parseWorkflow(workflow).on)
    .flatMap(([event, { types }]) => {
      if (!Array.isArray(types)) throw new Error(`${event}.types must be a sequence`);
      return types.map((type) => [event, type]);
    });
}
