# ABOUTME: Card #1459: builds WSL step s2: the helper library inline, the s2 body, the updated spike files as base64, and the interop login probe.
import base64, hashlib, os
W = 'wsl'
files = ['lib.sh', 'fixture.sh', 'list.cjs', 'supervisor.cjs', 'writer.cjs', 'winrec.ps1']
out = [open(os.path.join(W, 'lib.sh')).read(), open('s2-body.sh').read()]
for f in files:
    data = open(os.path.join(W, f), 'rb').read(); b = base64.b64encode(data).decode()
    out.append(f"base64 -d > $D/{f} <<'B64'\n" + '\n'.join(b[i:i+76] for i in range(0, len(b), 76)) + '\nB64')
    out.append(f'echo "laptop sha256 {hashlib.sha256(data).hexdigest()}  {f}"')
out.append(open('s2-tail.sh').read())
open('s2.sh', 'w').write('\n'.join(out) + '\n'); print('ok')
