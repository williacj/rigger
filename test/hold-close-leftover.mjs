// ABOUTME: A module the bin preloads in the leftover test, so that removing a temporary file in an
// admission directory fails while every other unlink still runs.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname } from 'node:path';

const unlink = fs.unlinkSync;
fs.unlinkSync = (path, ...rest) => {
  if (basename(dirname(String(path))) === 'admission' && basename(String(path)).startsWith('.tmp-')) {
    throw Object.assign(new Error(`EPERM: the leftover test keeps ${path}`), { code: 'EPERM' });
  }
  return unlink(path, ...rest);
};
syncBuiltinESMExports();
