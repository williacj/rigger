// ABOUTME: The live Codex judge's shell world: the flags and environment under which `gh` in the
// judge's shell is the fake forge's, laid over the command line L1 hands the gated live test.

/*
 * Why. Codex runs a command in the user's shell. A login `zsh` sources `/etc/zprofile`, whose
 * `path_helper` moves `/etc/paths` and `/etc/paths.d/*` ahead of every directory the caller put
 * first, `/opt/homebrew/bin` and its `gh` among them on the owner's host. A shell snapshot,
 * captured from a login shell, exports that same order. So the fake forge's directory first on the
 * `PATH` L1 hands Codex did not hold in the judge's shell (B1 on #583). codex-cli 0.159.2 has an
 * `allow_login_shell` key and `shell_snapshot` and `shell_snapshot_v2` features; these turn them
 * off. That they keep the fake first is shown only by the gated live run, which quotes the judge's
 * own `command -v gh`.
 *
 * `GH_CONFIG_DIR` names an empty directory, so a real `gh` reached all the same holds no login.
 */
const NON_LOGIN = ['-c', 'allow_login_shell=false', '--disable', 'shell_snapshot', '--disable', 'shell_snapshot_v2'];

/** `handed`, L1's command line for the judge, with Codex's shell kept non-login and `gh` given `ghConfig`. */
export function judgeShell(handed, ghConfig) {
  return { ...handed, args: [...handed.args, ...NON_LOGIN], env: { ...handed.env, GH_CONFIG_DIR: ghConfig } };
}
