#!/usr/bin/env node
// ABOUTME: The `rigger` command: the file the package declares as its bin. It reads the
// ABOUTME: arguments, writes what the surface answers, and exits with the status it gives.

import { run } from './verbs.mjs';

// Nothing guards this against being imported, because nothing imports it: what a test needs is
// `verbs.mjs`, and a guard comparing this file against `process.argv[1]` would have to resolve
// the symlink an installed bin is reached through.
const { text, code } = run(process.argv.slice(2));
(code === 0 ? console.log : console.error)(text);
process.exit(code);
