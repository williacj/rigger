# ABOUTME: Card #1460: turns the spike engineer's retained session record (JSON lines) into a plain-text log of every tool call.
# Usage: gen-session-log.py <record> <out> <names.json> <blocks.json> <last call>. names.json, with the blocks and strings to mask, is kept outside the repository: a whole input
# or result that holds one of its names, in any form, is replaced. blocks.json gets each replaced block's line, call and sha256.
import hashlib, importlib.util, json, sys
from mask import mask
src, dst, names, blocks, LAST = *sys.argv[1:5], int(sys.argv[5])
spec = importlib.util.spec_from_file_location('holds', names.replace('names.json', 'holds.py')); H = importlib.util.module_from_spec(spec); spec.loader.exec_module(H)
WITHHELD = {150}
uses, results, order = {}, {}, []
for line in open(src):
    d = json.loads(line); c = d.get('message', {}).get('content')
    if d.get('type') not in ('assistant', 'user') or not d.get('timestamp') or not isinstance(c, list): continue
    for x in c:
        if x.get('type') == 'tool_use' and x['id'] not in uses:
            uses[x['id']] = (d['timestamp'], x['name'], x['input']); order.append(x['id'])
        if x.get('type') == 'tool_result':
            b = x.get('content')
            if isinstance(b, list): b = '\n'.join(y.get('text', '[non-text block]') if isinstance(y, dict) else str(y) for y in b)
            results[x['tool_use_id']] = (d['timestamp'], bool(x.get('is_error')), b or '')
out = ["ABOUTME: The tool calls in the #1460 spike engineer's retained session record, with UTC times, host, input and result.", '',
       'Times are UTC: the first is when the call was issued, the second when its result returned. "host" is read from the command text.',
       'Names of processes and programs that are not the spike\'s own are masked, in place by structure or as a whole block; the report lists every whole block with its sha256. Raw ESC bytes are written as the text \\x1b.', '']
table = []
def emit(n, kind, text):
    if n in WITHHELD and kind == 'input': note = '[withheld: see the report]'
    elif (n, kind) in H.BLOCKS or H.holds(mask(text)[0]): note = '[masked]'
    else: out.extend(H.strings(mask(text)[0], kind).replace('\x1b', '\\x1b').split('\n')); return
    out.append(note); table.append([len(out), n, kind, hashlib.sha256(text.encode()).hexdigest()])
for n, i in enumerate(order[:LAST], 1):
    t0, name, inp = uses[i]; t1, err, body = results.get(i, (None, False, '[no result recorded: the session record ends before it]'))
    cmd = inp.get('command', '') if name == 'Bash' else json.dumps(inp, ensure_ascii=False, indent=1)
    extra = '  ' + json.dumps({k: v for k, v in inp.items() if k != 'command'}, ensure_ascii=False) if name == 'Bash' else ''
    out.append(f'### {n}. {t0} -> {t1}  host={"laptop -> finnpc" if name == "Bash" and "finnpc" in cmd else "laptop"}  tool={name}{"  ERROR" if err else ""}{extra}')
    emit(n, 'input', cmd); out.append('--- result ---'); emit(n, 'result', str(body)); out.append('')
open(dst, 'w').write('\n'.join(out)); json.dump(table, open(blocks, 'w')); print(min(LAST, len(order)), 'calls;', len(table), 'whole blocks')
