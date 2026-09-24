// ABOUTME: Tests the PreToolUse command gate as Claude Code runs it — as a process fed a hook
// ABOUTME: payload, for the exit code and the reason it returns on reserved and on unreadable text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude',
  'hooks',
  'refuse-reserved-git-commands.mjs',
);

/**
 * Run the gate the way the hook runs it: a real process, the real payload shape, stdin to stdout.
 *
 * What the gate promises is an exit code and a decision, and nothing short of running it as a
 * process observes either. `exit 2` is the blocking code Claude Code reads; `exit 0` steps aside.
 */
function rule(command) {
  const result = spawnSync(process.execPath, [gate], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  return { code: result.status, reason: result.stderr.trim(), decision: result.stdout };
}

const permits = (command, why) => {
  const { code, reason } = rule(command);
  assert.equal(code, 0, `the gate refused (${reason}) where it should have stepped aside: ${why}`);
};

const refuses = (command, why) => {
  const { code, decision } = rule(command);
  assert.equal(code, 2, `the gate permitted a command it should have refused: ${why}`);
  assert.match(decision, /"permissionDecision":"deny"/, 'the decision was not a deny');
};

/** A command written over several lines. Joined here so the source has no literal line breaks,
 * which a checkout on a machine that rewrites them would otherwise turn into `\r\n`. */
const lines = (...parts) => parts.join('\n');

/**
 * Every spelling of a reserved command this gate knows, and the reason it names for each.
 *
 * Read off `AGENTS.md`'s reservations and git's own documented options rather than off the gate,
 * and exported so the proof table in the pull request can be produced from the same list the
 * suite asserts on. Skipping a here-document body must cost none of these.
 */
export const RESERVED_SPELLINGS = [
  'git commit --no-verify',
  'git commit -n -m msg',
  'git commit -am msg --no-verify',
  'git commit -anm msg',
  'git push --no-verify',
  'git push --force',
  'git push -f origin main',
  'git push --force-with-lease',
  'git push --force-with-lease=main',
  'git push --force-if-includes',
  'git push --delete origin topic',
  'git push -d origin topic',
  'git push origin +main',
  'git push origin :topic',
  'git branch --delete topic',
  'git branch -d topic',
  'git branch -D topic',
  'git push --force-with-lease=main:abc',
  'git -c core.hooksPath=/dev/null commit -m msg',
  'git -c user.name=x push --force',
  'git --config-env=core.hooksPath=NOWHERE commit -m msg',
  'git --config-env core.hooksPath=NOWHERE commit -m msg',
  'git -C /tmp push --force',
  'git --git-dir=.git push --force',
  'GIT_AUTHOR_DATE=now git push --force',
  'env git push --force',
  'env GIT_X=1 env git commit --no-verify',
  '/usr/bin/git push --force',
  'git.exe push --force',
  'bash -c "git push --force"',
  'sh -lc \'git commit --no-verify\'',
  'zsh -c "git push --force"',
  'dash -c "git branch -D topic"',
  'echo ready && git push --force',
  // Reserved commands that themselves open a here-document, or stand beside one. Skipping the
  // body must cost neither the words before it nor the words after it on the same line.
  lines("git push --force <<'EOF'", "a note that's beside the point", 'EOF'),
  lines('git commit -m << EOF --no-verify', 'a message', 'EOF'),
  lines("cat > notes.md <<'EOF'", "don't", 'EOF', 'git branch -D topic'),
];

/**
 * Payloads that put `<<WORD` where bash reads no command word, the reserved command on the lines
 * after it, and a line reading `WORD` at the end. Bash ignores the `<<` and runs the command on
 * line two. A gate that honours the `<<` skips all of it as body data and never sees the command.
 *
 * Every one was run under bash with `git` replaced by a marker on `PATH`, and bash ran the marker
 * in every one. The region each uses is named from the enumeration in the gate's own source.
 */
export const INERT_REGION_PAYLOADS = [
  ['a comment at the end of a line', lines('echo hi # <<X', 'git push --force', 'X')],
  ['a comment that is the whole line', lines('# <<Z', 'git push -f origin main', 'Z')],
  ['a comment before a commit -n', lines('true # <<N', 'git commit -n -m x', 'N')],
  ['a comment whose delimiter is `git`', lines('echo a # <<git', 'git push --force', 'git')],
  [
    'a real here-document with a comment after it',
    lines('cat <<EOF # <<Y', 'body', 'EOF', 'git push --force', 'Y'),
  ],
  ['an arithmetic command', lines('(( 1 << x ))', 'git push --force', 'x')],
  ['an arithmetic command, closed up', lines('((1<<x))', 'git push --force', 'x')],
  ['an arithmetic command after if', lines('if (( 1 << n )); then :; fi', 'git push --force', 'n')],
  [
    'an arithmetic command in a for header',
    lines('for (( i=0; i<<n; i++ )); do :; done', 'git push --force', 'n'),
  ],
  [
    'an arithmetic command after while',
    lines('while (( 1 << n )); do break; done', 'git push --force', 'n'),
  ],
  // These five close on ``W` ``, `W}` or `W]` rather than on `W`, because the delimiter word bash
  // reads runs to a metacharacter and a backtick, `}` and `]` are not metacharacters — so the
  // delimiter is ``W` `` and the closing line must be spelled the same way. Written with a bare
  // `W` they are refused by the accident of no line matching the delimiter, which is no control.
  ['a backtick substitution', lines('echo `cat <<W`', 'git push --force', 'W`')],
  ['a parameter expansion', lines('echo ${x:-<<W}', 'git push --force', 'W}')],
  ['a nested parameter expansion', lines('echo ${x:-${y:-<<W}}', 'git push --force', 'W}}')],
  ['a pattern substitution', lines('echo ${x//<<W/}', 'git push --force', 'W/}')],
  ['the old $[ ] arithmetic form', lines('echo $[1<<W]', 'git push --force', 'W]')],
];

/**
 * Payloads whose here-document closes on a line ending in a carriage return. Bash ends the body
 * at that line and runs the command after it — measured on this machine under Git-for-Windows
 * bash, from a file, with `git` replaced by a marker on `PATH`, for every shape below. A gate that
 * reads the body as continuing past it skips a reserved command bash goes on to run.
 *
 * Written out rather than built with `lines`, because that helper joins on a line feed and so
 * keeps a carriage return out of this file by construction. These are the only payloads in the
 * suite carrying a literal `\r`, and they are the reason the helper is not used here.
 */
export const CARRIAGE_RETURN_PAYLOADS = [
  ['a closing line ending CRLF, opener LF', 'cat <<W\nbody\nW\r\ngit push --force\nW\n'],
  ['every line ending CRLF', 'cat <<W\r\nbody\r\nW\r\ngit push --force\r\nW\r\n'],
  ['opener CRLF, closing line LF', 'cat <<W\r\nbody\r\nW\ngit push --force\nW\n'],
  ['the <<- form, CRLF and a tab', 'cat <<-W\r\n\tbody\r\n\tW\r\ngit push --force\r\nW\r\n'],
  ['a quoted delimiter, CRLF', "cat <<'W'\r\nbody\r\nW\r\ngit push --force\r\nW\r\n"],
  ['a carriage return inside the body', 'cat <<W\nbo\rdy\nW\ngit push --force\n'],
  // Bash's rule is a run of carriage returns before the line feed, not one: `\r*\n`. Each depth
  // is pinned, because a guard that strips a fixed number closes only the depth it was written
  // for and leaves the rest open, which is exactly what one carriage return's worth of fix did.
  ['two carriage returns', 'cat <<W\nbody\nW\r\r\ngit push --force\nW\n'],
  ['three carriage returns', 'cat <<W\nbody\nW\r\r\r\ngit push --force\nW\n'],
  ['four carriage returns', 'cat <<W\nbody\nW\r\r\r\r\ngit push --force\nW\n'],
  ['a CRLF opener and two carriage returns', 'cat <<W\r\nbody\r\nW\r\r\ngit push --force\nW\n'],
  ['the <<- form with two carriage returns', 'cat <<-W\r\n\tbody\r\n\tW\r\r\ngit push --force\nW\n'],
  ['a quoted delimiter with two carriage returns', "cat <<'W'\r\nbody\r\nW\r\r\ngit push --force\nW\n"],
];

/**
 * The other side of the same rule: what a run of carriage returns does NOT include. Bash closes a
 * body on `delimiter` followed by carriage returns and nothing else, so a trailing space or tab
 * leaves the body open and the `git push --force` below stays body data — measured, and bash does
 * not run the marker in any of these. The gate agrees, so it permits them.
 *
 * Pinned because the obvious over-correction for B1 is to trim the line. Trimming whitespace would
 * close these bodies early, surface the push as a command and refuse — safe, but no longer what
 * bash does, and a divergence nothing else in the suite would catch.
 */
export const NOT_A_LINE_ENDING = [
  ['a trailing space', 'cat <<W\nbody\nW \ngit push --force\nW\n'],
  ['a trailing tab', 'cat <<W\nbody\nW\t\ngit push --force\nW\n'],
  ['a carriage return then a space', 'cat <<W\nbody\nW\r \ngit push --force\nW\n'],
  ['a space then a carriage return', 'cat <<W\nbody\nW \r\ngit push --force\nW\n'],
];

/** Commands the gate cannot read, which it refuses rather than guess at. */
export const UNREADABLE_COMMANDS = [
  "echo don't",
  'echo "unclosed',
  lines("cat <<'EOF'", 'a body that never ends'),
  'cat <<EOF',
  'echo $(( 1 + 1',
  'echo $(git status',
  lines("cat <<'EOF'", 'a body that ends', 'EOF', "echo don't"),
  // A body that runs out with the text, in the shape a here-document is usually written in: the
  // last line ends with a line feed. The two above end without one, and reach a different guard.
  lines('cat <<EOF', 'a body that never ends', ''),
  lines('cat <<EOF', 'git push --force', ''),
  'echo `git status',
  // A `<<` inside a word, where bash begins no redirection and this gate places none.
  lines('cat foo<<EOF', 'body', 'EOF'),
  lines('a=1<<W', 'git push --force', 'W'),
  lines('let x=1<<W', 'git push --force', 'W'),
];

/**
 * A `<<` written directly after another redirection. Bash ends a word at `<` and `>`, so it
 * begins a redirection straight after the previous one's target and every shape here is a
 * here-document to bash, which runs the push after it — measured, from a file, with `git` replaced
 * by a marker on `PATH`. This gate places none of them and refuses.
 *
 * Pinned rather than fixed, deliberately. Honouring a `<<` because the word it sits in began with
 * a redirection also honours `echo >${x:-<<W}`, where bash reads no redirection and runs what
 * follows; that shape is in `INERT_REGION_PAYLOADS`' family and the measurement is in the pull
 * request. Widening the rule to the target would trade a refusal for a bypass. These tests exist
 * so that trade cannot be made by accident: changing the placement rule turns them red.
 */
export const AFTER_A_REDIRECTION = [
  ['cat >out<<EOF', lines('cat >out<<EOF', 'body', 'EOF', 'git push --force')],
  ['cat >>out<<EOF', lines('cat >>out<<EOF', 'body', 'EOF', 'git push --force')],
  ['cat 2>/dev/null<<EOF', lines('cat 2>/dev/null<<EOF', 'body', 'EOF', 'git push --force')],
  ['cat </dev/null<<EOF', lines('cat </dev/null<<EOF', 'body', 'EOF', 'git push --force')],
  ['cat <<A<<B', lines('cat <<A<<B', 'first', 'A', 'second', 'B', 'git push --force')],
];

test('an apostrophe in a here-document body does not make the command unreadable', () => {
  // The defect this card fixes. A here-document body is data on standard input, so an apostrophe
  // in it is a character in a message, not a quote opening shell text.
  permits(
    "cat > notes.md <<'EOF'\ndon't\nEOF",
    'an apostrophe inside a here-document body is prose, not a quote',
  );
});

test('an arithmetic expansion is not a here-document, however it is spaced', () => {
  // `<<` inside `$(( ))` is bash's left shift. Reading it as a redirection would take the rest of
  // the command for a body, which is how skipping a body could come to hide a command.
  permits('echo $((1<<2)) && echo done', 'a left shift written closed up');
  permits('echo $(( 1 << 2 )) && echo done', 'a left shift written with blanks around it');
  refuses(
    'echo $(( 1 << 2 )) && git push --force',
    'a force push after an arithmetic expansion is still a force push',
  );
});

test('a here-document inside a command substitution is read as a here-document', () => {
  // The shape the card quotes, and the one a commit message is usually written in. `$( )` is a
  // command in its own right even inside double quotes, so the `<<` in it opens a real body.
  permits(
    lines("git commit -m \"$(cat <<'EOF'", 'it is 3" wide, and it\'s heavy', 'EOF', ')"'),
    'a body inside a substitution is data, whatever quoting characters it contains',
  );
  // And the other half: what follows the substitution is still the same command, so a flag after
  // it is still that command's flag. Skipping the body must not lose the words around it.
  refuses(
    lines("git commit -m \"$(cat <<'EOF'", 'a message', 'EOF', ')" --no-verify'),
    'a commit that skips the hooks, written after a substituted here-document',
  );
  refuses(
    'git commit -m "$(echo a; echo b)" --no-verify',
    'a commit that skips the hooks, written after a substitution containing an operator',
  );
});

test('every here-document form bash accepts opens a body the gate skips', () => {
  // Bash owns what a here-document is, and these are the forms it accepts: a quoted delimiter, an
  // unquoted one, a partly quoted one, a backslashed one, `<<-`, and a delimiter set off by
  // blanks. Each body below would be unreadable shell text if the gate still lexed it as shell.
  const body = "it's data";
  permits(lines("cat <<'EOF'", body, 'EOF'), 'a single-quoted delimiter');
  permits(lines('cat <<"EOF"', body, 'EOF'), 'a double-quoted delimiter');
  permits(lines('cat <<EOF', body, 'EOF'), 'an unquoted delimiter');
  permits(lines('cat <<E"O"F', body, 'EOF'), 'a partly quoted delimiter');
  permits(lines('cat <<\\EOF', body, 'EOF'), 'a backslashed delimiter');
  permits(lines('cat << EOF', body, 'EOF'), 'a delimiter set off by a blank');
  permits(lines('cat <<-EOF', `\t${body}`, '\tEOF'), 'the <<- form, which strips leading tabs');
  permits(lines('cat <<A <<B', body, 'A', body, 'B'), 'two here-documents opened on one line');
  permits(lines('cat 0<<EOF', body, 'EOF'), 'a here-document on an explicit file descriptor');
  // A here-string is the form that is not a here-document: its data is on the line, so it opens
  // no body, and reading it as one would skip everything after it.
  permits('cat <<<"it\'s data" && echo done', 'a here-string, which opens no body');
});

test('a reserved spelling written as prose in a here-document body is prose', () => {
  // Nothing in a body can become a command, so the words in one are never the gate's business.
  permits(
    lines("cat > notes.md <<'EOF'", 'Never run git push --force on this branch.', 'EOF'),
    'a reserved spelling quoted in a note',
  );
  permits(
    lines('gh pr create --body-file - <<EOF', 'We considered git commit --no-verify.', 'EOF'),
    'a reserved spelling discussed in a pull request body',
  );
});

test('a reserved command after a here-document body is still refused', () => {
  // The other side of skipping a body: the body ends at its delimiter and what follows it is a
  // command again. Before this change an odd apostrophe in a body could swallow one of these.
  refuses(
    lines("cat > notes.md <<'EOF'", "don't", 'EOF', 'git push --force'),
    'a force push on the line after a here-document body ends',
  );
  refuses(
    lines("cat > notes.md <<'EOF'", "don't", 'EOF', "echo it's", 'git push --force'),
    'a force push after a body whose apostrophes would once have paired with a later one',
  );
});

test('every reserved spelling is refused', () => {
  // The floor under the change: what the gate refused before it must refuse after it.
  for (const command of RESERVED_SPELLINGS) {
    refuses(command, `the reserved spelling \`${command}\``);
  }
});

test('a `<<` where bash reads no command word hides nothing', () => {
  // The gate's notion of where a here-document can open must not exceed bash's. Where it does, a
  // `<<` the gate honours and bash ignores skips the commands after it, and the gate never sees
  // them. Each payload's reserved command is one bash runs.
  for (const [region, command] of INERT_REGION_PAYLOADS) {
    refuses(command, `a reserved command hidden behind a \`<<\` in ${region}`);
  }
});

test('a body ends where bash ends it, whatever the line ending', () => {
  // A body the gate reads as continuing past the line bash closed it at is a gap a reserved
  // command lands in. CRLF is live in this repository: the gate's own worktree copy has it.
  for (const [shape, command] of CARRIAGE_RETURN_PAYLOADS) {
    refuses(command, `a force push after a here-document closed by ${shape}`);
  }
  // And the body stays open where bash keeps it open, so the push stays data rather than becoming
  // a command. These fail if the line ending is read as trailing whitespace rather than as
  // carriage returns.
  for (const [shape, command] of NOT_A_LINE_ENDING) {
    permits(command, `a here-document whose closing line has ${shape}, which closes no body`);
  }
});

test('a here-document written CRLF throughout is read, not refused', () => {
  // The delimiter side of the line-ending rule, tested for what it permits rather than for what
  // it refuses. Every payload above carries a reserved command and asserts a refusal, so all of
  // them still refuse with this half deleted — as unreadable instead of as reserved. A refusal by
  // accident reads exactly like a control, so only a `permits` assertion pins this half: with the
  // delimiter left unstripped, a CRLF opener makes the delimiter `EOF\r`, no line ever matches it,
  // and every here-document written on a CRLF machine is refused as having no closing delimiter —
  // this card's own defect in CRLF clothing.
  permits(
    "cat > notes.md <<'EOF'\r\nIt is the author's to change.\r\nEOF\r\n",
    'a CRLF here-document with a quoted delimiter and prose in the body',
  );
  permits(
    'cat > notes.md <<EOF\r\ndon\'t\r\nEOF\r\n',
    'a CRLF here-document with an unquoted delimiter',
  );
  permits(
    'cat > notes.md <<-EOF\r\n\tdon\'t\r\n\tEOF\r\n',
    'a CRLF here-document in the <<- form',
  );
  permits(
    'git commit -m "$(cat <<\'EOF\'\r\nIt is the author\'s to change.\r\nEOF\r\n)"',
    'a CRLF here-document inside a command substitution',
  );
});

test('a `<<` directly after a redirection is refused, not skipped', () => {
  // One removed space is the difference: the spaced form is a here-document the gate reads, and
  // the closed-up form is one it cannot place. Refusing is the cost; permitting the body would be
  // the hole. The spaced form is asserted alongside so the pair is visible.
  for (const [shape, command] of AFTER_A_REDIRECTION) {
    refuses(command, `a \`<<\` directly after a redirection, in \`${shape}\``);
  }
  permits(
    lines('cat >out <<EOF', 'body', 'EOF'),
    'the same redirection with a blank before the `<<`',
  );
});

test('a `#` bash does not read as a comment hides nothing', () => {
  // A comment begins at the start of a word, and quoting starts a word without putting anything
  // in the token. Miss that and `''#` reads as a comment, taking the rest of its line with it.
  // Bash runs the push in both of these; it was run under bash to check.
  refuses("echo ''#x ; git push --force", "a `#` after '' is part of a word, not a comment");
  refuses('echo ""#x ; git push --force', 'a `#` after "" is part of a word, not a comment');
});

test('a command the gate cannot read is refused', () => {
  // Failing closed is the gate's other promise, and skipping a body must not become a way to
  // stop reading. A body with no closing delimiter is unread text, so it is unreadable text.
  for (const command of UNREADABLE_COMMANDS) {
    refuses(command, `the unreadable command \`${command}\``);
  }
});

/**
 * A reserved git spelling reached through a shell keyword. `commandsIn` splits on operators, so a
 * keyword is the first word of its command and the git invocation is the second or later word —
 * and the rule that decides whether a command is git at all reads the first word. Bash runs the
 * reserved command in every payload below: each was run under bash from a file with `git` replaced
 * by a marker on `PATH`, and bash ran the marker in every one. The measurement is in the pull
 * request, and the constructs the card names are the first six rows.
 *
 * The third column is the spelling the refusal must name, read off `AGENTS.md`'s three
 * reservations rather than off the gate. A refusal that stopped naming what it found would still
 * be a deny, so the deny alone is no test of it.
 */
export const KEYWORD_CONSTRUCT_PAYLOADS = [
  ['a brace group', '{ git push --force; }', 'a force push'],
  ['if / then', 'if true; then git push --force; fi', 'a force push'],
  ['for / do', 'for x in 1; do git branch -D topic; done', 'deleting a branch'],
  ['while / do', 'while true; do git push -f; break; done', 'a force push'],
  ['case', 'case x in x) git push --force;; esac', 'a force push'],
  ['a group after &&', 'true && { git commit --no-verify -m x; }', 'a commit that skips the hooks'],
  // The rest of the keyword family, enumerated from bash's reserved words rather than from the
  // card's table, because a keyword left out is a bypass this gate cannot see.
  ['a git condition after if', 'if git push --force; then :; fi', 'a force push'],
  ['if / else', 'if false; then :; else git push --force; fi', 'a force push'],
  ['if / elif / then', 'if false; then :; elif true; then git push --force; fi', 'a force push'],
  [
    'a git condition after elif',
    'if false; then :; elif git push --force; then :; fi',
    'a force push',
  ],
  ['for / do, an arithmetic header', 'for ((i=0;i<1;i++)); do git push -f; done', 'a force push'],
  ['select / do', "printf '1\\n' | { select x in 1; do git push -f; break; done; }", 'a force push'],
  ['a git condition after while', 'while git push -f; do break; done', 'a force push'],
  ['until / do', 'until false; do git push -f; break; done', 'a force push'],
  ['a git condition after until', 'until git push -f; do break; done', 'a force push'],
  ['case, a later branch', 'case x in a) git status;; x) git push --force;; esac', 'a force push'],
  ['case, a parenthesised pattern', 'case x in (x) git push --force;; esac', 'a force push'],
  ['case, a pattern set off by blanks', 'case x in x ) git push --force ;; esac', 'a force push'],
  // The same blank, in a branch after the first. The `case` word is on the command before this
  // one, so the pattern is the whole of what stands before the body and the `)` is its own word.
  [
    'case, a later branch whose pattern is set off by blanks',
    'case x in a) :;; x ) git push --force;; esac',
    'a force push',
  ],
  ['case, an alternation', 'case x in a|x) git push --force;; esac', 'a force push'],
  ['case, a quoted pattern', "case x in 'a)b') :;; x) git push -f;; esac", 'a force push'],
  ['case, a fall-through pattern', 'case x in a) :;& x) git push --force;; esac', 'a force push'],
  ['case on a substitution', 'case $(echo x) in x) git push --force;; esac', 'a force push'],
  ['a group after ||', 'false || { git push -f; }', 'a force push'],
  ['a group in a pipeline', '{ git push --force; } | cat', 'a force push'],
  ['nested groups', '{ { git push --force; }; }', 'a force push'],
  ['a group after then', 'if true; then { git push --force; }; fi', 'a force push'],
  [
    'a construct inside a loop',
    'while :; do if true; then git push -f; fi; break; done',
    'a force push',
  ],
  ['negation', '! git push --force', 'a force push'],
  ['negation twice', '! ! git push --force', 'a force push'],
  ['negation of a group', '! { git push --force; }', 'a force push'],
  ['time', 'time git push --force', 'a force push'],
  ['time -p', 'time -p git push --force', 'a force push'],
  ['time --', 'time -- git push --force', 'a force push'],
  ['time of a group', 'time { git push --force; }', 'a force push'],
  ['coproc', 'coproc git push --force', 'a force push'],
  ['coproc of a named group', 'coproc c { git push --force; }', 'a force push'],
  ['a function definition', 'f() { git push --force; }', 'a force push'],
  ['the function keyword', lines('function f { git push --force; }', 'f'), 'a force push'],
  [
    'the function keyword with parentheses',
    lines('function f() { git push --force; }', 'f'),
    'a force push',
  ],
  ['an assignment inside a group', '{ x=1 git push --force; }', 'a force push'],
  ['env inside a construct', 'if true; then env git push --force; fi', 'a force push'],
  ['a group inside bash -c', "bash -c '{ git push --force; }'", 'a force push'],
];

/**
 * The other side of the same rule: keyword constructs the gate must go on permitting. Bash runs no
 * reserved git command in any of these — measured the same way, with `git` shadowed by a marker —
 * and two of them carry the *text* of a reserved spelling where bash reads a word list or an
 * argument rather than a command. A rule wide enough to refuse those has stopped following bash,
 * which is how card #71 traded refusals for bypasses.
 */
export const KEYWORD_CONSTRUCTS_CARRYING_NOTHING_RESERVED = [
  ['a brace group', '{ git status; }'],
  ['if / then', 'if true; then git status; fi'],
  ['for / do', 'for x in 1; do git log --oneline -1; done'],
  ['case', 'case x in x) git status;; esac'],
  ['the case word spelled git', 'case git in git) echo ok;; esac'],
  ['a for word list spelled like a force push', 'for x in git push --force; do :; done'],
  ['a keyword written as an argument', 'echo then git push --force'],
  ['an awk program in braces', "echo a | awk '{print $1}'"],
  ['a jq program in braces', "echo {} | jq '{a:1}'"],
  ['xargs with a brace placeholder', 'echo x | xargs -I{} echo {}'],
  ['a git format string holding a parenthesis', "git log --format='%h) %s' -1"],
  ['time of a command carrying nothing reserved', 'time git status'],
  ['negation of a command carrying nothing reserved', '! git diff --quiet'],
  ['a function definition carrying nothing reserved', 'f() { git status; }'],
  ['a [[ ]] test beside a command carrying nothing reserved', '[[ -n x ]] && git status'],
];

test('a reserved git spelling inside a shell keyword construct is refused', () => {
  // Every shape here was fail-open: the gate permitted and bash ran the reserved command. A
  // keyword is the first word of the command the operator split, so the git invocation is never
  // word one and the rule that reads word one never looks at it.
  for (const [construct, command, spelling] of KEYWORD_CONSTRUCT_PAYLOADS) {
    refuses(command, `a reserved spelling reached through ${construct}`);
    const { reason } = rule(command);
    assert.ok(
      reason.includes(spelling),
      `the refusal for ${construct} did not name the spelling it found (${spelling}): ${reason}`,
    );
  }
});

test('a keyword construct carrying nothing reserved is still permitted', () => {
  // The floor under the fix. Reaching past a keyword must not become reaching past anything: bash
  // runs no reserved git command in any of these, and neither a word list nor an argument that
  // reads like one is a command.
  for (const [shape, command] of KEYWORD_CONSTRUCTS_CARRYING_NOTHING_RESERVED) {
    permits(command, `${shape}, which bash runs no reserved git command from`);
  }
});

/**
 * A reserved git spelling behind a **redirection word**. Bash allows a redirection wherever it
 * reads a command's words, before the program as freely as after it, so the program is not word
 * one in any of these and bash runs the reserved command in every one — measured under bash from
 * a file with `git` shadowed by a marker on `PATH`.
 *
 * The two rows that name `env` and an assignment are the sharpest: `env git push --force` and
 * `X=1 git push --force` were refused before this table existed, and inserting a redirection
 * between the prefix and the program defeated that. So a redirection is not a family beside the
 * words already stepped over — it is a gap in the middle of them.
 */
export const REDIRECTION_PAYLOADS = [
  ['a brace group and `>out`', '{ >/dev/null git push --force; }', 'a force push'],
  ['a brace group and `<in`', '{ </dev/null git push --force; }', 'a force push'],
  ['an explicit file descriptor', '{ 1>/dev/null git push --force; }', 'a force push'],
  ['a here-string', '{ <<<x git push --force; }', 'a force push'],
  // Each operator below is written with a blank as well as closed up. Only the spaced spelling
  // leaves the operator as a word of its own, and only then does its length decide whether the
  // target is this word or the next — so the closed-up form alone pins none of them.
  ['a here-string with a blank', '{ <<< x git push --force; }', 'a force push'],
  ['an input redirection with a blank', '{ < /dev/null git push --force; }', 'a force push'],
  ['a descriptor duplication on standard input', '{ <&0 git push --force; }', 'a force push'],
  ['a descriptor duplication on standard input, spaced', '{ <& 0 git push --force; }', 'a force push'],
  ['`2>&1` after then', 'if true; then 2>&1 git push --force; fi', 'a force push'],
  ['a case body', 'case x in x) >/dev/null git push --force;; esac', 'a force push'],
  ['a target in the next word', '{ > /dev/null git push --force; }', 'a force push'],
  ['a descriptor and a target in the next word', '{ 2> /dev/null git push --force; }', 'a force push'],
  ['the append form', '{ >> /dev/null git push --force; }', 'a force push'],
  ['a descriptor duplication', '{ >&2 git push --force; }', 'a force push'],
  ['a descriptor duplication, spaced', '{ >& 2 git push --force; }', 'a force push'],
  ['the read-write form', '{ <> /dev/null git push --force; }', 'a force push'],
  ['the clobber form', '{ >| /dev/null git push --force; }', 'a force push'],
  ['the clobber form, closed up', '{ >|/dev/null git push --force; }', 'a force push'],
  ['a descriptor named in braces', '{ {fd}>/dev/null git push --force; }', 'a force push'],
  ['after env', 'env >/dev/null git push --force', 'a force push'],
  ['after an assignment', 'X=1 >/dev/null git push --force', 'a force push'],
  ['before an assignment', '{ >/dev/null X=1 git push --force; }', 'a force push'],
  ['no keyword at all', '>/dev/null git push --force', 'a force push'],
  ['two redirections', '{ <<<x >/dev/null git push --force; }', 'a force push'],
  ['a for body', 'for x in 1; do >/dev/null git branch -D t; done', 'deleting a branch'],
  ['a while body', 'while true; do >/dev/null git push -f; break; done', 'a force push'],
  ['an until body', 'until false; do >/dev/null git push -f; break; done', 'a force push'],
  ['after negation', '! >/dev/null git push --force', 'a force push'],
  ['after time', 'time >/dev/null git push --force', 'a force push'],
];

/**
 * A reserved git spelling behind a **program that runs a command named in its arguments**. `env`
 * was the only one the gate stepped over, and its own options defeated even that.
 *
 * Each option grammar here is the program's own rather than bash's, so the gate reads every word
 * after the prefix as a possible command start instead of modelling any of them. That reads more
 * words than bash runs and can only add a refusal, because it objects only where the words from
 * one of them on spell a reserved command — which is why `nohup echo git status` stays permitted.
 *
 * `eval` is the exception: it joins its arguments and runs the result as shell text, so no one
 * word is the command and the text is re-read the way a shell's `-c` argument already is. `env -S`
 * is the same exception for the same reason — it carries the whole command inside **one word**, so
 * no word after the prefix is the program and reading every word reaches nothing.
 *
 * Which of these bash could be watched running git is a fact about this host, not about the gate.
 * The pull request records, with bash's own message for each, the ones that were absent here, and
 * the two whose prefix resets `PATH` so that bash reported `git: command not found` — proof it
 * resolved the prefix and went looking for git.
 */
export const PREFIX_PROGRAM_PAYLOADS = [
  ['command', '{ command git push --force; }', 'a force push'],
  ['command -p', '{ command -p git push --force; }', 'a force push'],
  ['eval, single-quoted', "{ eval 'git push --force'; }", 'a force push'],
  ['eval, double-quoted', '{ eval "git push --force"; }', 'a force push'],
  ['eval, unquoted', '{ eval git push --force; }', 'a force push'],
  ['eval of a brace group', "eval '{ git push --force; }'", 'a force push'],
  ['exec', '{ exec git push --force; }', 'a force push'],
  ['nohup', '{ nohup git push --force; }', 'a force push'],
  ['nice', '{ nice git push --force; }', 'a force push'],
  ['nice -n, whose option takes a value', '{ nice -n 10 git push --force; }', 'a force push'],
  ['timeout, whose first operand is a duration', 'timeout 5 git push --force', 'a force push'],
  ['timeout in a brace group', '{ timeout 5 git push --force; }', 'a force push'],
  ['stdbuf -o0', 'stdbuf -o0 git push --force', 'a force push'],
  ['stdbuf -o 0', 'stdbuf -o 0 git push --force', 'a force push'],
  ['env -u, whose option takes a value', 'env -u FOO git push --force', 'a force push'],
  ['env -i, which resets PATH', 'env -i git push --force', 'a force push'],
  ['xargs fed a word', 'echo origin | xargs git push --force', 'a force push'],
  ['a chain of three prefixes', 'nohup env nice git push --force', 'a force push'],
  ['setsid', 'setsid git push --force', 'a force push'],
  ['sudo', 'sudo git push --force', 'a force push'],
  ['sudo of a shell', "sudo bash -c 'git push --force'", 'a force push'],
  ['flock, whose first operand is a lock file', 'flock /tmp/rigger.lock git push --force', 'a force push'],
  ['ionice', 'ionice git push --force', 'a force push'],
  ['taskset -c, whose option takes a value', 'taskset -c 0 git push --force', 'a force push'],
  ['time as a program rather than the keyword', '/usr/bin/time git push --force', 'a force push'],
  ['chrt -f, whose option takes a value', 'chrt -f 1 git push --force', 'a force push'],
  ['doas', 'doas git push --force', 'a force push'],
  ['unbuffer', 'unbuffer git push --force', 'a force push'],
  ['three prefixes and then a shell', "nohup env nice bash -c 'git push --force'", 'a force push'],
  // A prefix is not a shell, so it must not spend the budget for reading inside one. A prefix
  // *inside* a shell is the shape that says so, and the chain above is not: the scan reads every
  // word after the outermost prefix, so the `bash -c` that follows two more prefixes is reached
  // from the outermost one and never needs the budget. Here the shell is already one level down,
  // so counting the prefix against the budget leaves the script unread and bash runs the push.
  ['a prefix inside a shell, before another shell', 'bash -c \'nohup bash -c "git push --force"\'', 'a force push'],
  // `env -S` / `--split-string`. The option's argument is the whole command, so the words after
  // the prefix are one word that is no program. Six spellings of the option, because each is a
  // separate reading: the argument closed up against a short option, set off from it, after the
  // long name's `=`, set off from the long name, clustered behind a flag that takes no value, and
  // behind an option that takes one.
  ['env -S, the command closed up in one word', "env -S'git push --force'", 'a force push'],
  ['env -S, the command in the next word', "env -S 'git push --force'", 'a force push'],
  ['env --split-string=', "env --split-string='git push --force'", 'a force push'],
  ['env --split-string, the command in the next word', "env --split-string 'git push --force'", 'a force push'],
  ['env -S clustered behind a flag', "env -vS'git push --force'", 'a force push'],
  ['env -S behind an option that takes a value', "env -u FOO -S'git push --force'", 'a force push'],
  ['env -S named by its path', "/usr/bin/env -S'git push --force'", 'a force push'],
  // The card's six constructs, each around an `env -S` rather than around a bare git invocation,
  // and each a measured bypass of its own: the construct is stepped over and the prefix reached,
  // and the command is still inside one word.
  ['env -S in a brace group', "{ env -S'git push --force'; }", 'a force push'],
  ['env -S after then', "if true; then env -S'git push --force'; fi", 'a force push'],
  ['env -S in a for body', "for x in 1; do env -S'git branch -D topic'; done", 'deleting a branch'],
  ['env -S in a while body', "while true; do env -S'git push -f'; break; done", 'a force push'],
  ['env -S in a case body', "case x in x) env -S'git push --force';; esac", 'a force push'],
  ['env -S in a group after &&', "true && { env -S'git commit --no-verify -m x'; }", 'a commit that skips the hooks (--no-verify)'],
  ['env --split-string= in a brace group', "{ env --split-string='git push --force'; }", 'a force push'],
  ['env -S behind another prefix', "nohup env -S'git push --force'", 'a force push'],
  // The split text is text, so everything the gate reads in a command it reads in there too.
  ['a prefix program inside the split text', "env -S'nohup git push --force'", 'a force push'],
  ['a shell inside the split text', 'env -S\'bash -c "git push --force"\'', 'a force push'],
  // `env` is a prefix and not a shell, so reading its split text must not spend the budget for
  // looking inside a shell. This is the shape that says so: spend it here and the innermost
  // script goes unread, and bash runs the push.
  ['a shell inside the split text of an env inside a shell', 'bash -c "env -S\'bash -c \\"git push --force\\"\'"', 'a force push'],
  // `env` parses with `getopt_long`, which takes any unambiguous abbreviation of a long option,
  // and `split-string` is its only long option beginning with `s`. So `--s=` is `--split-string=`,
  // and matching the option by its full spelling alone leaves every shorter one open. Measured
  // under bash: all twelve ran the reserved command.
  ['env --s=, the shortest abbreviation there is', "env --s='git push --force'", 'a force push'],
  ['env --sp=', "env --sp='git push --force'", 'a force push'],
  ['env --split=', "env --split='git push --force'", 'a force push'],
  ['env --split-strin=, one letter short of the name', "env --split-strin='git push --force'", 'a force push'],
  ['env --s, an abbreviation whose argument is the next word', "env --s 'git push --force'", 'a force push'],
  ['env --split, an abbreviation whose argument is the next word', "env --split 'git push --force'", 'a force push'],
  ['env --s= deleting a branch', "env --s='git branch -D topic'", 'deleting a branch'],
  ['env --s= skipping the hooks', "env --s='git commit --no-verify -m x'", 'a commit that skips the hooks (--no-verify)'],
  ['env --s= in a brace group', "{ env --s='git push --force'; }", 'a force push'],
  ['env --s= after then', "if true; then env --s='git push --force'; fi", 'a force push'],
  ['env --s= behind another prefix', "nohup env --s='git push --force'", 'a force push'],
  ['env --s= named by its path', "/usr/bin/env --s='git push --force'", 'a force push'],
  // `flock` carries a command in one word the same way, through `-c` / `--command`, which it hands
  // to a shell. **No bash oracle for these exists on this host**: `flock` is absent here, so bash
  // runs nothing and the marker is empty for every one. What is asserted is the gate's verdict,
  // which is deterministic and needs no oracle — the same footing the seven prefix names absent
  // from this host already stand on, and `templates/claude/` ships for the hosts that have it.
  ['flock -c, the lock file first', "flock /tmp/l -c 'git push --force'", 'a force push'],
  ['flock -c, the option first', "flock -c 'git push --force' /tmp/l", 'a force push'],
  ['flock --command=', "flock --command='git push --force' /tmp/l", 'a force push'],
  ['flock --com=, an unambiguous abbreviation', "flock --com='git push --force' /tmp/l", 'a force push'],
  ['flock -nc, the option clustered behind a flag', "flock -nc 'git push --force' /tmp/l", 'a force push'],
  ['flock --command deleting a branch', "flock /tmp/l --command 'git branch -D topic'", 'deleting a branch'],
  // A `--` word leaves an empty long-option name, which every option name begins with. Matching it
  // would have the reader return the word after the `--` as the command text and stop, leaving the
  // real option further along unread — a *narrowing*, which is the direction that trades a refusal
  // for a bypass. These two rows are what the non-empty test on that name is for, and they are
  // refusals round 3 already gave.
  //
  // Bash runs nothing for either, and says why: `env: '-Sgit push --force': No such file or
  // directory` for the first, because `--` ends option parsing and `env` takes the next word as a
  // program name, and `env: ambiguous option --` for the second. So both are the fail-closed
  // direction, and the pull request reports them as over-refusals as well as here.
  ['a bare -- before the real option', "env -- -S'git push --force'", 'a force push'],
  ['an empty long-option name before the real option', "env --=x -S'git push --force'", 'a force push'],
  // `sudo` is the third program that carries a command in one word, and the second-largest of the
  // three: `-s` / `--shell` and `-i` / `--login` each run a shell, and sudo(8) says of both that
  // "if a command is specified, it is passed to the shell for execution via the shell's -c
  // option". So `sudo -s 'git push --force'` is `bash -c 'git push --force'` with a shell in
  // between, and the whole command is one word.
  //
  // **No bash oracle for these exists on this host.** `sudo` here is Windows' own `sudo`, which
  // answers `error: unexpected argument '-s' found` and runs nothing, so the marker is empty for
  // every row and what is asserted is the gate's verdict. Same footing as the `flock` rows.
  //
  // Neither flag takes an option argument — the command is an *operand* — so which word it is
  // depends on the options between the flag and it. Every word after the flag is read rather than
  // sudo's option order being assumed, which is the one thing about `sudo` this host cannot answer.
  ['sudo -s', "sudo -s 'git push --force'", 'a force push'],
  ['sudo -i', "sudo -i 'git push --force'", 'a force push'],
  ['sudo --shell', "sudo --shell 'git push --force'", 'a force push'],
  ['sudo --login', "sudo --login 'git push --force'", 'a force push'],
  ['sudo --sh, an abbreviation', "sudo --sh 'git push --force'", 'a force push'],
  ['sudo --lo, an abbreviation', "sudo --lo 'git push --force'", 'a force push'],
  ['sudo -s deleting a branch', "sudo -s 'git branch -D topic'", 'deleting a branch'],
  ['sudo -i skipping the hooks', "sudo -i 'git commit --no-verify -m x'", 'a commit that skips the hooks (--no-verify)'],
  ['sudo -s in a brace group', "{ sudo -s 'git push --force'; }", 'a force push'],
  ['sudo -s behind another prefix', "nohup sudo -s 'git push --force'", 'a force push'],
  ['sudo -s behind an option that takes a value', "sudo -u root -s 'git push --force'", 'a force push'],
  ['sudo -s with an option between the flag and the command', "sudo -s -u root 'git push --force'", 'a force push'],
  ['sudo -ns, the flag clustered behind another', "sudo -ns 'git push --force'", 'a force push'],
  // A decoy option ahead of the real one. GNU `env` takes the **first** `-S` and makes everything
  // after it arguments to that command, which is measured — so for `env` the first match is
  // `env`'s own resolution. What `flock` does with a second `-c` is **not** measured here and is
  // not assumed: every match is read, so which one the program would take does not have to be
  // known. This row is the one that says so.
  ['a decoy option ahead of the real one', "flock /tmp/l -c : -c 'git push --force'", 'a force push'],
];

/**
 * The floor under both tables above: a redirection or a prefix program beside a command carrying
 * nothing reserved. Bash runs no reserved git command in any of these, measured the same way.
 *
 * The last three hold a `)` where the gate steps over one, and they are here because the rule that
 * steps over a blank-separated `case` pattern reads the second word. They pin that it reads only
 * that word: a `)` further along a command, or one in an argument to a program that is not a
 * pattern, changes nothing.
 */
export const PREFIX_WORDS_CARRYING_NOTHING_RESERVED = [
  ['a redirection before a clean git command', '{ >/dev/null git status; }'],
  ['a descriptor duplication before a clean git command', '{ 2>&1 git log --oneline -1; }'],
  ['git redirecting its own output', 'git log --oneline -1 > /dev/null'],
  ['command -v, which prints a path rather than running it', 'command -v git'],
  ['a prefix program whose argument mentions git', 'nohup echo git status'],
  ['timeout of a command that is not git', 'timeout 5 echo npm test'],
  ['nice of a command that is not git', 'nice -n 10 echo node x.js'],
  ['env with no command after it', 'env | grep -c PATH'],
  ['a quoted parenthesis as an argument', "echo ')' hello"],
  ['a quoted parenthesis in a pattern', "echo x | grep ')' || true"],
  ['a quoted parenthesis in a substitution', "echo x | sed 's/x/)/'"],
  ['split text carrying no git command at all', "env -S'echo hello'"],
  ['split text carrying a clean git command', "env -S'git log --oneline -1'"],
  ['long-form split text carrying no git command', "env --split-string='echo hello'"],
  ['split text behind an option that takes a value, carrying a clean git command', "env -u FOO -S'git status'"],
  ['an abbreviated split string carrying no git command', "env --s='echo hello'"],
  ['an abbreviated split string carrying a clean git command', "env --s='git log --oneline -1'"],
  ['a long option that is no abbreviation of split-string', "env --unset=FOO git status"],
  ["flock's command carrying no git command", "flock /tmp/l -c 'echo hello'"],
  ["flock's command carrying a clean git command", "flock /tmp/l -c 'git status'"],
  ["sudo's shell carrying no git command", "sudo -s 'echo hello'"],
  ["sudo's login shell carrying a clean git command", "sudo -i 'git status'"],
  ['sudo -u, whose option takes a user rather than a command', 'sudo -u root git status'],
  ['a long option that is no abbreviation of shell or login', 'sudo --list git status'],
];

test('a reserved git spelling behind a redirection word is refused', () => {
  // Bash reads a redirection wherever it reads a command's words. A gate that steps over the
  // reserved words and the assignments but not the redirections has a gap between them, and that
  // gap disables the step-overs on either side of it.
  for (const [shape, command, spelling] of REDIRECTION_PAYLOADS) {
    refuses(command, `a reserved spelling behind a redirection: ${shape}`);
    const { reason } = rule(command);
    assert.ok(
      reason.includes(spelling),
      `the refusal for ${shape} did not name the spelling it found (${spelling}): ${reason}`,
    );
  }
});

test('a reserved git spelling behind a prefix program is refused', () => {
  // `env` was stepped over and nothing else was, so every other program that runs a command named
  // in its arguments was a way through — including `env`'s own options.
  for (const [shape, command, spelling] of PREFIX_PROGRAM_PAYLOADS) {
    refuses(command, `a reserved spelling behind ${shape}`);
    const { reason } = rule(command);
    assert.ok(
      reason.includes(spelling),
      `the refusal for ${shape} did not name the spelling it found (${spelling}): ${reason}`,
    );
  }
});

test('a redirection or a prefix program beside nothing reserved is still permitted', () => {
  // Reading more words than bash runs is what keeps the prefix rule free of each program's option
  // grammar. It costs nothing while it objects only to the words that spell a reserved command,
  // and these pin that.
  for (const [shape, command] of PREFIX_WORDS_CARRYING_NOTHING_RESERVED) {
    permits(command, `${shape}, which bash runs no reserved git command from`);
  }
});
