# ABOUTME: Card #1459: compares a final process listing with the process record's entries for one host, matching on the host's
# creation identity: boot id, pid and /proc starttime on WSL; pid and creation time on Windows; pid and start time on the laptop.
import re, sys
host, rec_file, listing = sys.argv[1:4]
L = open(listing, encoding='utf-8', errors='replace').read().split('\n')
if host == 'wsl':
    boot = re.search(r'boot_id (\S+)', L[0]).group(1)
    rec = {(m.group(1), m.group(2), m.group(3)) for l in open(rec_file) for m in [re.search(r'host=wsl boot=(\S+) pid=(\d+) starttime=(\d+)', l)] if m}
    lst = [(boot,) + tuple(l.split()[:2]) for l in L if re.match(r'^\d+ \d+ ', l)]
elif host == 'windows':
    rec = {(m.group(1), m.group(2)) for l in open(rec_file) for m in [re.search(r'host=windows pid=(\d+) ppid=\d+ created=(\S+)', l)] if m}
    lst = [tuple(l.split()[:2]) for l in L if re.match(r'^\d+ \S+ ', l)]
else:
    rec = {(m.group(1), m.group(2)) for l in open(rec_file) for m in [re.search(r'host=laptop pid=(\d+) created=(.+?) label=', l)] if m}
    lst = [(l.split()[0], ' '.join(l.split()[1:6])) for l in L if re.match(r'^ *\d+ ', l)]
hits = [x for x in lst if x in rec]
print(f'{host}: {len(lst)} processes listed, {len(rec)} record entries, {len(hits)} match on the creation identity', hits)
