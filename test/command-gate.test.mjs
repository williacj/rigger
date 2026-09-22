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
  'git -c core.hooksPath=/dev/null commit -m msg',
  'git --config-env=core.hooksPath=NOWHERE commit -m msg',
  'GIT_AUTHOR_DATE=now git push --force',
  'env git push --force',
  '/usr/bin/git push --force',
  'git.exe push --force',
  'bash -c "git push --force"',
  'sh -lc \'git commit --no-verify\'',
  'echo ready && git push --force',
  // Reserved commands that themselves open a here-document, or stand beside one. Skipping the
  // body must cost neither the words before it nor the words after it on the same line.
  lines("git push --force <<'EOF'", "a note that's beside the point", 'EOF'),
  lines('git commit -m << EOF --no-verify', 'a message', 'EOF'),
  lines("cat > notes.md <<'EOF'", "don't", 'EOF', 'git branch -D topic'),
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

test('a command the gate cannot read is refused', () => {
  // Failing closed is the gate's other promise, and skipping a body must not become a way to
  // stop reading. A body with no closing delimiter is unread text, so it is unreadable text.
  for (const command of UNREADABLE_COMMANDS) {
    refuses(command, `the unreadable command \`${command}\``);
  }
});
