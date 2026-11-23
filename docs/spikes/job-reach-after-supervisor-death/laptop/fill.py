# ABOUTME: Card #1460: fills the report template's {{run:BLOCK}} and {{entry:N}} markers with lines copied verbatim from
# the committed transcript, so every quoted listing and call is character for character what the transcript holds.
import re, sys
tpath, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(tpath).read().split('\n')
entries = {}
cur = None
for l in lines:
    m = re.match(r'=== entry (\d+) ', l)
    if m: cur = int(m.group(1)); entries[cur] = []
    if cur: entries[cur].append(l)
RUNS = {'a1': 11, 'a2': 12, 'a3': 13, 'a4': 14, 'b2': 15, 'b1': 16, 'b3': 38}
def span(e, start_pat, end_pat, extra_after=None):
    out, on = [], False
    for i, l in enumerate(e):
        if not on and re.search(start_pat, l): on = True
        if on:
            out.append(l)
            if re.search(end_pat, l):
                if extra_after:
                    for l2 in e[i + 1:]:
                        if re.search(extra_after, l2): out.append(l2); break
                return out
    raise SystemExit(f'span not found: {start_pat}')
def block(run, kind):
    e = entries[RUNS[run]]
    if kind == 'BEFORE': return span(e, rf'^listing run={run} \[BEFORE THE KILL', rf'^tagged fx1460-{run}-')
    if kind == 'AFTERKILL': return span(e, rf'^listing run={run} \[AFTER THE KILL', rf'^tagged fx1460-{run}-')
    if kind == 'LATE': return span(e, rf'^listing run={run} \[AT LEAST 10 S', rf'^tagged fx1460-{run}-', r'runner session chain \(still open\)')
    if kind == 'KILL': return [l for l in e if re.search(r' kill: | spawned \["taskkill\.exe"|taskkill\.exe /F /PID \d+ exited|Z supervisor alive:', l)]
    if kind == 'FRESH':
        i = next(i for i, l in enumerate(e) if 'its output:' in l); j = next(i for i, l in enumerate(e) if 'fresh process done' in l)
        return [l for l in e[i:j] if 'fresh job report' not in l]
    if kind == 'LABEL': return [l for l in e if 'own token mandatory label' in l]
    if kind == 'LIMITS': return [l for l in e if re.search(r'Z (CreateJobObjectW|SetInformationJobObject|QueryInformationJobObject\(JobObjectExtendedLimitInformation\)|AssignProcessToJobObject)', l) and 'fresh' not in l][:4]
    if kind == 'JOBS': return [l for l in e if 'job report:' in l]
    if kind == 'VERSIONS': return [l for l in e if 'Z versions:' in l]
    if kind == 'CMD': return [e[1]]
    if kind == 'HEAD': return [e[0]]
    if kind == 'END': return [l for l in e if l.startswith('--- exit=')]
    raise SystemExit(kind)
def session_rows():
    rows = []
    for run in ['a1', 'a2', 'a3', 'a4', 'b2', 'b1', 'b3']:
        late = block(run, 'LATE')
        at = re.search(r' at (\S+Z) on', late[0]).group(1)
        chain = late[-1].split(' ')[0]
        end = re.search(r'end=(\S+)', block(run, 'END')[0]).group(1)
        rows.append(f'| {run} | {at} | {chain} | {end} |')
    return '\n'.join(rows)
def sweep(kind):
    e = entries[44]
    i = next(i for i, l in enumerate(e) if l.startswith('PID     CREATED')); j = next(i for i, l in enumerate(e) if l.startswith('processes listed'))
    if kind == 'LISTING': return '\n'.join(l.rstrip('\r') for l in e[i:j])
    return '\n'.join(l.rstrip('\r') for l in [e[1]] + [e[3]] + e[j:j + 4])
def entry(n): return entries[n][:-1] if entries[n][-1] == '' else entries[n]
out = open(src).read()
last = entries[max(entries)][0]
out = out.replace('{{ENTRYCOUNT}}', str(len(entries))).replace('{{LASTENTRY}}', re.search(r'start=(\S+?)\.\d+Z', last).group(1) + 'Z').replace('{{RAWSHA}}', sys.argv[6])
out = out.replace('{{SESSIONROWS}}', session_rows()).replace('{{SWEEPSUMMARY}}', sweep('SUMMARY')).replace('{{SWEEPLISTING}}', sweep('LISTING'))
for key, path in (('LAPTOPLISTING', sys.argv[4]), ('CREDSCAN', sys.argv[5]), ('REDACTIONS', sys.argv[7]), ('MASKTABLE', sys.argv[8])):
    body = open(path).read().rstrip('\n')
    if key == 'LAPTOPLISTING': body = '\n'.join(body.split('\n')[1:])
    out = out.replace('{{' + key + '}}', body)
out = re.sub(r'\{\{(\w\d):(\w+)\}\}', lambda m: '\n'.join(block(m.group(1), m.group(2))), out)
out = re.sub(r'\{\{entry:(\d+)\}\}', lambda m: '\n'.join(entry(int(m.group(1)))), out)
open(dst, 'w').write(out)
