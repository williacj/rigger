# ABOUTME: Card #1459: builds the process record from the step transcript: every REC line (WSL and Windows) and every fixture MEMBER
# line, with the step it came from. A MEMBER line takes its boot id from the latest supervisor record for its run name before the
# step that printed it, so a run name used twice (rl-n2 in rlb and rlc, rs-n2 in rsb and rsc) keeps each execution's own boot.
import re, sys, collections
t = open('transcript.txt', encoding='utf-8', errors='replace').read().split('\n')
step = None; out = []; seen = set(); runboot = {}
cur_run = None
for l in t:
    m = re.match(r'### step (\S+)', l)
    if m: step = m.group(1); continue
    m = re.match(r'=== FILE \S+/runs/([^/]+)/members.txt', l)
    if m: cur_run = m.group(1); continue
    if l.startswith('=== END'): cur_run = None; continue
    m = re.match(r'REC host=wsl boot=(\S+) pid=(\d+) starttime=(\d+).*label=supervisor:(\S+)', l)
    if m: runboot[m.group(4)] = m.group(1)
    if l.startswith('REC host='):
        k = re.sub(r' recorded=\S+', '', l)
        if k in seen: continue
        seen.add(k); out.append(f'step={step} {l}')
    m = re.match(r'MEMBER (\S+) (\d+) (\d+) (\S+)$', l)
    if m and cur_run:
        k = ('M', cur_run, m.group(2), m.group(3))
        if k in seen: continue
        seen.add(k)
        out.append(f'step={step} REC host=wsl boot={runboot.get(cur_run, "?")} pid={m.group(2)} starttime={m.group(3)} recorded={m.group(4)} label=member:{cur_run}:{m.group(1)} (written by the process that started it, into the run\'s members.txt)')
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
c = collections.Counter(re.search(r'host=(\w+)', x).group(1) for x in out)
print(len(out), dict(c))
