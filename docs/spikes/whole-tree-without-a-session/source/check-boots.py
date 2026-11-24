# ABOUTME: Card #1459: checks that every fixture member in the process record carries the boot id of the supervisor execution
# that started it, taken as the latest supervisor of the same run name recorded before the member.
import re, sys
sups = []; bad = 0; n = 0
for l in open(sys.argv[1]):
    m = re.search(r'boot=(\S+) pid=\d+ starttime=\d+ recorded=(\S+) label=supervisor:(\S+)', l)
    if m: sups.append((m.group(2), m.group(3), m.group(1)))
for l in open(sys.argv[1]):
    m = re.search(r'boot=(\S+) pid=(\d+) starttime=\d+ recorded=(\S+) label=member:([^:]+):', l)
    if not m: continue
    n += 1
    cands = [s for s in sups if s[1] == m.group(4) and s[0] <= m.group(3)]
    want = max(cands)[2] if cands else None
    if want != m.group(1): bad += 1; print('MISMATCH', l.strip()[:160], 'supervisor boot', want)
print(f'{n} member entries checked, {bad} carry a boot other than their own supervisor execution\'s')
