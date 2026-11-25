ABOUTME: Records why the pre-push content check reads lines as a set, and what its tests found first.

# The pre-push content check

The check compares each file's lines with its parents' as sets, in three encodings, rather than
reading a diff. Attributes can mark a file binary and hide a diff's lines, and a merge's own lines
are then the lines in none of its parents. The cost is a moved or repeated line in one file, which
its parent already holds and the check does not read again. A renamed file reads as added whole.

An address is found by walking out from each at-sign. Matching the whole pattern from every
character is quadratic on one long line with no at-sign, which evidence files hold.

A refusal prints a path only where no row refuses it and no entry stands anywhere inside it.
