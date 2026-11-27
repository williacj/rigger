#!/usr/bin/env node
// ABOUTME: Checks the text a `gh` command would post, against card #1486's rows and the owner's
// private list, before the real `gh` starts; the `gh` shell function in session-shell.sh runs it.
//
// Card #1487's rows, G1 to G7, decide what is checked. Only `gh` 2.105.0's commands and flags are
// known; anything else is refused as text the check cannot determine. A refusal names a row and a
// part of the post and never what it matched. The limits, none of which it sees past:
//
// - an MCP connector, a browser, `curl`, a program other than `gh`, the web editor, a session in a
//   clone elsewhere, the engine's own forge calls, and `gh` run by a session the engine dispatches;
// - a `gh` the function is not in front of: `command gh`, `env gh`, an absolute path to `gh`, `gh`
//   in a script file, under `sh -c`, under a shell the session nests, or in a node child, and a
//   Codex session whose own shell is `sh`;
// - a Claude Code session where the CLI scrubs credentials from its subprocesses, which skips
//   `CLAUDE_ENV_FILE`;
// - a Claude Code session started while `CLAUDE_ENV_FILE` names no file, as on a main checkout
//   whose branch lacks session-shell.sh: the CLI ignores it without notice and every post goes out
//   unchecked;
// - a `gh` alias or function in a login profile read after the Codex start file, such as
//   `.zprofile` or `.zlogin`, which takes the function's place under `zsh -lc`;
// - a session resumed by codex-resume.sh, shown only by what the launcher passes, not live;
// - a worktree's session, which runs the main checkout's copy, so a branch's edit has no effect
//   until that checkout holds it; a change to the function needs a new session;
// - `HOME` and `PATH`, which can redirect it;
// - the session's account, which can read the list, and a trace of the check's process;
// - an edit or deletion of a post, which does not undo it, and an edit by an uncovered route.
//
// A clean result is no privacy check under "Spikes on a personal machine".

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addedLines, placeName, readList, refusalLine, rowsIn, wording } from '../../.githooks/refuse-private-content.mjs';

/**
 * Each command of `gh` 2.105.0 with its flags, from `gh <command> --help`: a long name, its short
 * name after a slash, and `=` where it takes a value.
 */
const COMMANDS = {
  'agent-task create': 'base/b= custom-agent/a= follow from-file/F= help repo/R=',
  'agent-task list': 'help jq/q= json= limit/L= template/t= web/w',
  'agent-task view': 'follow help jq/q= json= log repo/R= template/t= web/w',
  'alias delete': 'all help',
  'alias import': 'clobber help',
  'alias list': 'help',
  'alias set': 'clobber help shell/s',
  'api': 'allow-escape-sequences cache= field/F= header/H= help hostname= include/i input= jq/q= method/X= paginate preview/p= raw-field/f= silent slurp template/t= verbose',
  'attestation download': 'digest-alg/d= help hostname= limit/L= owner/o= predicate-type= repo/R=',
  'attestation trusted-root': 'help hostname= tuf-root= tuf-url= verify-only',
  'attestation verify': 'bundle/b= bundle-from-oci cert-identity= cert-identity-regex/i= cert-oidc-issuer= custom-trusted-root= deny-self-hosted-runners digest-alg/d= format= help hostname= jq/q= limit/L= no-public-good owner/o= predicate-type= repo/R= signer-digest= signer-repo= signer-workflow= source-digest= source-ref= template/t=',
  'auth login': 'clipboard/c expiring git-protocol/p= help hostname/h= insecure-storage scopes/s= skip-ssh-key web/w with-token',
  'auth logout': 'help hostname/h= user/u=',
  'auth refresh': 'clipboard/c expiring help hostname/h= insecure-storage remove-scopes/r= reset-scopes scopes/s=',
  'auth setup-git': 'force/f help hostname/h=',
  'auth status': 'active/a help hostname/h= jq= json= no-refresh show-token/t template=',
  'auth switch': 'help hostname/h= user/u=',
  'auth token': 'help hostname/h= no-refresh user/u=',
  'browse': 'actions/a blame branch/b= commit/c= help no-browser/n projects/p releases/r repo/R= settings/s wiki/w',
  'cache delete': 'all/a help ref/r= repo/R= succeed-on-no-caches',
  'cache list': 'help jq/q= json= key/k= limit/L= order/O= ref/r= repo/R= sort/S= template/t=',
  'co': 'branch/b= detach force/f help recurse-submodules repo/R= worktree=',
  'codespace code': 'codespace/c= help insiders repo/R= repo-owner= web/w',
  'codespace cp': 'codespace/c= expand/e help profile/p= recursive/r repo/R= repo-owner=',
  'codespace create': 'branch/b= default-permissions devcontainer-path= display-name/d= help idle-timeout= location/l= machine/m= repo/R= retention-period= status/s web/w',
  'codespace delete': 'all codespace/c= days= force/f help org/o= repo/R= repo-owner= user/u=',
  'codespace edit': 'codespace/c= display-name/d= help machine/m= repo/R= repo-owner=',
  'codespace jupyter': 'codespace/c= help repo/R= repo-owner=',
  'codespace list': 'help jq/q= json= limit/L= org/o= repo/R= template/t= user/u= web/w',
  'codespace logs': 'codespace/c= follow/f help repo/R= repo-owner=',
  'codespace ports': 'codespace/c= help jq/q= json= repo/R= repo-owner= template/t=',
  'codespace ports forward': 'all-interfaces codespace/c= help repo/R= repo-owner=',
  'codespace ports visibility': 'codespace/c= help repo/R= repo-owner=',
  'codespace rebuild': 'codespace/c= full help repo/R= repo-owner=',
  'codespace ssh': 'codespace/c= config debug/d debug-file= help profile= repo/R= repo-owner= server-port=',
  'codespace stop': 'codespace/c= help org/o= repo/R= repo-owner= user/u=',
  'codespace view': 'codespace/c= help jq/q= json= repo/R= repo-owner= template/t=',
  'completion': 'help shell/s=',
  'config clear-cache': 'help',
  'config get': 'help host/h=',
  'config list': 'help host/h=',
  'config set': 'help host/h=',
  'copilot': 'help remove',
  'discussion comment': 'body/b= body-file/F= delete edit help repo/R= yes',
  'discussion create': 'body/b= body-file/F= category/c= help label/l= repo/R= title/t=',
  'discussion edit': 'add-label= body/b= body-file/F= category/c= help remove-label= repo/R= title/t=',
  'discussion list': 'after= answered author/A= category/c= help jq/q= json= label/l= limit/L= order= repo/R= search/S= sort= state/s= template/t= web/w',
  'discussion view': 'after= comments/c help jq/q= json= limit/L= order= repo/R= template/t= web/w',
  'event listen': 'count= event= follow help jq/q= resource= subscription= template/t= timeout=',
  'event subscription create': 'event= help jq/q= json= resource= template/t=',
  'event subscription delete': 'help',
  'event subscription list': 'help jq/q= json= limit/L= template/t=',
  'event subscription view': 'help jq/q= json= template/t=',
  'extension browse': 'debug help single-column/s',
  'extension create': 'help precompiled=',
  'extension exec': '',
  'extension install': 'force help pin=',
  'extension list': 'help',
  'extension remove': 'help',
  'extension search': 'help jq/q= json= license= limit/L= order= owner= sort= template/t= web/w',
  'extension upgrade': 'all dry-run force help',
  'gist clone': 'help',
  'gist create': 'desc/d= filename/f= help public/p web/w',
  'gist delete': 'help yes',
  'gist edit': 'add/a= desc/d= filename/f= help remove/r=',
  'gist list': 'filter= help include-content limit/L= public secret',
  'gist rename': 'help',
  'gist view': 'allow-escape-sequences filename/f= files help raw/r web/w',
  'gpg-key add': 'help title/t=',
  'gpg-key delete': 'help yes/y',
  'gpg-key list': 'help',
  'issue artifact create': 'attach= body/b= body-file/F= help name= repo/R= type=',
  'issue artifact delete': 'help repo/R= yes',
  'issue artifact download': 'clobber dir/D= help output/O= repo/R= skip-existing version=',
  'issue artifact edit': 'attach= body/b= body-file/F= help name= repo/R= restore-version=',
  'issue artifact list': 'help jq/q= json= limit/L= repo/R= template/t= type=',
  'issue artifact view': 'help jq/q= json= repo/R= template/t= version= web/w',
  'issue close': 'comment/c= duplicate-of= help reason/r= repo/R=',
  'issue comment': 'attach= body/b= body-file/F= create-if-none delete-last edit-last editor/e help repo/R= web/w yes',
  'issue create': 'assignee/a= attach= blocked-by= blocking= body/b= body-file/F= editor/e help label/l= milestone/m= parent= project/p= recover= repo/R= template/T= title/t= type= web/w',
  'issue delete': 'help repo/R= yes',
  'issue develop': 'base/b= branch-repo= checkout/c help list/l name/n= repo/R= worktree=',
  'issue edit': 'add-assignee= add-blocked-by= add-blocking= add-label= add-project= add-sub-issue= attach= body/b= body-file/F= help milestone/m= parent= remove-assignee= remove-blocked-by= remove-blocking= remove-label= remove-milestone remove-parent remove-project= remove-sub-issue= remove-type repo/R= title/t= type=',
  'issue list': 'app= assignee/a= author/A= help jq/q= json= label/l= limit/L= mention= milestone/m= repo/R= search/S= state/s= template/t= type= web/w',
  'issue lock': 'help reason/r= repo/R=',
  'issue pin': 'help repo/R=',
  'issue reopen': 'comment/c= help repo/R=',
  'issue status': 'help jq/q= json= repo/R= template/t=',
  'issue transfer': 'help repo/R=',
  'issue unlock': 'help repo/R=',
  'issue unpin': 'help repo/R=',
  'issue view': 'comments/c help jq/q= json= repo/R= template/t= web/w',
  'label clone': 'force/f help repo/R=',
  'label create': 'color/c= description/d= force/f help repo/R=',
  'label delete': 'help repo/R= yes',
  'label edit': 'color/c= description/d= help name/n= repo/R=',
  'label list': 'help jq/q= json= limit/L= order= repo/R= search/S= sort= template/t= web/w',
  'licenses': 'help',
  'org list': 'help limit/L=',
  'pr': 'help repo/R=',
  'pr checkout': 'branch/b= detach force/f help recurse-submodules repo/R= worktree=',
  'pr checks': 'fail-fast help interval/i= jq/q= json= repo/R= required template/t= watch web/w',
  'pr close': 'comment/c= delete-branch/d help repo/R=',
  'pr comment': 'attach= body/b= body-file/F= create-if-none delete-last edit-last editor/e help repo/R= web/w yes',
  'pr create': 'assignee/a= attach= base/B= body/b= body-file/F= draft/d dry-run editor/e fill/f fill-first fill-verbose head/H= help label/l= milestone/m= no-maintainer-edit project/p= recover= repo/R= reviewer/r= template/T= title/t= web/w',
  'pr diff': 'allow-escape-sequences color= exclude/e= help name-only patch repo/R= web/w',
  'pr edit': 'add-assignee= add-label= add-project= add-reviewer= attach= base/B= body/b= body-file/F= help milestone/m= remove-assignee= remove-label= remove-milestone remove-project= remove-reviewer= repo/R= title/t=',
  'pr list': 'app= assignee/a= author/A= base/B= draft/d head/H= help jq/q= json= label/l= limit/L= repo/R= search/S= state/s= template/t= web/w',
  'pr lock': 'help reason/r= repo/R=',
  'pr merge': 'admin author-email/A= auto body/b= body-file/F= delete-branch/d disable-auto help match-head-commit= merge/m rebase/r repo/R= squash/s subject/t=',
  'pr ready': 'help repo/R= undo',
  'pr reopen': 'comment/c= help repo/R=',
  'pr revert': 'body/b= body-file/F= draft/d help repo/R= title/t=',
  'pr review': 'approve/a body/b= body-file/F= comment/c help repo/R= request-changes/r',
  'pr status': 'conflict-status/c help jq/q= json= repo/R= template/t=',
  'pr unlock': 'help repo/R=',
  'pr update-branch': 'help rebase repo/R=',
  'pr view': 'comments/c help jq/q= json= repo/R= template/t= web/w',
  'preview prompter': 'help',
  'project close': 'format= help jq/q= owner= template/t= undo',
  'project copy': 'drafts format= help jq/q= source-owner= target-owner= template/t= title=',
  'project create': 'format= help jq/q= owner= template/t= title=',
  'project delete': 'format= help jq/q= owner= template/t=',
  'project edit': 'description/d= format= help jq/q= owner= readme= template/t= title= visibility=',
  'project field-create': 'data-type= format= help jq/q= name= owner= single-select-options= template/t=',
  'project field-delete': 'format= help id= jq/q= template/t=',
  'project field-list': 'format= help jq/q= limit/L= owner= template/t=',
  'project item-add': 'format= help jq/q= owner= template/t= url=',
  'project item-archive': 'format= help id= jq/q= owner= template/t= undo',
  'project item-create': 'body= format= help jq/q= owner= template/t= title=',
  'project item-delete': 'format= help id= jq/q= owner= template/t=',
  'project item-edit': 'body= clear date= field= field-id= format= help id= iteration-id= jq/q= number= owner= project-id= single-select-option-id= template/t= text= title= url= value=',
  'project item-list': 'field= field-id= format= help jq/q= limit/L= owner= query= template/t=',
  'project link': 'help owner= repo/R= team/T=',
  'project list': 'closed format= help jq/q= limit/L= owner= template/t= web/w',
  'project mark-template': 'format= help jq/q= owner= template/t= undo',
  'project unlink': 'help owner= repo/R= team/T=',
  'project view': 'format= help jq/q= owner= template/t= web/w',
  'release create': 'discussion-category= draft/d fail-on-no-commits generate-notes help latest notes/n= notes-file/F= notes-from-tag notes-start-tag= prerelease/p repo/R= target= title/t= verify-tag',
  'release delete': 'cleanup-tag help repo/R= yes/y',
  'release delete-asset': 'help repo/R= yes/y',
  'release download': 'allow-escape-sequences archive/A= clobber dir/D= help output/O= pattern/p= repo/R= skip-existing',
  'release edit': 'discussion-category= draft help latest notes/n= notes-file/F= prerelease repo/R= tag= target= title/t= verify-tag',
  'release list': 'exclude-drafts exclude-pre-releases help jq/q= json= limit/L= order/O= repo/R= template/t=',
  'release upload': 'clobber help repo/R=',
  'release verify': 'format= help jq/q= repo/R= template/t=',
  'release verify-asset': 'format= help jq/q= repo/R= template/t=',
  'release view': 'help jq/q= json= repo/R= template/t= web/w',
  'repo archive': 'help yes/y',
  'repo autolink create': 'help numeric/n repo/R=',
  'repo autolink delete': 'help repo/R= yes',
  'repo autolink list': 'help jq/q= json= repo/R= template/t= web/w',
  'repo autolink view': 'help jq/q= json= repo/R= template/t=',
  'repo clone': 'help no-upstream upstream-remote-name/u=',
  'repo create': 'add-readme clone/c description/d= disable-issues disable-wiki gitignore/g= help homepage/h= include-all-branches internal license/l= private public push remote/r= source/s= team/t= template/p=',
  'repo delete': 'accept-cascading-deletion-of-private-forks help yes',
  'repo deploy-key add': 'allow-write/w help repo/R= title/t=',
  'repo deploy-key delete': 'help repo/R=',
  'repo deploy-key list': 'help jq/q= json= repo/R= template/t=',
  'repo edit': 'accept-visibility-change-consequences add-topic= allow-forking allow-update-branch default-branch= delete-branch-on-merge description/d= enable-advanced-security enable-auto-merge enable-discussions enable-issues enable-merge-commit enable-projects enable-rebase-merge enable-secret-scanning enable-secret-scanning-push-protection enable-squash-merge enable-wiki help homepage/h= remove-topic= squash-merge-commit-message= template visibility=',
  'repo fork': 'clone default-branch-only fork-name= help org= remote remote-name=',
  'repo gitignore list': 'help',
  'repo gitignore view': 'help',
  'repo license list': 'help',
  'repo license view': 'help web/w',
  'repo list': 'archived fork help jq/q= json= language/l= limit/L= no-archived source template/t= topic= visibility=',
  'repo read-dir': 'help jq/q= json= ref= repo/R= template/t=',
  'repo read-file': 'allow-escape-sequences clobber help jq/q= json= output/o= ref= repo/R= template/t=',
  'repo rename': 'help repo/R= yes/y',
  'repo set-default': 'help unset/u view/v',
  'repo sync': 'branch/b= force help source/s=',
  'repo unarchive': 'help yes/y',
  'repo view': 'branch/b= help jq/q= json= template/t= web/w',
  'ruleset check': 'default help repo/R= web/w',
  'ruleset list': 'help limit/L= org/o= parents/p repo/R= web/w',
  'ruleset view': 'help org/o= parents/p repo/R= web/w',
  'run cancel': 'force help repo/R=',
  'run delete': 'help repo/R=',
  'run download': 'dir/D= help name/n= pattern/p= repo/R=',
  'run list': 'all/a branch/b= commit/c= created= event/e= help jq/q= json= limit/L= repo/R= status/s= template/t= user/u= workflow/w=',
  'run rerun': 'debug/d failed help job/j= repo/R=',
  'run view': 'attempt/a= exit-status help job/j= jq/q= json= log log-failed repo/R= template/t= verbose/v web/w',
  'run watch': 'compact exit-status help interval/i= repo/R=',
  'search code': 'extension= filename= help jq/q= json= language= limit/L= match= owner= repo/R= size= template/t= web/w',
  'search commits': 'author= author-date= author-email= author-name= committer= committer-date= committer-email= committer-name= hash= help jq/q= json= limit/L= merge order= owner= parent= repo/R= sort= template/t= tree= visibility= web/w',
  'search issues': 'app= archived assignee= author= closed= commenter= comments= created= help include-prs interactions= involves= jq/q= json= label= language= limit/L= locked match= mentions= milestone= no-assignee no-label no-milestone no-project order= owner= project= reactions= repo/R= search-type= sort= state= team-mentions= template/t= updated= visibility= web/w',
  'search prs': 'app= archived assignee= author= base/B= checks= closed= commenter= comments= created= draft head/H= help interactions= involves= jq/q= json= label= language= limit/L= locked match= mentions= merged merged-at= milestone= no-assignee no-label no-milestone no-project order= owner= project= reactions= repo/R= review= review-requested= reviewed-by= sort= state= team-mentions= template/t= updated= visibility= web/w',
  'search repos': 'archived created= followers= forks= good-first-issues= help help-wanted-issues= include-forks= jq/q= json= language= license= limit/L= match= number-topics= order= owner= size= sort= stars= template/t= topic= updated= visibility= web/w',
  'secret delete': 'app/a= env/e= help org/o= repo/R= user/u',
  'secret list': 'app/a= env/e= help jq/q= json= org/o= repo/R= template/t= user/u',
  'secret set': 'app/a= body/b= env/e= env-file/f= help no-repos-selected no-store org/o= repo/R= repos/r= user/u visibility/v=',
  'skill install': 'agent= all allow-hidden-dirs dir= force/f from-local help pin= scope= upstream',
  'skill list': 'agent= dir= help jq/q= json= scope= template/t=',
  'skill preview': 'allow-hidden-dirs help',
  'skill publish': 'dry-run fix help tag=',
  'skill search': 'help jq/q= json= limit/L= owner= page= template/t=',
  'skill update': 'all dir= dry-run force help unpin',
  'ssh-key add': 'help title/t= type=',
  'ssh-key delete': 'help yes/y',
  'ssh-key list': 'help',
  'status': 'exclude/e= help org/o=',
  'variable delete': 'env/e= help org/o= repo/R=',
  'variable get': 'env/e= help jq/q= json= org/o= repo/R= template/t=',
  'variable list': 'env/e= help jq/q= json= org/o= repo/R= template/t=',
  'variable set': 'body/b= env/e= env-file/f= help org/o= repo/R= repos/r= visibility/v=',
  'workflow disable': 'help repo/R=',
  'workflow enable': 'help repo/R=',
  'workflow list': 'all/a help jq/q= json= limit/L= repo/R= template/t=',
  'workflow run': 'field/F= help json raw-field/f= ref/r= repo/R=',
  'workflow view': 'help ref/r= repo/R= web/w yaml/y',
};

const KNOWN = new Map(Object.entries(COMMANDS).map(([path, flags]) => [path, new Map(flags.split(' ').map((spec) => {
  const [names, value] = [spec.replace(/=$/, ''), spec.endsWith('=')];
  const [long, short] = names.split('/');
  return [long, { long, short, value }];
}))]));

const READS = new Set(['list', 'view', 'status', 'diff', 'checks']);
/** Commands that run another program, whose posts the check cannot see (G6). */
const RUNS_OTHERS = new Set(['copilot', 'extension exec', 'preview prompter']);
/** Flags whose text the check cannot determine (G6). */
const UNDETERMINED = new Set(['web', 'editor', 'fill', 'fill-first', 'fill-verbose', 'recover']);
/** Commands that pass a file's bytes to the forge as something other than a post's text (G7). */
const SENDS_FILES = new Set(['release upload', 'gist create', 'gist edit', 'ssh-key add', 'gpg-key add',
  'repo deploy-key add', 'alias import', 'codespace cp', 'attestation verify', 'attestation trusted-root']);
/** Flags that do the same (G7). */
const FILE_FLAGS = new Set(['attach', 'env-file', 'source', 'bundle', 'custom-trusted-root', 'tuf-root']);
/** Flags whose value names a file of the post's text, or `-` for standard input. */
const TEXT_FILES = new Set(['body-file', 'notes-file', 'from-file', 'input']);
/** Commands that read their text from standard input where no flag gives it. */
const STDIN_UNLESS = { 'secret set': ['body'], 'variable set': ['body'] };
const STDIN_FLAGS = { 'workflow run': 'json', 'auth login': 'with-token' };
/** What a command needs given, or it would prompt for its text: each inner list needs one of. */
const PROMPTS = {
  'issue create': [['title'], ['body', 'body-file']],
  'pr create': [['title'], ['body', 'body-file']],
  'discussion create': [['title'], ['body', 'body-file']],
  'issue comment': [['body', 'body-file', 'delete-last']],
  'pr comment': [['body', 'body-file', 'delete-last']],
  'discussion comment': [['body', 'body-file']],
  'pr review': [['approve', 'comment', 'request-changes']],
  'release create': [['notes', 'notes-file', 'generate-notes', 'notes-from-tag']],
  'pr merge': [['merge', 'squash', 'rebase', 'auto', 'disable-auto']],
};
const EDITS = new Set(['issue edit', 'pr edit', 'discussion edit']);

/** The longest known command path that argv starts with. */
function commandOf(argv) {
  let path;
  for (let length = 1; length <= argv.length && !argv[length - 1].startsWith('-'); length += 1) {
    const candidate = argv.slice(0, length).join(' ');
    if (KNOWN.has(candidate)) path = candidate;
  }
  return path;
}

const refused = (row, place) => ({ row, place, parts: [] });

/** The row a `gh` command falls in, and the parts of it to check: arguments, files and standard input. */
export function decide(argv) {
  if (argv.length === 1 && argv[0] === '--version') return { row: 'G1', parts: [] };
  if (argv[0] === 'help') return { row: 'G1', parts: [] };
  const path = commandOf(argv);
  if (!path) return refused('G6', 'a command the check does not know');
  if (RUNS_OTHERS.has(path)) return refused('G6', 'a command that runs another program');
  const known = KNOWN.get(path);
  const byShort = new Map([...known.values()].filter(({ short }) => short).map((flag) => [flag.short, flag]));
  const depth = path.split(' ').length;
  const given = new Map();
  const parts = [];
  const positionals = [];
  // A file part keeps the index of the token that names it and the text before its path there.
  const add = (flag, text, place, token, before) => {
    given.set(flag.long, [...(given.get(flag.long) ?? []), text]);
    if (TEXT_FILES.has(flag.long)) {
      parts.push(text === '-' ? { kind: 'stdin', place } : { kind: 'file', place, path: text, token, before });
    } else if (path === 'api' && flag.long === 'field' && /^[^=]*=@/.test(text)) {
      const field = text.slice(0, text.indexOf('=@') + 2);
      const file = text.slice(field.length);
      parts.push(file === '-' ? { kind: 'stdin', place } : { kind: 'file', place, path: file, token, before: before + field });
    } else parts.push({ kind: 'arg', place, text });
  };
  for (let index = depth; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      for (const rest of argv.slice(index + 1)) { positionals.push(rest); parts.push({ kind: 'arg', place: `argument ${index + 2 + positionals.length - 1}`, text: rest }); }
      break;
    }
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split(/=(.*)/s);
      const flag = known.get(name);
      if (!flag) return refused('G6', 'a flag the check does not know');
      if (flag.value) {
        const separate = inline === undefined;
        const text = separate ? argv[++index] : inline;
        if (text === undefined) return refused('G6', `--${name}`);
        add(flag, text, `--${name}`, index, separate ? '' : `--${name}=`);
      } else {
        if (inline !== undefined && !/^(?:true|false)$/.test(inline)) return refused('G6', `--${name}`);
        if (inline !== 'false') given.set(flag.long, []);
      }
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      for (let at = 1; at < token.length; at += 1) {
        const flag = byShort.get(token[at]);
        if (!flag) return refused('G6', 'a flag the check does not know');
        if (flag.value) {
          const joined = at + 1 < token.length;
          const before = joined ? token.slice(0, at + 1) + (token[at + 1] === '=' ? '=' : '') : '';
          const text = joined ? token.slice(before.length) : argv[++index];
          if (text === undefined) return refused('G6', `-${flag.short}`);
          add(flag, text, `-${flag.short}`, index, before);
          break;
        }
        given.set(flag.long, []);
      }
      continue;
    }
    positionals.push(token);
    parts.push({ kind: 'arg', place: `argument ${index + 1}`, text: token });
  }
  const has = (name) => given.has(name);
  for (const name of given.keys()) if (UNDETERMINED.has(name)) return refused('G6', `--${name}`);
  if (has('template') && (path === 'issue create' || path === 'pr create')) return refused('G6', '--template');
  if (SENDS_FILES.has(path)) return refused('G7', 'a file the command sends');
  for (const name of given.keys()) if (FILE_FLAGS.has(name)) return refused('G7', `--${name}`);
  if (path === 'release create' && positionals.length > 1) return refused('G7', 'a file the command sends');
  for (const needs of PROMPTS[path] ?? []) if (!needs.some(has)) return refused('G6', 'a prompt for its text');
  if (path === 'pr review' && (has('comment') || has('request-changes')) && !has('body') && !has('body-file')) return refused('G6', 'a prompt for its text');
  if (EDITS.has(path) && ![...given.keys()].some((name) => name !== 'repo' && name !== 'help')) return refused('G6', 'a prompt for its text');
  if (path === 'repo create' && positionals.length === 0) return refused('G6', 'a prompt for its text');
  if (STDIN_UNLESS[path] && !STDIN_UNLESS[path].some(has)) parts.push({ kind: 'stdin', place: 'standard input' });
  if (STDIN_FLAGS[path] && has(STDIN_FLAGS[path])) parts.push({ kind: 'stdin', place: 'standard input' });
  if (parts.filter(({ kind }) => kind === 'stdin').length > 1) return refused('G6', 'standard input read twice');
  if (path === 'api') {
    const method = given.get('method')?.at(-1)?.toUpperCase();
    const sends = ['field', 'raw-field', 'input'].some(has);
    return { row: (method === undefined || method === 'GET') && !sends ? 'G1' : 'G5', parts };
  }
  const read = path === 'auth status' || path.startsWith('search ')
    || (depth > 1 && READS.has(path.split(' ').at(-1)));
  if (read) return { row: 'G1', parts };
  if (parts.some(({ kind }) => kind === 'stdin')) return { row: 'G4', parts };
  if (parts.some(({ kind }) => kind === 'file')) return { row: 'G3', parts };
  return { row: 'G2', parts };
}

/** How a refusal names a part: the flag, the argument's position, standard input, or a file a flag named. */
function placeOf(part, entries) {
  if (part.kind === 'file') return `the file ${part.place} named, ${placeName(part.path, entries)}`;
  if (part.kind === 'stdin') return part.place === 'standard input' ? part.place : `standard input, by ${part.place}`;
  return part.place;
}

/**
 * Why the command is refused, one line each, or none where it may run. \`list\` is #1486's
 * \`listState\` answer; \`bytesOf\` gives the bytes of a file or standard-input part.
 */
export function refusalsFor(decision, list, bytesOf) {
  if (decision.row === 'G1') return [];
  if (list.refusal) return [`refused: ${list.refusal}.`];
  const { entries } = list;
  if (decision.row === 'G6' || decision.row === 'G7') {
    return [wording(entries, `refused: ${decision.row}, the text could not be checked: ${decision.place}.`,
      `refused: ${decision.row}, the text could not be checked.`) ?? `refused: ${decision.row}.`];
  }
  const found = new Map();
  for (const part of decision.parts) {
    const bytes = part.kind === 'arg' ? Buffer.from(part.text) : bytesOf(part);
    for (const { line } of addedLines(bytes, [])) {
      for (const row of rowsIn(line, entries)) found.set(`${row} ${placeOf(part, entries)}`, { row, place: placeOf(part, entries) });
    }
  }
  return [...found.values()].map(({ row, place }, index) => refusalLine(row, place, index + 1, entries));
}

/** The arguments for the real \`gh\`: each file a flag named replaced by the copy that was checked. */
export function argumentsFor(argv, decision, copies) {
  const out = [...argv];
  for (const part of decision.parts) if (part.kind === 'file') out[part.token] = part.before + copies.get(part);
  return out;
}

/** A reason to refuse that is safe to print: it holds nothing the post or the list holds. */
class Unchecked extends Error {}

/**
 * Runs one \`gh\` command: a G1 read at once; anything else only once its text passes, with the
 * bytes that were checked. Returns the exit status. No \`gh\` starts where the check fails.
 */
function post(argv) {
  const decision = decide(argv);
  if (decision.row === 'G1') return finish(spawnSync('gh', argv, { stdio: 'inherit' }));
  const list = readList();
  const entries = list.entries ?? [];
  let directory;
  try {
    const bytes = new Map();
    let input;
    if (!list.refusal && decision.row !== 'G6' && decision.row !== 'G7') {
      for (const part of decision.parts) {
        if (part.kind === 'arg') continue;
        try { bytes.set(part, readFileSync(part.kind === 'stdin' ? 0 : part.path)); }
        catch { throw new Unchecked(part.kind === 'stdin' ? 'standard input could not be read' : 'a file it names could not be read'); }
        if (part.kind === 'stdin') input = bytes.get(part);
      }
    }
    const lines = refusalsFor(decision, list, (part) => bytes.get(part));
    if (lines.length > 0) { for (const line of lines) process.stderr.write(`${line}\n`); return 1; }
    directory = mkdtempSync(join(tmpdir(), 'rigger-post-check-'));
    const copies = new Map();
    for (const part of decision.parts) {
      if (part.kind !== 'file') continue;
      const copy = join(directory, String(copies.size));
      writeFileSync(copy, bytes.get(part), { mode: 0o600 });
      copies.set(part, copy);
    }
    return finish(spawnSync('gh', argumentsFor(argv, decision, copies), {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'], input,
    }));
  } catch (error) {
    const reason = error instanceof Unchecked ? error.message : 'the check failed';
    process.stderr.write(`${wording(entries, `refused: the post could not be checked: ${reason}.`, 'refused.') ?? 'no'}\n`);
    return 1;
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

/** The real \`gh\`'s exit status, or 1 where it could not start or was ended by a signal. */
function finish(result) {
  if (result.error) { process.stderr.write(`gh could not start: ${result.error.code ?? 'error'}\n`); return 1; }
  return result.status ?? 1;
}

if (import.meta.main) process.exitCode = post(process.argv.slice(2));
