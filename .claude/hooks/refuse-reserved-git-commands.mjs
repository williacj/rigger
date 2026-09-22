// ABOUTME: Claude Code's PreToolUse gate on the Bash tool. Refuses the git spellings AGENTS.md
// reserves to the owner — --no-verify, a force push, a branch delete — wherever the flag is written.
// Reads the hook payload on stdin; prints a deny decision, or nothing when it has no objection.

import { readFileSync } from 'node:fs';

const EVENT = 'PreToolUse';

// A permission rule is a lexical prefix, so it can say "this command" and "anything starting with
// this text", and cannot say "this command with any argument except these". That is the control
// AGENTS.md asks for, so it is made here instead.

// Two refusals, because either alone can be lost. The decision carries the reason; exit 2 blocks
// even where the decision is not read, and an exit code Claude Code does not recognise lets the
// command through.
function refuse(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: EVENT,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** No objection. The permission rules and the prompt decide from here. */
function stepAside() {
  process.exit(0);
}

class Unreadable extends Error {}

const OPERATORS = ['&&', '||', ';', '|', '&', '\n'];

/** Where bash ends an unquoted word: a blank, or one of the characters that begin an operator. */
const METACHARACTER = /[ \t\n|&;()<>]/;

/**
 * Read the delimiter word of a here-document, from the first character after `<<` or `<<-`.
 *
 * Bash ends that word at an unquoted metacharacter and removes its quoting to get the delimiter,
 * so `<<'EOF'`, `<<"EOF"` and `<<\EOF` all close on a line reading `EOF`. The word may be
 * separated from the operator by blanks, and `spaced` reports that so the caller can keep the
 * tokens apart the way the rest of the lexer would have.
 */
function delimiterAt(text, start) {
  let i = start;
  while (text[i] === ' ' || text[i] === '\t') i++;
  const spaced = i > start;
  let word = '';

  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) throw new Unreadable('the command has an unbalanced quote');
      word += text.slice(i + 1, close);
      i = close;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      word += text[++i];
      continue;
    }
    if (METACHARACTER.test(ch)) break;
    word += ch;
  }

  if (!word) throw new Unreadable('a here-document names no delimiter');
  return { word, spaced, end: i };
}

/**
 * Skip the bodies the here-documents on the line just ended will be fed. A body is data on
 * standard input: it ends at a line that is exactly the delimiter, nothing in it is ever run, and
 * so nothing in it is read as shell text. `<<-` strips leading tabs from the body lines and from
 * that closing line.
 *
 * A body with no closing line is unreadable rather than skipped. Bash ends such a body at end of
 * input and runs the command anyway; refusing instead is the safe half of that disagreement,
 * because a `<<` this gate reads and bash does not cannot then swallow the commands after it.
 */
function skipBodies(text, start, pending) {
  let i = start;
  for (const { word, stripTabs } of pending) {
    for (;;) {
      if (i >= text.length) throw new Unreadable('a here-document has no closing delimiter');
      const breakAt = text.indexOf('\n', i);
      const end = breakAt === -1 ? text.length : breakAt;
      const line = stripTabs ? text.slice(i, end).replace(/^\t+/, '') : text.slice(i, end);
      i = breakAt === -1 ? end : breakAt + 1;
      if (line === word) break;
      if (breakAt === -1) throw new Unreadable('a here-document has no closing delimiter');
    }
  }
  return i;
}

/**
 * Split a command line into the separate commands it runs, each as a token list, honouring quotes
 * and backslash escapes. An unbalanced quote is unreadable rather than a guess.
 */
function commandsIn(text) {
  const commands = [];
  let tokens = [];
  let token = '';
  let open = false; // a token is open even when it lexed to the empty string, as "" does
  let quote = null;
  const pending = []; // the here-documents opened on the line being read, in the order bash feeds them

  const endToken = () => {
    if (open) tokens.push(token);
    token = '';
    open = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        token += text[++i];
      } else if (ch === quote) {
        quote = null;
      } else {
        token += ch;
      }
      open = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      open = true;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      token += text[++i];
      open = true;
      continue;
    }
    // A here-string carries its data on this line, so it opens no body and skips nothing.
    if (ch === '<' && text[i + 1] === '<' && text[i + 2] === '<') {
      token += '<<<';
      open = true;
      i += 2;
      continue;
    }
    if (ch === '<' && text[i + 1] === '<') {
      const stripTabs = text[i + 2] === '-';
      const { word, spaced, end } = delimiterAt(text, i + (stripTabs ? 3 : 2));
      pending.push({ word, stripTabs });
      // The redirection stays in the token list exactly as it lexed before, because a word
      // removed here is a word an option that takes a value would swallow from further along.
      token += stripTabs ? '<<-' : '<<';
      open = true;
      if (spaced) endToken();
      token += word;
      open = true;
      i = end - 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken();
      continue;
    }
    if (ch === '\n' && pending.length) {
      i = skipBodies(text, i + 1, pending) - 1;
      pending.length = 0;
      endCommand();
      continue;
    }
    if (OPERATORS.includes(text.slice(i, i + 2))) {
      endCommand();
      i++;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      endCommand();
      continue;
    }

    token += ch;
    open = true;
  }

  if (quote) throw new Unreadable('the command has an unbalanced quote');
  if (pending.length) throw new Unreadable('a here-document has no closing delimiter');
  endCommand();
  return commands;
}

const basename = (word) => word.split(/[\\/]/).pop();

/** Git's options that sit before the subcommand and swallow the word after them. */
const GIT_GLOBALS_TAKING_A_VALUE = new Set([
  '-c',
  '-C',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--work-tree',
]);

/** Each subcommand's options that swallow the word after them, so a value is never read as a flag. */
const VALUE_OPTIONS = {
  commit: {
    long: new Set([
      '--author',
      '--cleanup',
      '--date',
      '--file',
      '--fixup',
      '--message',
      '--pathspec-from-file',
      '--reedit-message',
      '--reuse-message',
      '--squash',
      '--template',
      '--trailer',
    ]),
    short: new Set(['m', 'F', 'C', 'c', 't']),
  },
  push: {
    long: new Set(['--exec', '--push-option', '--receive-pack', '--repo']),
    short: new Set(['o']),
  },
  branch: {
    long: new Set([
      '--contains',
      '--format',
      '--merged',
      '--no-contains',
      '--no-merged',
      '--points-at',
      '--set-upstream-to',
      '--sort',
    ]),
    short: new Set(['u']),
  },
};

const isCluster = (token) => /^-[A-Za-z]+$/.test(token);
const longName = (token) => token.split('=')[0];

/**
 * Walk one git invocation, handing each option and each operand to the caller. Options after a bare
 * `--` are operands, and a value is never offered as an option.
 */
function walkArguments(words, subcommand, onOption, onOperand) {
  const values = VALUE_OPTIONS[subcommand] ?? { long: new Set(), short: new Set() };
  let operandsOnly = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (operandsOnly || word === '-' || !word.startsWith('-')) {
      onOperand(word);
      continue;
    }
    if (word === '--') {
      operandsOnly = true;
      continue;
    }

    if (word.startsWith('--')) {
      onOption(longName(word), word);
      if (values.long.has(word)) i++;
      continue;
    }

    onOption(word, word);
    if (isCluster(word)) {
      const letters = word.slice(1);
      for (let n = 0; n < letters.length; n++) {
        onOption(`-${letters[n]}`, word);
        if (!values.short.has(letters[n])) continue;
        // Everything after an option that takes a value is that value rather than more flags.
        // `-m"a message"` lexes to one token, and the letters of the message are not options.
        // Where the option is the last letter, the value is the word after it instead.
        if (n === letters.length - 1) i++;
        break;
      }
    }
  }
}

const RESERVED = {
  commit: (option) =>
    // -n is git's own short spelling of --no-verify on commit. On push it means --dry-run, which is
    // why this rule is bound to the subcommand rather than to the flag.
    option === '--no-verify' || option === '-n'
      ? 'a commit that skips the hooks (--no-verify)'
      : null,
  push: (option) =>
    option === '--no-verify'
      ? 'a push that skips the hooks (--no-verify)'
      : option === '--force' || option === '-f' || longName(option) === '--force-with-lease' || longName(option) === '--force-if-includes'
        ? 'a force push'
        : option === '--delete' || option === '-d'
          ? 'deleting a remote branch'
          : null,
  branch: (option) =>
    option === '--delete' || option === '-d' || option === '-D'
      ? 'deleting a branch'
      : null,
};

const PUSH_RESERVED_OPERAND = (word) =>
  word.startsWith('+')
    ? 'a force push (the +refspec form)'
    : word.startsWith(':') && word.length > 1
      ? 'deleting a remote branch (the :branch form)'
      : null;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Inspect one command. Returns the reason to refuse, or null. */
function objectionTo(given, depth) {
  // A command may carry environment assignments before the program it runs, and `env` may carry
  // them too: `GIT_AUTHOR_DATE=… git commit …` runs git, and the program to read is not word one.
  let words = given;
  for (;;) {
    let start = 0;
    while (start < words.length && ASSIGNMENT.test(words[start])) start++;
    words = words.slice(start);
    if (words.length && basename(words[0]) === 'env') {
      words = words.slice(1);
      continue;
    }
    break;
  }
  if (!words.length) return null;

  // A shell asked to run a command string is that command string; look inside it once.
  const program = basename(words[0]);
  if (SHELLS.has(program) && depth < 2) {
    // -c may be written in a cluster, as `bash -lc "…"`.
    const flag = words.findIndex((word) => word === '-c' || (isCluster(word) && word.includes('c')));
    const script = flag === -1 ? undefined : words[flag + 1];
    if (script !== undefined) {
      for (const inner of commandsIn(script)) {
        const objection = objectionTo(inner, depth + 1);
        if (objection) return objection;
      }
    }
    return null;
  }

  if (program !== 'git' && program !== 'git.exe') return null;

  // Step over git's own options to reach the subcommand, and read the config it sets on the way.
  let i = 1;
  let subcommand = null;
  for (; i < words.length; i++) {
    const word = words[i];
    if (!word.startsWith('-')) {
      subcommand = word;
      i++;
      break;
    }
    if (word === '-c' || word === '--config-env') {
      const setting = words[i + 1] ?? '';
      if (/^core\.hooksPath\s*=/i.test(setting)) return 'turning the repository hooks off (core.hooksPath)';
      i++;
      continue;
    }
    // git documents --config-env=<name>=<envvar>, so the setting is inside this one word.
    if (word.startsWith('--config-env=')) {
      if (/^core\.hooksPath\s*=/i.test(word.slice('--config-env='.length))) {
        return 'turning the repository hooks off (core.hooksPath)';
      }
      continue;
    }
    if (/^--git-dir=|^--work-tree=|^--namespace=|^--exec-path=/.test(word)) continue;
    if (GIT_GLOBALS_TAKING_A_VALUE.has(word)) i++;
  }

  if (subcommand === null) return null;
  const rule = RESERVED[subcommand];
  if (!rule) return null;

  let objection = null;
  walkArguments(
    words.slice(i),
    subcommand,
    (option) => {
      objection ??= rule(option);
    },
    (operand) => {
      if (subcommand === 'push') objection ??= PUSH_RESERVED_OPERAND(operand);
    },
  );
  return objection;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    refuse('This hook could not read what it was asked to rule on, so it refused.');
  }

  if (payload.tool_name !== 'Bash') stepAside();

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') {
    refuse('This hook could not find the command to rule on, so it refused.');
  }

  let commands;
  try {
    commands = commandsIn(command);
  } catch (error) {
    refuse(`This hook could not read the command (${error.message}), so it refused.`);
  }

  for (const words of commands) {
    const objection = objectionTo(words, 0);
    if (objection) {
      refuse(
        `AGENTS.md reserves this to the owner: ${objection}. Ask, rather than working around it.`,
      );
    }
  }

  stepAside();
}

try {
  main();
} catch (error) {
  refuse(`This hook failed (${error?.message ?? error}), so it refused rather than let the command run.`);
}
