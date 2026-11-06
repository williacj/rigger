// ABOUTME: Selects npm's package metadata from its observed single-package JSON forms.

// #1213's controlled comparison measured an array from npm 11.20.0 and a package-keyed
// object from npm 12.2.2. npm owns the metadata; selection leaves its fields unchanged (D16).
export function packResult(stdout) {
  const packages = Object.values(JSON.parse(stdout));
  if (packages.length !== 1) throw new Error('npm pack must return exactly one package');
  return packages[0];
}
