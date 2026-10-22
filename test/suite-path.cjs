// ABOUTME: Gives the suite guard a repository-relative identity for an existing file or pattern.

const { relative, resolve } = require('node:path');
const { realpathSync } = require('node:fs');

function testPath(name) {
  let path = resolve(name);
  try { path = realpathSync.native(path); } catch { /* A glob or missing path has no real path. */ }
  return relative(process.cwd(), path);
}

module.exports = { testPath };
