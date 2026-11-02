// ABOUTME: Finds the first matching issue above a recorded number, written by a repository writer.

import { WRITERS } from './marker.mjs';

/** Reads every number through the newest, passing over non-issues and untrusted authors. */
export async function firstAbove(k, reads, matches, active = () => true) {
  if (!active()) return undefined;
  const newest = await reads.readNewestNumber();
  for (let candidate = k + 1; candidate <= newest; candidate += 1) {
    if (!active()) return undefined;
    const issue = await reads.readIssue(candidate);
    if (issue === null || issue.author === null || !matches(issue)) continue;
    if (!active()) return undefined;
    if (WRITERS.includes(await reads.readPermission(issue.author))) return issue;
  }
  return undefined;
}
