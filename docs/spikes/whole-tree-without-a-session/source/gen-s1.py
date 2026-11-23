# ABOUTME: Card #1459: builds the WSL setup script s1: the helper library inline, each spike file as a base64 here-document, and the Node download.
# Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is withheld for privacy (1459#7104456293).
import base64, hashlib, os
W = 'wsl'
files = ['lib.sh', 'fixture.sh', 'list.cjs', 'supervisor.cjs', 'writer.cjs', 'winrec.ps1']
out = [open(os.path.join(W, 'lib.sh')).read(),
       '# ---- s1 body: make the spike directory, write its files, fetch Node, record what started.',
       'TAG=fx1459s1', 'start_record', 'mkdir -p $D/runs', 'chown [name withheld]:[name withheld] $D $D/runs', 'touch $RECF; chown [name withheld]:[name withheld] $RECF; chmod 666 $RECF',
       'say "spike directory $D"']
for f in files:
    b = base64.b64encode(open(os.path.join(W, f), 'rb').read()).decode()
    lines = [b[i:i+76] for i in range(0, len(b), 76)]
    out.append(f"base64 -d > $D/{f} <<'B64'\n" + '\n'.join(lines) + '\nB64')
    out.append(f'echo "laptop sha256 {hashlib.sha256(open(os.path.join(W, f), "rb").read()).hexdigest()}  {f}"')
out += ['cd $D && sha256sum ' + ' '.join(files),
        'say "fetch Node"',
        'curl -fsSLo node.tar.xz https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz && curl -fsSLo SHASUMS256.txt https://nodejs.org/dist/v24.19.0/SHASUMS256.txt',
        'grep " node-v24.19.0-linux-x64.tar.xz$" SHASUMS256.txt | sed "s/node-v24.19.0-linux-x64.tar.xz/node.tar.xz/" | sha256sum -c -',
        "python3 -c 'import tarfile,sys; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter=\"tar\")' node.tar.xz $D && rm node.tar.xz SHASUMS256.txt",
        'chown -R [name withheld]:[name withheld] $D',
        'echo "$ $D/node-v24.19.0-linux-x64/bin/node --version"; $D/node-v24.19.0-linux-x64/bin/node --version',
        'ls -la $D',
        'recnew "end"', 'winrec s1-end', 'say "s1 done"']
open('s1-setup.sh', 'w').write('\n'.join(out) + '\n')
print('ok')
