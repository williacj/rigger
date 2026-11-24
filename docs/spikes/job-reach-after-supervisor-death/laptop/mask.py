# ABOUTME: Card #1460: the structural masking the committed transcript and session log share. It keeps the spike's own process
# images by an allowlist and masks any other image name where a listing or ancestor chain prints one. It holds no masked name.
import re
OWN = {'node.exe', 'cmd.exe', 'conhost.exe', 'powershell.exe', 'taskkill.exe', 'sshd.exe'}
def mask(s):
    n = [0]
    def sub(p, r, s):
        s2, k = re.subn(p, r, s, flags=re.M); n[0] += k; return s2
    # Sweep rows and pid-reuse lines keep pid and creation time; every name in them is masked.
    s = sub(r'^((?:\d+: ?)?\d+ +\d{4}-\d\d-\d\dT[\d:.]+Z +)(\S[^\r\n]*?)(\r?)$', r'\1[masked]\3', s)
    s = sub(r'(\b\d+ \d{4}-\d\d-\d\dT[\d:.]+Z) (?!\d{4}-\d\d-)([^;\n\\"]+?)(?=;|\r|$|\\n)', r'\1 [masked]', s)
    s = sub(r"(C:\\Users\\USER\\AppData\\Local\\Temp\\)[^\s\"]+", r"\1[masked]", s)
    # Ancestor chains, "name(pid)", and job lists, "pid:name(ppid": an image that is not the spike's own is masked.
    def image(m):
        if m.group(1).lower() in OWN: return m.group(0)
        n[0] += 1; return '[masked](' + m.group(2)
    s = re.sub(r'([A-Za-z][\w.-]*\.exe)\((\d+|ppid)', image, s)
    # A chain cut short by a display width can end inside an image name.
    s = sub(r'(<- )(?!(?:%s)\b)(?!\[)([A-Za-z][\w.-]*)(?=\s*$)' % '|'.join(sorted(x[:-4] for x in OWN)), r'\1[masked]', s)
    return s, n[0]
