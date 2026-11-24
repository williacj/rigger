# ABOUTME: Throwaway for #1462: recovers each script text its runs executed, by applying the file-writing
# parts of the maker's own tool calls, as its session record holds them, in an empty directory.

# Usage: SPIKE_SESSION=<record> python3 -I recover.py <directory>
# It writes each text as it stood at each recorded run, once per distinct text, and prints which run
# executed which. Nothing is typed from memory: a part the record lacks stops it.
import hashlib, json, os, re, subprocess, sys

out = os.path.abspath(sys.argv[1])
work = os.path.join(out, '.work')
os.makedirs(work)
# The calls that wrote a script a recorded run executed, by the call's UTC time, and the runs each made.
calls = [l for l in (json.loads(line) for line in open(os.environ['SPIKE_SESSION']))]
bash = {}
for record in calls:
    for part in (record.get('message') or {}).get('content') or [] if isinstance((record.get('message') or {}).get('content'), list) else []:
        if part.get('type') == 'tool_use' and part['name'] == 'Bash' and record.get('timestamp'):
            bash.setdefault(record['timestamp'], part['input']['command'])
FILES = ['count.mjs', 'count.test.mjs', 'mutants.sh', 'rec.sh', 'fetch.sh', 'search.mjs', 'hosts.mjs', 'builds.sh', 'calc.mjs']
seen, table, n = {}, [], 0

def apply(step):
    subprocess.run(['/bin/bash', '-c', step], cwd=work, check=True, env={**os.environ, 'PATH': os.environ['PATH']}, stdout=subprocess.DEVNULL)

def snapshot(run):
    for name in FILES:
        path = os.path.join(work, name)
        if not os.path.exists(path): continue
        text = open(path, 'rb').read()
        sha = hashlib.sha256(text).hexdigest()
        if (name, sha) not in seen:
            version = 1 + sum(1 for k in seen if k[0] == name)
            seen[(name, sha)] = version
            open(os.path.join(out, f'{name}.v{version}.txt'), 'wb').write(text)
        table.append((run, name, seen[(name, sha)], sha))

run = 0
for when in sorted(bash):
    command = bash[when].replace('spikes/1462/', '')
    if '/spikes/1462' not in bash[when] and 'spikes/1462/' not in bash[when]: continue
    lines = command.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        here = re.search(r"<<'(EOF)'", line)
        if here:
            j = i + 1
            while lines[j] != 'EOF': j += 1
            block = '\n'.join(lines[i:j + 1])
            body = '\n'.join(lines[i + 1:j])
            if re.search(r'^(?:.*[;&] )?cat >>? ?(%s)' % '|'.join(map(re.escape, FILES)), line):
                apply('umask 022\n' + block[block.index('cat >'):])
            elif 'python3 -I -' in line and re.search(r"p='(%s)'" % '|'.join(map(re.escape, FILES)), body) and "open(p,'w')" in body:
                apply(block[block.index('python3'):])
            i = j + 1
            continue
        for part in re.split(r'; (?=sed -i|\./rec)|&& (?=sed -i)', line):
            edit = re.search(r"sed -i '' .*? (%s)$" % '|'.join(map(re.escape, FILES)), part.strip())
            if edit and part.strip().startswith('sed -i'): apply(part.strip())
        # Runs are counted from the recorder's own calls, in the order the line makes them.
        for made in re.findall(r'\./rec\.sh |^rec\.sh ', line) or re.findall(r'(?:^|[;(] ?)rec\.sh ', line):
            run += 1
            if run in (26, 31): run += 1
            snapshot(run)
        i += 1
subprocess.run(['rm', '-rf', work], check=True)
print('run file version sha256')
for run, name, version, sha in table:
    print(f'{run:03d} {name} v{version} {sha}')
