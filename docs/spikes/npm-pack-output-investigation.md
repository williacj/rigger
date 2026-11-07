ABOUTME: Bounded findings for card #1213 on actual npm pack outputs and the unchanged commit-record consumer.

# npm pack output under isolated npm 11 and npm 12

The unchanged commit-record script failed with npm 12.2.2 because its successful inner
dry run returned a package-keyed object, while the script reads the first array element.
npm 11.20.0 returned a one-item array and completed the same fixture's lifecycle.
This finding covers the four observations below; it establishes no npm support policy
and changes no production code.

## Question and evidence boundary

[Card #1213](https://github.com/williacj/rigger/issues/1213) fixes a comparison of direct
dry runs and normal pack lifecycles under two isolated official npm artifacts. The
experiment ran once on 2026-11-05 in Ubuntu on WSL, using one fixed Node 26.12.0 binary.
The coordinator launched the independently inspected batch; the actual maker is manually
assigned Codex, with no Rigger maker dispatch or configured Codex spike-maker selection
claimed. The [manual provenance record](https://github.com/williacj/rigger/issues/1213#issuecomment-6662176886)
describes that delivery route.

Every number below is a measurement from Python 3.14 hashlib/json/tarfile analysis of
reopened, byte-identical copies of that batch's originals, unless marked as a judgment.
The [JSON companion](npm-pack-output-investigation.json) records the exact stream lengths,
SHA-256 digests, native exits/PIDs, parsed shapes, file listings, artifact/source identities
and private-access receipt. It contains no raw private log or absolute private path.

## Frozen inputs

| Input | Identity |
|---|---|
| Public Rigger source | f6c2701139ee568020244aed31e52457d6c25a89 |
| One committed fixture | 657aa99f3c7ada37d85aa2c1b9bc9a99b09d9434 |
| Unchanged record-commit.mjs SHA-256 | 65a6f75773262566e2fba1e7d13b0e10d0cf4e5123dec77e0f8ec2b97b2c46ef |
| Unchanged Git-environment import SHA-256 | 2536e70f9e05e1e6d8a28d26d80780d4b0fbc632427a7b806cc7f000246d43f3 |
| Fixed Node binary SHA-256 | caa24debe02770c92a70677e2a62ca98890150e7ac1c17bcfe31bcc98cc89943 |
| Fixture seal SHA-256 | c9a5ddb5b60b4e95dc06e1a4619358938870afff3d3507ae7dd4bf18954f4312 |

The fixture has the unchanged producer and import, a minimal independently authored manifest,
one illustrative module/script/template, and its ignore file. Its manifest selects src/,
scripts/ and templates/, with prepack exactly node scripts/record-commit.mjs. It has no
dependencies, workspace, lockfile, npmrc, installed modules or initial generated record.
The JSON companion preserves all seven tracked file hashes/modes and the manifest.

The independent payload oracle is six ordinary files: package.json, scripts/other.mjs,
scripts/record-commit.mjs, src/module.mjs, src/substrate/git-environment.mjs and
templates/template.txt. A successful matching prepack may add src/package-commit.json
containing the fixture's full HEAD. This expectation was authored before any pack result.

Each cell began as a separate no-hardlink clone at that same commit, with its own empty
cache, logs, output, destination, TMPDIR and user/global configuration files. Git global/system
configuration was disabled. No earlier cell supplied another cell's state. The root
repository's tracked engine-strict npmrc was deliberately omitted from all four fixtures;
qualified local-prefix/workspace source and fresh ancestor guards established which project
configuration applied.

### Official npm artifacts

Both version metadata documents and tarballs were obtained in exactly four bounded HTTPS GETs,
without redirects, retries, installs or package-script execution. Each archive matched its
official sha512 integrity value; extracted manifest versions and all 1,943 files per artifact
were qualified against retained archive/tree bytes. This is registry-over-HTTPS integrity
qualification, not independent signature or release-attestation verification.

| npm | Official source | Compressed bytes | Archive SHA-256 |
|---|---|---:|---|
| 11.20.0 | [Metadata](https://registry.npmjs.org/npm/11.20.0), [tarball](https://registry.npmjs.org/npm/-/npm-11.20.0.tgz) | 3,004,748 | d1a92f40e6c407b84c3a00c3cf978a10b24fd42f153c527e2016cef7bb34a483 |
| 12.2.2 | [Metadata](https://registry.npmjs.org/npm/12.2.2), [tarball](https://registry.npmjs.org/npm/-/npm-12.2.2.tgz) | 3,069,597 | 07fecbf753e2c3bc10ebeb3e9ed8738f6a0cc1292998b79e2e9f1dd2a5525e0c |

Both CLI entrypoint files have SHA-256
8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7.
That shared entrypoint hash does not establish an npm version. The exact manifests,
integrity-qualified full source trees and versioned implementation hashes distinguish them.

## Commands, routes and custody

NODE denotes the qualified fixed Node binary. NPM11 and NPM12 denote each isolated
artifact's absolute package/bin/npm-cli.js path. These are reproducible command templates;
the retained receipts hold the actual absolute argv and safe environment maps:

~~~sh
"$NODE" "$NPM11" pack --dry-run --json --ignore-scripts --loglevel=error
"$NODE" "$NPM12" pack --dry-run --json --ignore-scripts --loglevel=error
"$NODE" "$NPM11" pack --json --loglevel=error
"$NODE" "$NPM12" pack --json --loglevel=error
~~~

Each command used its own fixture cwd and explicit cell-private configuration/destination,
offline=true, fixed locale and a from-scratch environment. No ambient json/workspace/prefix
or ignore-scripts setting was inherited. Builtin defaults remain part of each version's
measured input. There was no global runtime or configuration change.

The outer commands bypassed the bare-npm observer. Each cell's PATH selected its owned
observer for bare npm and a fixed-Node symlink for node. Fresh guards covered npm/node
shadow candidates in every ancestor node_modules/.bin and each version's node-gyp-bin.
Each lifecycle actually invoked the intended observer once, with the exact inner dry-run
argv above; actual cwd, delegated absolute Node/CLI and lifecycle PATH matched the seal.
Direct cells invoked no observer.

The unchanged producer consumed bytes forwarded by observer source SHA-256
684232513db17b4c71c0a7aaf7e9a2fe107c804a0194f4cfc31c2229ce122a0a.
The observer retained separate child stdout/stderr while forwarding the same bytes, without
decoding or parser instrumentation. Both inner children exited 0 with no observer fault.
The inspected outer launcher, source SHA-256
1a32a33e07b7eac160f0602b158c92ef6ebcdb485d70b74c465715a4b2ef377f,
recorded four outer starts and 37 separate read-only Git guard starts. All those guards
exited 0. Transport exit 0 and launcher exit 0 establish custody completion; they do not
replace the individual npm exits.

Native child PIDs were recorded at start. Unchanged execFileSync/npm internals did not expose
every descendant PID. No complete descendant-registration, absence or cleanup claim follows.
No process was automatically signalled at a deadline, and no retry or extra batch ran.
Separate streams establish no cross-stream causal ordering.

## Actual four-cell results

| Cell | Outer exit | Outer stdout | Actual inner result | Listed files | Generated record / tarball |
|---|---:|---|---|---:|---|
| 11-direct | 0 | Array, length 1 | No inner call | 6 | Neither |
| 12-direct | 0 | Object, sole key rigger-pack-output-fixture | No inner call | 6 | Neither |
| 11-lifecycle | 0 | Array, length 1 | Exit 0; array, length 1 | Inner 6; outer 7 | Both |
| 12-lifecycle | 1 | Error object, sole key error | Exit 0; object keyed by rigger-pack-output-fixture | Inner 6; outer has no package listing | Neither |

The npm 11 direct stdout and actual lifecycle-inner stdout are byte-identical: 1,048 bytes,
SHA-256 289b499c6291b376ab5b88957ca7d3f28797fa7fc3abb1f3028da26318d702f7.
The npm 12 pair are also byte-identical: 1,078 bytes, SHA-256
46dfe2f7116d287f9b3ed40033f0e3ed55223761d386e1d1d9691613913234bf.
Both inner stderr streams are empty. After selecting the array element or package-name member,
the two direct package metadata objects are equal, including the same six paths, sizes,
modes and tar metadata.

npm 11's normal pack produced a 3,384-byte tarball with seven regular-file members.
Python tarfile inspection of its retained original found the six expected files plus the
54-byte record, whose commit equals the frozen fixture HEAD. All held member bytes match
their fixture hashes; the tarball's actual sha1/sha512 and length match the emitted metadata.

npm 12's outer stdout is a 122-byte JSON error object, not a package listing. Its 1,573-byte
stderr contains the TypeError at line45, column39 of the
[unchanged record consumer](https://github.com/williacj/rigger/blob/f6c2701139ee568020244aed31e52457d6c25a89/scripts/record-commit.mjs#L45). Its actual
inner stdout is the successful package-keyed six-file object. It has no numeric zero key
and is not an empty array. The generated record and destination tarball are absent.

## Source explanation

The [unchanged consumer at the measured source](https://github.com/williacj/rigger/blob/f6c2701139ee568020244aed31e52457d6c25a89/scripts/record-commit.mjs#L45)
reads JSON.parse(listed)[0].files. The captured npm 12 object has a package-name member,
so the numeric selection supplies no package value before the files access. The observed
stack points at that access. This explanation uses the actual captured inner bytes and
source; it does not infer an empty array from an outer exception.

The qualified official archives supply the complete producer trace, with exact file hashes
in the JSON companion:

| Versioned source | Relevant behavior |
|---|---|
| npm 11 lib/commands/pack.js | Sends each tar's numeric index to logTar. |
| npm 12 lib/commands/pack.js | Sends each tar's package name to logTar. |
| lib/utils/tar.js | Buffers the tar metadata under that key. |
| lib/utils/display.js | Numeric consecutive keys become an array; named keys remain an object. |
| node_modules/libnpmpack/lib/index.js | Runs prepack for this local directory when scripts are enabled, then writes the normal tarball. |

The files are present in the linked official tarballs, not reconstructed from a historical
entrypoint hash. This trace explains the measured representation change and parser failure.
It does not show that all possible version differences reduce to this one change.

## Contracts, recommendation and limits

The [pinned repository manifest](https://github.com/williacj/rigger/blob/f6c2701139ee568020244aed31e52457d6c25a89/package.json)
declares Node >=24 and no npm engine, packageManager or devEngines contract.
The [pinned README prerequisites](https://github.com/williacj/rigger/blob/f6c2701139ee568020244aed31e52457d6c25a89/README.md#prerequisites)
name macOS today and separate the experimental WSL development route. This Linux/WSL
observation supplies no supported-macOS host result. Absence of an npm pin is not an npm
support guarantee.

The qualified npm 11 manifest requires Node ^20.17.0 or >=22.9.0; npm 12 requires
^22.22.2, ^24.15.0 or >=26.0.0. The fixed Node 26.12.0 satisfies both stated ranges.
The bundled versioned npm-pack documentation describes JSON mode, dry-run, script controls
and pack destination; it does not specify this exact array/object representation.
Measured implementation output and proposed consumer support policy therefore remain distinct.

My judgment is to author a separate, narrowly scoped producer-consumer compatibility repair,
with acceptance covering the observed representations and invalid/missing output.
The premise is equal successful six-file metadata under different actual representations,
the unchanged numeric-index consumer and the observed lifecycle failure. A shared runtime
downgrade, npm pin or support-range decision was neither implemented nor qualified here.
Reconsider that repair scope if qualified originals/source contradict this route or result,
or the owner adopts a separately approved narrower npm contract.

No next discrimination batch is recommended: these four cells distinguish the initial
representation hypothesis within their scope. A broader fixture/version/host claim would
need its own bounded prospective proposal and admission. No full-repository pack, alternate
Node, workspace, failure-state matrix or repaired consumer was exercised.

Prior failures retain their original status. This batch offers no historical private result
as proof, gives #1132 no retroactive package-proof credit and replaces none of its required
final checks. Current npm 12 lifecycle failure is retained as a finding, not repaired away.

## Retained originals and completion boundary

Private receipt 1213-private-access-01 maps each public digest to closed originals and
byte-identical analysis copies in the coordinator's owner-machine evidence store. The owner
or coordinator can provide that mapping to the independently assigned reviewer. It covers
the twelve separate producer streams, their start/end/route/PID/config receipts, generated
record/tarball originals, source/artifact/fixture manifests and batch guard/transport records.
All offered originals and fixture/tool roots remain retained through final independent ruling.
Only sanitized findings and relative receipt handles are published.

The retained work is the report, JSON companion, one own-card journal entry and its strict
document registration. The first ordinary pre-commit attempt at f6 was refused for missing
that registration; no commit was made. The sole doc-references.json entry applies the existing
strict policy. No producer, wrapper, factory, test, dependency, shared runtime, consumer runtime
configuration or npm support-policy change lands. This is the maker's report; independent
acceptance-item review and ordinary delivery verification remain required.
