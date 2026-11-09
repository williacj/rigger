// ABOUTME: Shares #606 source bindings, authored census data and synchronous EX models.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NATIVE_RECEIPT_ROOT = 'RIGGER_606_NATIVE_RECEIPT_ROOT';
const NATIVE_GIT_OUTPUT_LIMIT = 8 * 1024 * 1024;

/**
 * Answers the raw stdout of one awaited Git child, receipted losslessly as it spawns and as it
 * closes. The helper keeps built-in-only dependencies, so it names the redirecting variables that
 * src/substrate/git-environment.mjs removes rather than importing that module.
 */
function nativeGit(cwd, ...argv) {
  const { GIT_DIR, GIT_COMMON_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, ...env } = process.env;
  const receipt = entry => appendFileSync(join(process.env[NATIVE_RECEIPT_ROOT], 'native-children.jsonl'),
    JSON.stringify({ ...entry, cwd, argv }) + '\n');
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    receipt({ event: 'spawned', pid: child.pid });
    const stdout = [], stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const output = Buffer.concat(stdout);
      receipt({ event: 'closed', pid: child.pid, code, signal, stdoutBase64: output.toString('base64'),
        stderrBase64: Buffer.concat(stderr).toString('base64') });
      if (code === 0 && signal === null && output.length <= NATIVE_GIT_OUTPUT_LIMIT) resolve(output);
      else reject(new Error('native Git child failed'));
    });
  });
}

/** Captures physical proof sources and checks their continuity around the module import. */
export function bindProcessProof(moduleUrl, { sourceKind, fail, guard, strict } = {}) {
  guard(sourceKind === undefined, 'historical source selection is not supported');
  const strictRequested = strict !== undefined || Object.hasOwn(arguments[1] ?? {}, 'strict');
  const MODULE = moduleUrl;
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const root = realpathSync(new URL('../../', MODULE));
  const capture = () => {
    const files = [];
    const walk = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) files.push(Object.freeze({
          url: pathToFileURL(realpathSync(path)).href,
          sha256: digest(readFileSync(path)),
        }));
      }
    };
    try {
      walk(join(root, 'src'));
      walk(join(root, 'test'));
    } catch { fail('source closure could not be read'); }
    return files.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  };
  const closure = Object.freeze(capture());
  const checkPhysicalSources = () => {
    const actual = capture();
    guard(actual.length === closure.length && actual.every((file, index) =>
      file.url === closure[index].url && file.sha256 === closure[index].sha256),
    'source closure fingerprint changed');
  };
  let checkStrictSources, refreshNativeFacts;
  if (strictRequested) {
    const shape = (value, keys) => value !== null && typeof value === 'object' &&
      !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join('\0') === [...keys].sort().join('\0') &&
      Object.values(Object.getOwnPropertyDescriptors(value)).every(property => Object.hasOwn(property, 'value'));
    const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    const ref = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
    const runtimeKeys = ['path', 'version', 'platform', 'arch', 'binarySha256'];
    const runtimeShape = value => shape(value, runtimeKeys) && runtimeKeys.every(key =>
      typeof value[key] === 'string') && sha(value.binarySha256) && /^v(?:2[6-9]|[3-9]\d|\d{3,})\.\d+\.\d+$/.test(value.version);
    const equalRuntime = (one, other) => runtimeKeys.every(key => one[key] === other[key]);
    const rows = (value, subtree) => {
      guard(Array.isArray(value), 'strict source rows malformed');
      const seen = new Set();
      for (const row of value) {
        guard(shape(row, ['path', 'sha256']) && typeof row.path === 'string' && sha(row.sha256),
          'strict source row malformed');
        const segments = row.path.split('/');
        guard(segments[0] === subtree && segments.length > 1 &&
          segments.every(segment => segment !== '' && segment !== '.' && segment !== '..' &&
            !segment.includes('\\') && !segment.includes('\0') && !segment.includes(':')) && !seen.has(row.path),
        'strict source path malformed');
        seen.add(row.path);
      }
      return value.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    };
    guard(shape(strict, ['manifest', 'runtime', 'inputSha256', 'readGitFacts']) &&
      (typeof strict.readGitFacts === 'function' || strict.readGitFacts === 'native'), 'strict request malformed');
    const supplied = strict.manifest;
    guard(shape(supplied, ['base', 'head', 'runtime', 'inputSha256', 'srcByRef', 'tests']) &&
      ref(supplied.base) && ref(supplied.head) && supplied.base !== supplied.head &&
      runtimeShape(supplied.runtime) && sha(supplied.inputSha256) &&
      shape(supplied.srcByRef, [supplied.base, supplied.head]), 'strict manifest malformed');
    guard(runtimeShape(strict.runtime) && equalRuntime(strict.runtime, supplied.runtime),
      'strict runtime identity changed');
    guard(sha(strict.inputSha256) && strict.inputSha256 === supplied.inputSha256,
      'strict input fingerprint changed');
    const sourceMaps = Object.fromEntries([supplied.base, supplied.head].map(selected =>
      [selected, rows(supplied.srcByRef[selected], 'src')]));
    for (const source of Object.values(sourceMaps)) guard(source.filter(row =>
      row.path === 'src/substrate/process.mjs').length === 1, 'strict process source missing');
    const expectedTests = rows(supplied.tests, 'test');
    const expectedRuntime = { ...supplied.runtime };
    const base = supplied.base, head = supplied.head;
    let nativeFacts;
    const readGitFacts = strict.readGitFacts === 'native' ? () => nativeFacts : strict.readGitFacts;
    const rootUrl = pathToFileURL(root + '/').href;
    const physicalRows = subtree => closure.filter(file => file.url.startsWith(rootUrl + subtree + '/')).map(file => ({
      path: decodeURIComponent(file.url.slice(rootUrl.length)), sha256: file.sha256,
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const physicalSrc = rows(physicalRows('src'), 'src'), physicalTests = rows(physicalRows('test'), 'test');
    guard(physicalSrc.length + physicalTests.length === closure.length,
      'strict physical source escaped root');
    const samePaths = (one, other) => one.length === other.length && one.every((row, index) =>
      row.path === other[index].path);
    const sameRows = (one, other) => samePaths(one, other) && one.every((row, index) =>
      row.sha256 === other[index].sha256);
    if (strict.readGitFacts === 'native') {
      guard(typeof process.env[NATIVE_RECEIPT_ROOT] === 'string', 'strict native receipt root missing');
      const git = async read => {
        try { return await read(); } catch { fail('strict Git facts could not be read'); }
      };
      const treeAt = async ref => {
        const entries = (await git(() => nativeGit(root, 'ls-tree', '-r', '-z', ref))).toString('utf8').split('\0');
        guard(entries.pop() === '', 'strict Git tree malformed');
        return entries.map(entry => {
          const parsed = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/s.exec(entry);
          guard(parsed !== null, 'strict Git tree malformed');
          return { mode: parsed[1], type: parsed[2], blob: parsed[3], path: parsed[4] };
        });
      };
      const blobRows = async (tree, subtree) => {
        const found = [];
        for (const entry of tree.filter(({ path }) => path.startsWith(subtree + '/'))) {
          guard(entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755'),
            'strict Git entry is not a regular file');
          found.push({ path: entry.path, sha256: digest(await git(() => nativeGit(root, 'cat-file', 'blob', entry.blob))) });
        }
        return rows(found, subtree);
      };
      // Each read is a fresh snapshot for the synchronous comparator, which owns the selected map.
      refreshNativeFacts = async () => {
        const readIdentity = () => git(() => nativeGit(root, 'rev-parse', '--show-toplevel', 'HEAD', `${base}^{commit}`, `${head}^{commit}`));
        const identity = await readIdentity();
        const answers = identity.toString('utf8').split('\n');
        guard(answers.length === 5 && answers[0] === root && answers[2] === base && answers[3] === head &&
          answers[4] === '', 'strict Git identity changed');
        const selected = answers[1];
        guard(selected === base || selected === head, 'strict selected ref changed');
        const baseTree = await treeAt(base), headTree = await treeAt(head);
        const source = { [base]: await blobRows(baseTree, 'src'), [head]: await blobRows(headTree, 'src') };
        const tests = await blobRows(headTree, 'test');
        guard(identity.equals(await readIdentity()), 'strict Git identity changed');
        const other = selected === base ? head : base;
        const actual = source[other], frozen = sourceMaps[other];
        const changed = frozen.find((row, index) => row.path !== actual[index]?.path ||
          row.sha256 !== actual[index].sha256) ?? actual[frozen.length];
        if (changed) fail(`strict frozen source map differs from Git: ${other} ${changed.path}`);
        nativeFacts = { head: selected, src: source[selected], tests };
      };
    }
    let selectedRef;
    checkStrictSources = () => {
      guard(expectedRuntime.path === process.execPath && expectedRuntime.version === process.version &&
        expectedRuntime.platform === process.platform && expectedRuntime.arch === process.arch,
      'strict runtime identity changed');
      let binary;
      try { binary = digest(readFileSync(process.execPath)); } catch { fail('strict runtime binary could not be read'); }
      guard(binary === expectedRuntime.binarySha256, 'strict runtime binary changed');
      let facts;
      try { facts = readGitFacts(root); } catch { fail('strict Git facts could not be read'); }
      guard(shape(facts, ['head', 'src', 'tests']) && ref(facts.head) &&
        (facts.head === base || facts.head === head), 'strict selected ref changed');
      guard(selectedRef === undefined || facts.head === selectedRef, 'strict selected ref changed');
      const actualSrc = rows(facts.src, 'src'), actualTests = rows(facts.tests, 'test');
      guard(sameRows(actualSrc, physicalSrc) && sameRows(actualTests, physicalTests),
        'strict Git facts differ from physical sources');
      const expectedSrc = sourceMaps[selectedRef ?? facts.head];
      guard(samePaths(actualSrc, expectedSrc) && samePaths(actualTests, expectedTests),
        'strict source coverage changed');
      guard(sameRows(actualTests, expectedTests), 'strict test fingerprint changed');
      for (let index = 0; index < actualSrc.length; index++) {
        guard(actualSrc[index].sha256 === expectedSrc[index].sha256,
          actualSrc[index].path === 'src/substrate/process.mjs' ?
            'strict process source fingerprint changed' : 'strict source fingerprint changed');
      }
      selectedRef ??= facts.head;
    };
  }
  const checkSources = () => {
    checkPhysicalSources();
    if (checkStrictSources) checkStrictSources();
    checkPhysicalSources();
  };
  const verifySources = refreshNativeFacts ? async () => {
    await refreshNativeFacts();
    checkSources();
  } : checkSources;
  const binding = {
    closure,
    checkSources: verifySources,
    async importProduct(importer = specifier => import(specifier)) {
      await verifySources();
      const namespace = await importer(MODULE);
      await verifySources();
      return namespace;
    },
  };
  // An explicit strict request must qualify before a binding can be handed to its caller.
  if (refreshNativeFacts) return verifySources().then(() => binding);
  if (strictRequested) checkSources();
  return binding;
}

export const CENSUS_CASES = [
  {
    "id": "REPAIR-CENSUS-SKIPPED-SIGHTING-MAP",
    "driver": "actual exported census generator",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3-first#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 ?\n"
      },
      {
        "site": "pause2",
        "yielded": 2,
        "reply": null
      }
    ],
    "clock": {
      "initial": 0,
      "afterSecondC1Reply": 5000,
      "allOtherElapsed": 0,
      "trace": "undefined"
    },
    "signalCalls": [],
    "expectedMembers": [
      {
        "pid": 41001,
        "name": "name-A",
        "cmd": "new-A"
      }
    ],
    "expectedSightingsEntries": [
      [
        41001,
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      [
        41002,
        {
          "$606": "undefined"
        }
      ]
    ],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128
  },
  {
    "id": "REPAIR-CENSUS-MALFORMED-C1-NO-PARTIAL-RETURN",
    "driver": "actual exported census generator",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3-first#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 ?\nbad row\n"
      }
    ],
    "clock": {
      "initial": 0,
      "afterSecondC1Reply": 5000,
      "allOtherElapsed": 0,
      "trace": "undefined"
    },
    "signalCalls": [],
    "expectedThrow": "the process table held a row the census cannot read: \"bad row\"",
    "expectedNoReturn": true,
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128
  },
  {
    "id": "REPAIR-CENSUS-TRUSTED-C1-C2-ETIMEDOUT",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "error": {
          "code": "ETIMEDOUT",
          "message": "606 authored ETIMEDOUT at C2#2"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedReturn": {
      "members": [
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      "sightings": {
        "$606": "Map",
        "entries": [
          [
            41001,
            {
              "pid": 41001,
              "name": "name-A",
              "cmd": "new-A"
            }
          ],
          [
            41002,
            {
              "$606": "undefined"
            }
          ]
        ]
      }
    }
  },
  {
    "id": "REPAIR-CENSUS-TRUSTED-C2-C3-ETIMEDOUT",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n41002 seen-B\n"
      },
      {
        "site": "C3#2",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "error": {
          "code": "ETIMEDOUT",
          "message": "606 authored ETIMEDOUT at C3#2"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedReturn": {
      "members": [
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      "sightings": {
        "$606": "Map",
        "entries": [
          [
            41001,
            {
              "pid": 41001,
              "name": "name-A",
              "cmd": "new-A"
            }
          ],
          [
            41002,
            {
              "$606": "undefined"
            }
          ]
        ]
      }
    }
  },
  {
    "id": "REPAIR-CENSUS-TRUSTED-C4-C5-ETIMEDOUT",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#2",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n41002 seen-B\n"
      },
      {
        "site": "C5#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "error": {
          "code": "ETIMEDOUT",
          "message": "606 authored ETIMEDOUT at C5#2"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedReturn": {
      "members": [
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      "sightings": {
        "$606": "Map",
        "entries": [
          [
            41001,
            {
              "pid": 41001,
              "name": "name-A",
              "cmd": "new-A"
            }
          ],
          [
            41002,
            {
              "$606": "undefined"
            }
          ]
        ]
      }
    }
  },
  {
    "id": "REPAIR-CENSUS-TRUSTED-C1-C2-LATE",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "error": {
          "code": "LATE",
          "message": "606 authored LATE at C2#2"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedReturn": {
      "members": [
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      "sightings": {
        "$606": "Map",
        "entries": [
          [
            41001,
            {
              "pid": 41001,
              "name": "name-A",
              "cmd": "new-A"
            }
          ],
          [
            41002,
            {
              "$606": "undefined"
            }
          ]
        ]
      }
    }
  },
  {
    "id": "REPAIR-CENSUS-LATER-MALFORMED-NO-PARTIAL-RETURN",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n41003 partial-C\nbad row\n"
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedError": {
      "throwMessage": "the process table held a row the census cannot read: \"bad row\"",
      "noReturn": true
    }
  },
  {
    "id": "REPAIR-CENSUS-NONBUDGET-REFUSAL-NO-PARTIAL-RETURN",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 old-A\n"
      },
      {
        "site": "C3#1",
        "yielded": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "reply": "name-A\n"
      },
      {
        "site": "C4#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "reply": "41001 new-A\n"
      },
      {
        "site": "C5#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n"
      },
      {
        "site": "pause1",
        "yielded": 1,
        "reply": null
      },
      {
        "site": "C1#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 S\n"
      },
      {
        "site": "C2#2",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "error": {
          "code": "EACCES",
          "message": "606 authored EACCES at C2#2"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedError": {
      "throwCode": "EACCES",
      "throwMessage": "606 authored EACCES at C2#2",
      "noReturn": true
    }
  },
  {
    "id": "REPAIR-CENSUS-NO-LAST-ETIMEDOUT-THROWS",
    "yields": [
      {
        "site": "C1#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "reply": "41001 S\n41002 S\n"
      },
      {
        "site": "C2#1",
        "yielded": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "error": {
          "code": "ETIMEDOUT",
          "message": "606 authored ETIMEDOUT at C2#1"
        }
      }
    ],
    "clock": {
      "initial": 0
    },
    "signalCalls": [],
    "group": 41001,
    "deadlineMs": 5000,
    "maxGeneratorSteps": 16,
    "maxClockCalls": 128,
    "captureErrors": true,
    "errorClock": 5000,
    "expectedError": {
      "throwCode": "ETIMEDOUT",
      "throwMessage": "606 authored ETIMEDOUT at C2#1",
      "noReturn": true
    }
  }
];

export const encodeObserved = value =>
  value === undefined ? { $606: 'undefined' } :
  value === Infinity ? { $606: 'Infinity' } :
  value instanceof Map ? { $606: 'Map', entries: [...value].map(([key, item]) => [key, encodeObserved(item)]) } :
  Array.isArray(value) ? value.map(encodeObserved) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeObserved(item)])) :
  value;

export function driveCensus(row, census, { writeOriginal = bytes => process.stdout.write(bytes), assertExpectedThrow = assert.throws } = {}) {
  let clock = row.clock.initial;
  let clockCalls = 0;
  let signalCalls = 0;
  const observed = [];
  const mark = (event, fields = {}) => observed.push({ ordinal: observed.length + 1, event, ...encodeObserved(fields) });
  const kill = (pid, signal) => {
    signalCalls += 1;
    mark('signal', { pid, signal, signalCalls });
    throw new Error('unexpected signal');
  };
  const now = () => {
    assert.ok(++clockCalls <= row.maxClockCalls, 'clock call ceiling');
    mark('clock', { value: clock, clockCalls });
    return clock;
  };
  const emitOriginal = original => writeOriginal('606_CENSUS_ORIGINAL ' + JSON.stringify(encodeObserved(original)) + '\n');
  const generator = census(row.group, kill, row.deadlineMs, now, event => mark('source.trace', { sourceEvent: event }));
  let next = generator.next();
  let steps = 0;
  let thrown;
  for (const step of row.yields) {
    assert.ok(++steps <= row.maxGeneratorSteps, 'generator step ceiling');
    mark('yield', { step: steps, site: step.site, actual: next.value, expected: step.yielded, done: next.done });
    assert.equal(next.done, false, 'census stopped before the authored response');
    assert.deepEqual(next.value, step.yielded, step.site);
    if (step.site === 'C1#2' && row.clock.afterSecondC1Reply !== undefined) {
      clock = row.clock.afterSecondC1Reply;
      mark('clock.advance', { afterSite: step.site, value: clock });
    }
    if (step.error) {
      assert.equal(row.captureErrors, true, 'authored error requires an admitted supporting control');
      clock = row.errorClock;
      mark('clock.advance', { afterSite: step.site, value: clock });
      mark('throw.inject', { step: steps, site: step.site, error: step.error });
    } else mark('reply', { step: steps, site: step.site, reply: step.reply });
    if (row.expectedThrow && step === row.yields.at(-1)) {
      let outcome, failure, didThrow = false;
      try { outcome = generator.next(step.reply); }
      catch (error) { didThrow = true; failure = error; }
      const errorRecord = didThrow ? { name: failure?.name, message: failure?.message, code: failure?.code } : undefined;
      if (didThrow) mark('throw', { error: errorRecord });
      else mark('return', { done: outcome.done, value: outcome.value });
      emitOriginal({
        id: row.id,
        authored: { yields: row.yields, clock: row.clock, expectedThrow: row.expectedThrow, expectedNoReturn: row.expectedNoReturn },
        observed,
        actual: didThrow ? { threw: errorRecord } : { done: outcome.done, value: outcome.value },
        counters: { steps, clockCalls, signalCalls }
      });
      assertExpectedThrow(() => { if (didThrow) throw failure; return outcome; }, { message: row.expectedThrow });
      assert.equal(signalCalls, 0);
      return { threw: true };
    }
    try {
      next = step.error
        ? generator.throw(Object.assign(new Error(step.error.message), { code: step.error.code }))
        : generator.next(step.reply);
    } catch (error) {
      if (!row.captureErrors) throw error;
      thrown = error;
      mark('throw', { error: { name: error.name, message: error.message, code: error.code } });
      break;
    }
  }
  if (row.captureErrors) {
    if (!thrown) mark('return', { done: next.done, value: next.value });
    emitOriginal({
      id: row.id,
      authored: { yields: row.yields, clock: row.clock, errorClock: row.errorClock, expectedReturn: row.expectedReturn, expectedError: row.expectedError },
      observed,
      actual: thrown ? { threw: { name: thrown.name, message: thrown.message, code: thrown.code } } : { done: next.done, value: next.value },
      counters: { steps, clockCalls, signalCalls }
    });
    assert.equal(steps, row.yields.length, 'all authored supporting responses must be consumed');
    assert.equal(signalCalls, 0);
    if (row.expectedError) {
      assert.ok(thrown, 'the authored refusal must throw');
      assert.equal(thrown.message, row.expectedError.throwMessage);
      if (row.expectedError.throwCode !== undefined) assert.equal(thrown.code, row.expectedError.throwCode);
      assert.equal(row.expectedError.noReturn, true);
      assert.equal(observed.some(record => record.event === 'return'), false, 'a refusal must not return a partial value');
    } else {
      assert.equal(thrown, undefined, 'the supporting census must return');
      assert.equal(next.done, true, 'census did not return after the authored responses');
      assert.ok(next.value.sightings instanceof Map);
      assert.deepEqual(encodeObserved(next.value), row.expectedReturn);
    }
    return;
  }
  mark('return', { done: next.done, value: next.value });
  assert.equal(next.done, true, 'census did not return at the authored deadline');
  assert.equal(signalCalls, 0);
  return { value: next.value, observed, counters: { steps, clockCalls, signalCalls } };
}

export const EX_CAUSAL_CASES = [
{
    "id": "SITE-EX-F0-X-Z",
    "hypothesis": false,
    "steps": [
      {
        "kind": "signal",
        "site": "entry",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "C1",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C2",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 cmd-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C3-first",
        "argv": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "name-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C4",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 cmd-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C5",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "signal",
        "site": "B0 occupied",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "B0-first",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 Z\n",
          "stderr": ""
        },
        "remaining": 10000
      },
      {
        "kind": "signal",
        "site": "F0 occupied",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "F0",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat=,xstat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 Z 0\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "signal",
        "site": "first group kill",
        "pid": -41001,
        "signal": "SIGKILL"
      },
      {
        "kind": "signal",
        "site": "postkill W occupied",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "W-first",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat=,xstat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 Z 0\n",
          "stderr": ""
        },
        "remaining": 5000
      }
    ],
    "aq": false,
    "naturalBeforeB0": [
      41001
    ],
    "naturalAtF0": false,
    "initialModel": {
      "41001": "live"
    },
    "expectedModel": {
      "41001": "naturally-ended"
    },
    "expectedKills": [],
    "expectedLeader": "0"
  },
  {
    "id": "EDGE-EX-AQ-NEWPID-B0-omitted-reaped",
    "hypothesis": true,
    "steps": [
      {
        "kind": "signal",
        "site": "entry",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "C1#1",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C2#1",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 old-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C3-first#1",
        "argv": [
          "-p",
          "41001",
          "-o",
          "ucomm="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "name-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C4#1",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,command="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 new-A\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C5#1",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "read",
        "site": "C1#2",
        "argv": [
          "-ww",
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n41002 ?\n",
          "stderr": ""
        },
        "remaining": 5000
      },
      {
        "kind": "signal",
        "site": "B0 occupied",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "B0-first",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S\n",
          "stderr": ""
        },
        "remaining": 10000
      },
      {
        "kind": "signal",
        "site": "optional B-zero",
        "pid": 41002,
        "signal": 0,
        "optional": "B-zero"
      },
      {
        "kind": "signal",
        "site": "optional F0 occupied",
        "pid": -41001,
        "signal": 0,
        "optional": "F0"
      },
      {
        "kind": "read",
        "site": "optional F0",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat=,xstat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 S 0\n",
          "stderr": ""
        },
        "remaining": 5000,
        "optional": "F0"
      },
      {
        "kind": "signal",
        "site": "first group kill",
        "pid": -41001,
        "signal": "SIGKILL"
      },
      {
        "kind": "signal",
        "site": "postkill W occupied",
        "pid": -41001,
        "signal": 0
      },
      {
        "kind": "read",
        "site": "W-first after group kill",
        "argv": [
          "-g",
          "41001",
          "-o",
          "pid=,stat=,xstat="
        ],
        "answer": {
          "error": null,
          "status": 0,
          "signal": null,
          "stdout": "41001 Z 9\n",
          "stderr": ""
        },
        "remaining": 5000
      }
    ],
    "aq": true,
    "naturalBeforeB0": [],
    "naturalAtF0": false,
    "initialModel": {
      "41001": "live",
      "41002": "live"
    },
    "expectedModel": {
      "41001": "force-ended",
      "41002": "reaped"
    },
    "expectedKills": [
      [
        "survivor.killed",
        {
          "pid": 41001,
          "name": "name-A",
          "cmd": "new-A"
        }
      ],
      [
        "group.killed",
        {
          "group": 41001,
          "census": "a pre-kill read showed a member whose complete name and command line were unavailable, so the group kill may have ended it"
        }
      ]
    ],
    "expectedLeader": "9",
    "reapBeforeW": [
      41002
    ]
  }
];

/** Drives the existing authored synchronous EX read/signal automaton against its supplied observations. */
export function createExCausalModel(row, { record, guard, equal, isBegun }) {
  let position = 0, rawCalls = 0, signalCalls = 0, clockCalls = 0, groupKills = 0, clock = 0;
  const model = { ...row.initialModel };
  const optional = Object.fromEntries(row.steps.filter(step => step.optional).map(step => [step.optional, 'unobserved']));
  const optionsFor = step => ({ env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' }, timeout: step.remaining, killSignal: 'SIGKILL', maxBuffer: Infinity, encoding: 'utf8', cwd: '/' });
  const matches = (step, action) => step.kind === action.kind && (step.kind === 'signal' ? step.pid === action.pid && step.signal === action.signal : action.tool === '606-controlled-ps' && equal(action.args, step.argv) && equal(action.options, optionsFor(step)));
  const consume = action => {
    let step = row.steps[position];
    while (step?.optional && optional[step.optional] === 'unobserved' && !matches(step, action)) {
      const name = step.optional; optional[name] = 'absent'; record('optional', { slot: name, state: 'absent' });
      while (row.steps[position]?.optional === name) position += 1;
      step = row.steps[position];
    }
    guard(step !== undefined && matches(step, action), 'finite read/signal automaton mismatch');
    if (step.optional && optional[step.optional] === 'unobserved') { optional[step.optional] = 'present'; record('optional', { slot: step.optional, state: 'present' }); }
    position += 1; return step;
  };
  const naturallyEnd = (pid, site) => {
    guard(groupKills === 0 && model[pid] === 'live', 'natural transition premise failed');
    model[pid] = 'naturally-ended'; record('model.transition', { pid, state: model[pid], site });
  };
  const raw = (tool, args, options) => {
    guard(isBegun() && ++rawCalls <= 16, 'raw call ceiling or go guard failed');
    const step = consume({ kind: 'read', tool, args, options });
    record('raw.entry', { site: step.site, tool, args, options, clock });
    if (step.site === 'B0-first') {
      for (const pid of row.naturalBeforeB0) naturallyEnd(pid, 'before B0');
      for (const pid of row.reapBeforeB0 ?? []) {
        guard(groupKills === 0 && model[pid] === 'live', 'reaping premise failed');
        model[pid] = 'reaped'; record('model.transition', { pid, state: model[pid], site: 'before B0' });
      }
    }
    if (step.site === 'F0' && row.naturalAtF0) naturallyEnd(41001, 'after B0 before F0');
    if (step.site === 'F0') for (const pid of row.naturalAtF0Pids ?? []) naturallyEnd(pid, 'after B0 before F0');
    if (step.site.startsWith('W-first')) {
      guard(groupKills === 1, 'W occurred before the only group kill');
      for (const pid of row.reapBeforeW ?? []) {
        guard(model[pid] === 'force-ended', 'post-kill reaping premise failed');
        model[pid] = 'reaped'; record('model.transition', { pid, state: model[pid], site: 'external reap before W' });
      }
    }
    if (step.site === 'C1#2') { guard(row.aq && clock === 0, 'AQ cutoff premise failed'); clock = 5000; record('clock.cutoff', { nextSourceClock: 5000 }); }
    record('raw.return', { site: step.site, answer: step.answer });
    return { ...step.answer };
  };
  const kill = (pid, signal) => {
    guard(isBegun() && ++signalCalls <= 8, 'signal ceiling or go guard failed');
    const step = consume({ kind: 'signal', pid, signal });
    record('signal', { site: step.site, pid, signal });
    if (signal === 'SIGKILL') {
      guard(groupKills === 0 && pid === -41001, 'only group kill premise failed'); groupKills += 1;
      for (const [subject, state] of Object.entries(model)) if (state === 'live') { model[subject] = 'force-ended'; record('model.transition', { pid: Number(subject), state: model[subject], site: 'group SIGKILL' }); }
    }
    if (step.throws) throw Object.assign(new Error(step.throws.message), { code: step.throws.code });
    return undefined;
  };
  const now = () => { guard(isBegun() && ++clockCalls <= 128, 'clock ceiling or go guard failed'); record('clock', { value: clock, count: clockCalls }); return clock; };
  return {
    model, raw, kill, now,
    complete(actual) {
      const expected = { kills: row.expectedKills, leader: row.expectedLeader, unread: undefined };
      record('return', { actual, expected });
      guard(position === row.steps.length && groupKills === 1, 'mandatory automaton not consumed');
      guard(Object.values(optional).every(value => value !== 'unobserved'), 'optional slot not classified');
      guard(equal(model, row.expectedModel), 'independent final model mismatch');
      return { expected, rawCalls, signalCalls, clockCalls, groupKills, optional, model };
    },
  };
}
