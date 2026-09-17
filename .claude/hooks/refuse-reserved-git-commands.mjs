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
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken();
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
      for (const letter of word.slice(1)) onOption(`-${letter}`, word);
      if (values.short.has(word.slice(-1))) i++;
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

/** Inspect one command. Returns the reason to refuse, or null. */
function objectionTo(words, depth) {
  if (!words.length) return null;

  // A shell asked to run a command string is that command string; look inside it once.
  const program = basename(words[0]);
  if (SHELLS.has(program) && depth < 2) {
    const flag = words.indexOf('-c');
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
    if (/^--config-env=|^--git-dir=|^--work-tree=|^--namespace=|^--exec-path=/.test(word)) continue;
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
