// ABOUTME: Gives the suite shell and worker the same repository-relative identity for a named file.

const { relative, resolve } = require('node:path');

function testPath(name) {
  return relative(process.cwd(), resolve(name));
}

if (require.main === module) {
  process.stdout.write(`${testPath(process.argv[2])}\n`);
}

module.exports = { testPath };
