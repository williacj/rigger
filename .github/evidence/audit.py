# ABOUTME: Audits complete card 615 runner outputs, traces, and manifests before any artifact upload.

import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from collections import Counter


SCRATCH = str(Path(os.environ['RUNNER_TEMP']) / 'c615-tmp')
WORKSPACE = str(Path(os.environ['GITHUB_WORKSPACE']))
# Publishable paths are the test scratch, this disposable checkout, and fixed system binaries.
# A full lsof answer has a narrower policy below: every cwd in it must be under the test scratch.
SYSTEM = ('/bin/', '/sbin/', '/usr/', '/System/', '/Library/', '/dev/', '/opt/homebrew/')
ABSOLUTE = re.compile(r'/(?:Users|System|usr|bin|sbin|Library|dev|private|tmp|Volumes|var|opt|Applications|etc)/[^\s"\x27<>|,;)}\]]+')
CREDENTIALS = (
    re.compile(rb'ghp_[A-Za-z0-9_]+'),
    re.compile(rb'github_pat_[A-Za-z0-9_]+'),
    re.compile(rb'gh[ousr]_[A-Za-z0-9._-]+'),
    re.compile(rb'(?i)https?://[^\s/@]+@[^\s/@"\\]+'),
    re.compile(rb'sk-[A-Za-z0-9]{16,}'),
    re.compile(rb'AKIA[0-9A-Z]{16}'),
    re.compile(rb'xox[baprs]-[A-Za-z0-9-]{16,}'),
    re.compile(rb'npm_[A-Za-z0-9]{16,}'),
    re.compile(rb'(?i)Bearer\s+[A-Za-z0-9._-]{20,}'),
    re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    re.compile(rb'(?i)Authorization:\s*\S+'),
)


def expected(ids):
    return ('runner.log', *(f'{test}.trace.jsonl' for test in ids))


def safe_path(value):
    return (
        value == SCRATCH or value.startswith(SCRATCH + '/')
        or value == WORKSPACE or value.startswith(WORKSPACE + '/')
        or value.startswith(SYSTEM)
    )


def scan_bytes(data):
    issues = Counter()
    if any(pattern.search(data) for pattern in CREDENTIALS):
        issues['credential_pattern'] += 1
    try:
        printed = data.decode('utf-8')
    except UnicodeDecodeError:
        issues['non_utf8_output'] += 1
        return issues
    for match in ABSOLUTE.finditer(printed):
        if not safe_path(match.group()):
            issues['path_outside_policy'] += 1
    return issues


def inspect_trace(data):
    issues = Counter()
    try:
        records = [json.loads(line) for line in data.splitlines()]
    except (json.JSONDecodeError, UnicodeDecodeError):
        issues['malformed_trace'] += 1
        return issues
    if not records or records[0].get('kind') != 'caller':
        issues['missing_caller_record'] += 1
    if not any(record.get('kind') == 'read' for record in records):
        issues['missing_read_record'] += 1
    for record in records:
        if record.get('kind') != 'read' or not str(record.get('tool', '')).endswith('/lsof'):
            continue
        for row in (record.get('stdout') or '').splitlines():
            if row.startswith('n') and not (row[1:] == SCRATCH or row[1:].startswith(SCRATCH + '/')):
                issues['unrelated_lsof_cwd'] += 1
    return issues


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_manifest(run, ids):
    issues = Counter()
    lines = []
    for name in expected(ids):
        path = run / name
        if not path.is_file():
            issues['missing_file'] += 1
            continue
        data = path.read_bytes()
        lines.append(f'{name}\t{len(data)}\t{digest(data)}')
    if issues:
        return issues
    (run / 'manifest.tsv').write_text('\n'.join(lines) + '\n')
    return issues


def audit(run, ids):
    issues = Counter()
    names = set(expected(ids))
    actual = {path.name for path in run.iterdir()} if run.is_dir() else set()
    if actual != names | {'manifest.tsv'}:
        issues['file_inventory'] += 1
    manifest = run / 'manifest.tsv'
    if not manifest.is_file():
        issues['missing_manifest'] += 1
        return issues
    manifest_data = manifest.read_bytes()
    issues.update(scan_bytes(manifest_data))
    try:
        rows = [line.split('\t') for line in manifest_data.decode('utf-8').splitlines()]
        listed = {name: (int(size), sha) for name, size, sha in rows}
    except (UnicodeDecodeError, ValueError):
        issues['malformed_manifest'] += 1
        return issues
    if set(listed) != names:
        issues['manifest_inventory'] += 1
    if len(rows) != len(names):
        issues['manifest_rows'] += 1
    for name in names:
        path = run / name
        if not path.is_file():
            issues['missing_file'] += 1
            continue
        data = path.read_bytes()
        issues.update(scan_bytes(data))
        if name.endswith('.trace.jsonl'):
            issues.update(inspect_trace(data))
        if name == 'runner.log' and not all(field in data for field in (b'BASE ', b'START_LOAD ', b'END_LOAD ', b'CPU ', b'EXIT ')):
            issues['runner_metadata'] += 1
        if listed.get(name) != (len(data), digest(data)):
            issues['byte_mismatch'] += 1
    return issues


def self_test():
    safe = ('{"kind":"caller"}\n{"kind":"read","tool":"/usr/sbin/lsof","stdout":"p1\\nu501\\nfcwd\\nn'
            + SCRATCH + '/work\\n"}\n{"kind":"append","file":"events"}\n').encode()
    assert not scan_bytes(safe)
    assert not inspect_trace(safe)
    outside = safe.replace((SCRATCH + '/work').encode(), b'/Users/other/Library/private')
    assert scan_bytes(outside)['path_outside_policy'] > 0
    assert inspect_trace(outside)['unrelated_lsof_cwd'] > 0
    assert scan_bytes(b'Authorization: Bearer exampletoken1234567890')['credential_pattern'] > 0
    for credential in (
        b'gho_examplecredential',
        b'ghu_examplecredential',
        b'ghs_1234.eyJhbGciOiJIUzI1NiJ9.signature',
        b'ghr_examplecredential',
        b'https://user:password@example.com/repo.git',
        b'https://exampletoken@example.com/repo.git',
    ):
        assert scan_bytes(credential)['credential_pattern'] > 0
    assert inspect_trace(b'{bad json')['malformed_trace'] > 0
    with tempfile.TemporaryDirectory(dir=os.environ['RUNNER_TEMP']) as temporary:
        run = Path(temporary)
        (run / 'runner.log').write_text('BASE base\nSTART_LOAD load\nEND_LOAD load\nCPU 4\nEXIT 0\n')
        (run / '1038.trace.jsonl').write_bytes(safe)
        assert not write_manifest(run, ('1038',))
        assert not audit(run, ('1038',))
        (run / '1038.trace.jsonl').write_bytes(outside)
        assert audit(run, ('1038',))['byte_mismatch'] > 0
    print('CARD615_AUDIT_SELF_TEST_PASS')


def main():
    mode = sys.argv[1]
    if mode == '--self-test':
        self_test()
        return 0
    run = Path(sys.argv[2])
    ids = tuple(sys.argv[3:])
    if mode == '--manifest':
        issues = write_manifest(run, ids)
    elif mode == '--audit':
        issues = audit(run, ids)
    else:
        issues = Counter({'invalid_mode': 1})
    if issues:
        print(f'CARD615_AUDIT_BLOCKED {dict(sorted(issues.items()))}')
        return 1
    print(f'CARD615_AUDIT_PASS files={len(expected(ids)) + 1}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
