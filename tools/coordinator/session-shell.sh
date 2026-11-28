# ABOUTME: Defines the `gh` shell function, which runs post-check.mjs before the real `gh` starts.
# A Claude Code session reads this file through CLAUDE_ENV_FILE; a Codex session reads it through
# the start files in post-check/. It first unsets the variables that led here, so no program the
# shell starts inherits the route to the function.
__rigger_tools="${__rigger_tools:-${CLAUDE_ENV_FILE%/*}}"
unset CLAUDE_ENV_FILE ZDOTDIR BASH_ENV
case "$__rigger_tools" in
  *\'*|'') gh() { printf '%s\n' 'refused: the post check could not be found.' >&2; return 1; } ;;
  /*) eval "gh() { node '$__rigger_tools/post-check.mjs' \"\$@\"; }" ;;
  *) gh() { printf '%s\n' 'refused: the post check could not be found.' >&2; return 1; } ;;
esac
unset __rigger_tools
