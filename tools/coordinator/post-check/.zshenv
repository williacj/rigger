# ABOUTME: A Codex session's zsh start file, named by ZDOTDIR: reads the owner's .zshenv, then
# defines the `gh` function from session-shell.sh. Unsetting ZDOTDIR first sends zsh's later start
# files back to the owner's home.
__rigger_tools="${ZDOTDIR%/*}"
unset ZDOTDIR BASH_ENV
[ -f "$HOME/.zshenv" ] && . "$HOME/.zshenv"
. "$__rigger_tools/session-shell.sh"
