# ABOUTME: Card #1459: lists, from the transcript's own listings, every process the spike knows it started but did not record at
# its start, with pid and creation time where a listing printed one. Output lines start UNRECORDED and name the listing they come from.
# Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is withheld for privacy (1459#7104456293).
import re, sys
T = open('transcript.txt', encoding='utf-8', errors='replace').read().replace('\x00', '')
def out(step):
    m = re.search(r'^### step ' + step + r' .*?(?=^### step |\Z)', T, re.M | re.S).group(0)
    return m.split('--- output ---\n', 1)[1].split('\n')
L = []
def ps_rows(step, why):
    o = out(step); i = next(k for k, l in enumerate(o) if l.startswith('--- ps -eo'))
    for l in o[i + 2:]:
        m = re.match(r'^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s+(\S+)\s+(.*)$', l)
        if not m: break
        pid, ppid, user, lstart, cg, args = m.groups()
        if user == '[name withheld]': continue
        if pid in ('577', '578') and step == 'p0b': pass
        L.append(f'UNRECORDED step={step} host=wsl pid={pid} ppid={ppid} user={user} created="{lstart}" (ps lstart, UTC, whole seconds) listed-in={step} why={why} args={args[:90]}')
ps_rows('p0b', 'probe-before-recording-existed;its-connection-started-the-WSL-distro')
ps_rows('p1', 'probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing')
for l in out('p1'):
    m = re.match(r'^\s*(\d+)\s+(\d+) (2026-11-22T02:5\S+) (vmwp\.exe|vmmemWSL|wslrelay\.exe|wslhost\.exe|conhost\.exe)\s*(.*)$', l)
    if m and m.group(3) >= '2026-11-22T02:59:21':
        L.append(f'UNRECORDED step=p1 host=windows pid={m.group(1)} ppid={m.group(2)} created={m.group(3)} listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name={m.group(4)} {m.group(5)[:80]}')
for l in out('p2'):
    m = re.match(r'^\s*(\d+)\s+(\d+)\s+(root)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s+(\S+)\s+(sshd: /usr/sbin/sshd.*)$', l)
    if m: L.append(f'UNRECORDED step=p2 host=wsl pid={m.group(1)} ppid={m.group(2)} user=root created="{m.group(4)}" listed-in=p2 why=probe-before-recording-existed;its-connection-started-the-WSL-distro args={m.group(6)[:90]}')
for l in out('w8'):
    m = re.match(r'^(\d+) (\d+) (2026-11-22T04:\S+) (sshd\.exe|cmd\.exe|conhost\.exe|powershell\.exe) (.*)$', l)
    if m and m.group(3) < '2026-11-22T04:34:00':
        L.append(f'UNRECORDED step=f1..f1d host=windows pid={m.group(1)} ppid={m.group(2)} created={m.group(3)} listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name={m.group(4)} {m.group(5)[:70]}')
open(sys.argv[1], 'w').write('\n'.join(L) + '\n')
import collections; print(len(L), collections.Counter(re.search(r'step=(\S+) host=(\S+)', x).groups() for x in L))
