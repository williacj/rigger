# ABOUTME: Card #1460: accounts for every credential-scan match in the report, its journal entry and its evidence, by file and class.
import os, re, sys, collections
PAT = re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{20,}|(?:password|passwd|secret|token|api[_-]?key)[ \t\f\v\r]*[:=]', re.I)
CLASS = [('a tool call\'s own description', r'"description": "[^"]*Token: matches'),
         ('the scan pattern itself, in a command or script', r'gh\[pousr\]_|sk-ant-\[|github_pat_\[|\[_-\]\?key|PRIVATE KEY\|'),
         ('counts a scan printed', r'^distinct matched texts |^\s*(?:\[\d+\] )?\d+ (?:github_pat_|sk-ant-|token:|Token:|OpenProcessToken:|\w*[Tt]oken:)\s*$|^\s*\d+\s+\S*[Tt]oken:'),
         ('the koffi binding OpenProcessToken, or a copy or mention of it', r'OpenProcessToken'),
         ("the comment 'own token:' in w.cjs, or a copy of it", r'own token:'),
         ('prose about the scan', r'`(?:github_pat_|sk-ant-|token:|Token:|OpenProcessToken)|carries `sk-ant|fragment|token.{0,12} and .{0,4}Token|matches? (?:only|itself)')]
tot = collections.Counter(); un = []; texts = set()
for root in sys.argv[1:]:
    files = [os.path.join(d, f) for d, _, fs in os.walk(root) for f in fs] if os.path.isdir(root) else [root]
    for f in sorted(files):
        for i, l in enumerate(open(f, errors='replace', newline='').read().split('\n'), 1):
            ms = [m.group(0) for m in PAT.finditer(l)]
            if not ms: continue
            texts.update(re.sub(r'\s', '', m) for m in ms)
            c = "this script's own source" if os.path.basename(f) == 'scan-account.py' else next((n for n, r in CLASS if re.search(r, l)), None)
            if c is None: un.append((os.path.basename(f), i, len(ms)))
            else: tot[(os.path.basename(f), c)] += len(ms)
for (f, c), n in sorted(tot.items()): print(f'{n} in {f}, {c}')
print('distinct matched texts', sorted(texts))
print('matches accounted for', sum(tot.values()), 'unaccounted', sum(x[2] for x in un), [f'{a} at {b}' for a, b, _ in un][:40])
