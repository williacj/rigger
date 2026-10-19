// ABOUTME: Tests what the owner gives `rigger verdict` that it refuses: each row of the card's table
// B, run as its own process at a pseudo-terminal, posts nothing, names why, and exits non-zero.

import { test } from 'node:test';

import { PULL, assertRefused, atTerminal, world } from './verdict-world.mjs';

/** Long enough for a run at a terminal under a loaded host; a hung run fails rather than hangs. */
const BOUND = { timeout: 120_000 };

const pr = String(PULL);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** Table B: each refused input, the words after `verdict`, and what the refusal names. */
const TABLE_B = [
  ['no arguments', [], /no pull request number/],
  ['a pull request number of 0', ['0', 'sound'], /"0" is not a pull request number/],
  ['a negative pull request number', ['-3', 'sound'], /"-3" is not a pull request number/],
  ['a pull request number that is a word', ['twelve', 'sound'], /"twelve" is not a pull request number/],
  ['a pull request number that is a fraction', ['12.5', 'sound'], /"12.5" is not a pull request number/],
  ['a pull request number past a safe integer', ['99999999999999999999', 'sound'], /"99999999999999999999" is not a pull request number/],
  ['no verdict', [pr], /no verdict/],
  ['a verdict other than the three', [pr, 'approve'], /"approve" is no verdict.*R-VERDICT-2/],
  ['a verdict spelled as the marker writes it', [pr, 'needs revision', '--to-sound', 't'], /"needs revision" is no verdict/],
  ['sound with --unmet', [pr, 'sound', '--unmet', '1'], /R-VERDICT-4/],
  ['sound with --to-sound', [pr, 'sound', '--to-sound', 't'], /a sound verdict names nothing that would make it sound/],
  ['needs-revision with no --to-sound', [pr, 'needs-revision'], /--to-sound.*R-VERDICT-3/],
  ['critical with no --to-sound', [pr, 'critical', '--unmet', '1'], /--to-sound.*R-VERDICT-3/],
  ['an empty --to-sound', [pr, 'needs-revision', '--to-sound', ''], /--to-sound's value is empty/],
  ['a --to-sound of only whitespace', [pr, 'needs-revision', '--to-sound', ' \t '], /--to-sound's value is empty/],
  ['a --to-sound holding a line feed', [pr, 'needs-revision', '--to-sound', 'one\ntwo'], /--to-sound's value holds a line break/],
  ['a --to-sound holding a carriage return', [pr, 'critical', '--to-sound', 'one\rtwo'], /--to-sound's value holds a line break/],
  ['a --to-sound holding a line separator', [pr, 'critical', '--to-sound', `one${LINE_SEPARATOR}two`], /--to-sound's value holds a line break/],
  ['an empty --insufficient', [pr, 'sound', '--insufficient', ''], /--insufficient's value is empty/],
  ['an --insufficient of only whitespace', [pr, 'sound', '--insufficient', '   '], /--insufficient's value is empty/],
  ['an --insufficient holding a line feed', [pr, 'sound', '--insufficient', 'one\ntwo'], /--insufficient's value holds a line break/],
  ['an --insufficient holding a paragraph separator', [pr, 'sound', '--insufficient', `one${PARAGRAPH_SEPARATOR}two`], /--insufficient's value holds a line break/],
  ['--insufficient with no value, last', [pr, 'sound', '--insufficient'], /--insufficient is given no value/],
  ['--insufficient with no value, before another option', [pr, 'needs-revision', '--insufficient', '--to-sound', 't'], /--insufficient is given no value/],
  ['an --unmet value that is a word', [pr, 'critical', '--to-sound', 't', '--unmet', 'two'], /--unmet "two" is not item numbers/],
  ['an --unmet value that is empty', [pr, 'critical', '--to-sound', 't', '--unmet', ''], /--unmet "" is not item numbers/],
  ['an --unmet value with a trailing comma', [pr, 'critical', '--to-sound', 't', '--unmet', '1,'], /--unmet "1," is not item numbers/],
  ['an --unmet value with spaces', [pr, 'critical', '--to-sound', 't', '--unmet', '1, 2'], /--unmet "1, 2" is not item numbers/],
  ['an --unmet value naming a negative number', [pr, 'critical', '--to-sound', 't', '--unmet', '-1'], /--unmet "-1" is not item numbers/],
  ['an --unmet value naming 0', [pr, 'critical', '--to-sound', 't', '--unmet', '0'], /--unmet names item 0/],
  ['an --unmet value naming a number past the acceptance\'s four items', [pr, 'critical', '--to-sound', 't', '--unmet', '2,5'], /--unmet names item 5, and card #7's acceptance holds 4 items/],
  ['an --unmet value naming one number twice', [pr, 'critical', '--to-sound', 't', '--unmet', '2,3,2'], /--unmet names item 2 twice/],
  ['--to-sound given twice', [pr, 'needs-revision', '--to-sound', 'a', '--to-sound', 'b'], /--to-sound is given twice/],
  ['--unmet given twice', [pr, 'critical', '--to-sound', 't', '--unmet', '1', '--unmet', '2'], /--unmet is given twice/],
  ['--insufficient given twice', [pr, 'sound', '--insufficient', 'r', '--insufficient', 'r'], /--insufficient is given twice/],
  ['an option the verb does not name', [pr, 'sound', '--yes'], /"--yes" is an option it does not name/],
  ['an option written with its value after =', [pr, 'needs-revision', '--to-sound=t'], /"--to-sound=t" is an option it does not name/],
  ['an argument past those it names', [pr, 'sound', 'extra'], /"extra" is an argument past those it names/],
];

for (const [name, args, reason] of TABLE_B) {
  test(`table B: ${name} posts nothing, names why, and exits non-zero`, BOUND, async () => {
    const where = world();
    const before = where.comments();

    const ran = await atTerminal(where, args);

    assertRefused(where, ran, before, reason);
  });
}
