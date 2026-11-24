#!/bin/bash
# ABOUTME: Throwaway mutation check for #1462: each sed edit of count.mjs must fail count.test.mjs.
here=$(cd "$(dirname "$0")" && pwd)
while IFS='|' read -r name edit; do
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/1462-spike-engineer-mut.XXXXXX")
  sed -E "$edit" "$here/count.mjs" > "$tmp/count.mjs"; cp "$here/count.test.mjs" "$tmp/"
  if cmp -s "$tmp/count.mjs" "$here/count.mjs"; then echo "NOCHANGE $name"; continue; fi
  if node --test "$tmp/count.test.mjs" > "$tmp/out" 2>&1; then echo "SURVIVED $name"; else echo "killed $name ($(grep -c '^✖' "$tmp/out"))"; fi
done <<'LIST'
selector|s/> SELECTOR/>= SELECTOR/g
closing stretch ignored|s/end\.at >= tails\.get\(end\.run\) \|\| /true || /
closing stretch required|s/end\.at >= tails\.get\(end\.run\) \|\| end\.unread \|\| end\.kept/end.at >= tails.get(end.run)/
closing release ignored|s/const closing = !released\(one\) \&\& /const closing = /
call.end leaves the stretch|s/event\.event !== 'fetch\.retried'/!['call.end', 'fetch.retried'].includes(event.event)/
fetch.retried in the stretch|s/ \&\& event\.event !== 'fetch\.retried'//
beside D1 as D2|s/outright\.has\(one\.run\) \? 'beside D1' : 'D2'/'D2'/
D1 release|s/released\(one\) \|\| one\.claim\?\.followed \? 'X'/false ? 'X'/
recorded.killed same run|s/event\.run !== one\.run \&\& event\.at > one\.start\.at/event.at > one.start.at/
timeout order|s/else if \(timeout !== undefined\) one\.row = 'D4'/else if (false) one.row = 'D4'/
digest gate|s/if \(digest !== passed\)/if (false)/
archive mode|s/\(held\.mode \& 0o077\) !== 0/false/
archive nesting|s/into\.startsWith\(from\)/false/
archive nesting back|s/from\.startsWith\(into\)/false/
no recheck|s/if \(changed !== undefined\)/if (false)/
recheck ignores window|s/after\.window === source\.window \&\& //
recheck ignores later|s/ \&\& after\.totals\.later === 0//
read back unchecked|s/sha\(back\) !== digest \|\| //
temporary kept|s/    unlinkSync\(partial\);//
overwrite|s/linkSync\(partial, join\(archive, STREAM\)\)/writeFileSync(join(archive, STREAM), body)/
marks leak|s/out\[mark\] = Object.hasOwn\(event, mark\) \&\& event\[mark\] !== false/out[mark] = event[mark]/
shape unchecked|s/if \(shape\(event\[field\]\)\)/if (true)/
fragment later|s/event === undefined \? opensLater\(line\)/event === undefined ? false/
top alone|s/if \(entry\.isDirectory\(\)\) walk\(join\(at, entry\.name\)\);/if (false);/
links followed|s/entry\.isFile\(\) \&\& entry\.name === STREAM/entry.name === STREAM/; s/ \| constants\.O_NOFOLLOW//
linked directory given|s/lstatSync\(directory\.replace\(/statSync(directory.replace(/
others by jsonl|s/entry\.name\.startsWith\('events'\)/entry.name.endsWith('.jsonl')/
streams by path|s/\(one\.events\[0\]\?\.ts \?\? ''\)\.localeCompare\(two\.events\[0\]\?\.ts \?\? ''\)/0/
repeated lines|s/holding\.size > 1/holding.size > 2/
merge claims|s/claims\.filter\(\(claim\) => !claim\.merging\)/claims/
redo released|s/earlier\.run !== claim\.run \&\& !earlier\.released/earlier.run !== claim.run/
redo same run|s/earlier\.run !== claim\.run \&\& !earlier/!earlier/
LIST
