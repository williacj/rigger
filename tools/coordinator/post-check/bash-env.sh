# ABOUTME: A Codex session's bash start file, named by BASH_ENV: defines the `gh` function from
# session-shell.sh.
__rigger_tools="${BASH_ENV%/*/*}"
unset ZDOTDIR BASH_ENV
. "$__rigger_tools/session-shell.sh"
