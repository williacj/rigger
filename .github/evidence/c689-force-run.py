# ABOUTME: Captures audited base and head boundary proofs before making their original bytes public.

from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

BASE_SHA = 'e770812ca43c395c980fd45081695d0ad1179812'
HEAD_SHA = 'c66c28fb07469a4f9f37f662c3a4d7932d54d9d7'
BRANCH = 'tq/689-forced-evidence-r3'
WORKSPACE = Path(os.environ['GITHUB_WORKSPACE'])
SCRATCH = Path(os.environ['RUNNER_TEMP']) / 'c615-tmp'
HEAD = SCRATCH / 'head'
RAW = SCRATCH / 'c689-forced' / 'raw'
PUBLIC = SCRATCH / 'c689-forced' / 'public'
PRELOAD = WORKSPACE / '.github/evidence/c689-force-preload.cjs'
PATTERN = ('^without a prior post-kill state answer, a live answer persists until the directory read bound$'
           '|^after a failed post-kill state read and omitted listing, a spent bound starts no later state read$')
BASE_TITLE = 'without a prior post-kill state answer, a live answer persists until the directory read bound'
BASE_ASSERTION = 'the following state read did not force its chosen answer'
EXPECTED_PATHS = sorted((
    '.github/evidence/audit.py',
    '.github/evidence/c689-force-preload.cjs',
    '.github/evidence/c689-force-run.py',
    '.github/evidence/c689-trace-check.py',
    '.github/workflows/c689-forced-evidence.yml',
    'test/never-stop.test.mjs',
))


def git(where, *args):
    return subprocess.check_output(['git', '-C', str(where), *args], text=True).strip()


def require(condition, reason):
    if not condition:
        print(f'BASE_VERIFY_BLOCKED {reason}', flush=True)
        raise SystemExit(2)


def safe_counts(issues):
    counts = Counter()
    for key, value in issues.items():
        counts[key if re.fullmatch(r'[a-z_]+', key) else 'unsafe_reason_key'] += int(value)
    return dict(sorted(counts.items()))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def preflight():
    require(os.environ.get('GITHUB_REF') == 'refs/heads/' + BRANCH, 'branch')
    require(git(WORKSPACE, 'rev-parse', 'HEAD^') == BASE_SHA, 'parent_sha')
    require(not git(WORKSPACE, 'diff', '--name-only', 'HEAD^', 'HEAD', '--', 'src/'), 'source_delta')
    require(sorted(git(WORKSPACE, 'diff', '--name-only', 'HEAD^', 'HEAD').splitlines()) == EXPECTED_PATHS, 'path_inventory')
    require(git(WORKSPACE, 'diff', '--numstat', 'HEAD^', 'HEAD', '--', 'test/never-stop.test.mjs') == '1\t0\ttest/never-stop.test.mjs', 'existing_test_delta')
    marker = "+  if (listing === 'omitted' && first === 'failed' && second === 'live') writeFileSync(join(directory, 'c689-trace-id'), '689');"
    require(git(WORKSPACE, 'diff', '--unified=0', 'HEAD^', 'HEAD', '--', 'test/never-stop.test.mjs').splitlines().count(marker) == 1, 'trace_marker')
    require(git(WORKSPACE, 'hash-object', '.github/evidence/audit.py') == '968f149b318f4e4faf035752b83dc5cef03f95e3', 'audit_policy')
    require(git(WORKSPACE, 'hash-object', '.github/evidence/c689-trace-check.py') == 'b5858cec2da74127f613607cf30ea1d80c02cf60', 'trace_checker')
    require(git(WORKSPACE, 'hash-object', '.github/evidence/c689-force-preload.cjs') == '241e28ede5fd4fc136336406cfaf6035c7763314', 'forcing_preload')
    require(git(HEAD, 'rev-parse', 'HEAD') == HEAD_SHA, 'head_sha')
    require(not git(HEAD, 'diff', '--name-only', BASE_SHA, 'HEAD', '--', 'src/'), 'head_source_delta')
    require(not git(HEAD, 'status', '--porcelain=v1'), 'head_clone_dirty')
    require(os.environ['TMPDIR'] == str(SCRATCH), 'scratch_path')
    require(PRELOAD.is_file() and RAW.is_dir() and not PUBLIC.exists(), 'capture_layout')


def load_gate():
    cpu = int(subprocess.check_output(['sysctl', '-n', 'hw.logicalcpu'], text=True))
    while True:
        uptime = subprocess.check_output(['uptime'], text=True).strip()
        load = float(uptime.split('load averages: ', 1)[1].split()[0])
        processes = len(subprocess.check_output(['ps', '-U', str(os.getuid())], text=True).splitlines())
        if load <= 24 and load <= 2 * cpu and processes < 2000:
            return uptime, cpu, processes
        print(f'LOAD_GATE_WAIT load={load:.2f} cpu={cpu} processes={processes}', flush=True)
        time.sleep(10)


def diagnostic(log, run_id, mode):
    found = []
    for line in log.splitlines():
        if f'"runId":"forced-head-{run_id}"' not in line:
            continue
        try:
            item = json.loads(line[line.index('{'):])
        except (ValueError, json.JSONDecodeError):
            continue
        if mode == 'P1A' and 'clockJumps' in item:
            found.append(item)
        if mode == 'P2' and item.get('mode') == 'before-later':
            found.append(item)
    return found


def trace_expectations(mode, log, run_id):
    if mode == 'base':
        return None, None
    named = diagnostic(log, run_id, 'P1A')
    operations = named[0].get('trace', []) if len(named) == 1 else []
    if not isinstance(operations, list) or any(not isinstance(row, dict) for row in operations):
        return [], []
    boundaries = [{key: row.get(key) for key in ('phase', 'logical', 'remaining')}
                  for row in operations if row.get('operation') == 'read-boundary']
    return boundaries, operations


def complete_internal_trace(item):
    records = item.get('trace', [])
    if not records or records[-1].get('operation') != 'caller-end':
        return False
    starts = [row for row in records if row.get('operation') == 'read-start']
    ends = [row for row in records if row.get('operation') in ('read-end', 'read-threw')]
    return bool(starts) and len(starts) == len(ends) and all(isinstance(row.get('at'), int) and isinstance(row.get('argv'), list) for row in starts) and all(isinstance(row.get('at'), int) and ('status' in row or 'code' in row) for row in ends)


def protected_base_failure(log):
    lines = log.splitlines()
    markers = [index for index, line in enumerate(lines) if line == '✖ failing tests:']
    if len(markers) != 1 or len(lines) < 2 or not lines[-2].startswith('END_LOAD ') or lines[-1] != 'EXIT 1':
        return False
    marker = markers[0]
    summary = {}
    for line in lines[:marker]:
        match = re.fullmatch(r'ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)', line)
        if match:
            if match.group(1) in summary:
                return False
            summary[match.group(1)] = int(match.group(2))
    if set(summary) != {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}:
        return False
    if summary['fail'] != 1 or summary['cancelled'] != 0 or summary['todo'] != 0:
        return False
    if summary['tests'] != summary['pass'] + summary['fail'] + summary['skipped']:
        return False
    failures = [line for line in lines if line.startswith('✖ ') and line != '✖ failing tests:']
    title = re.compile(r'✖ ' + re.escape(BASE_TITLE) + r' \([\d.]+ms\)')
    if len(failures) != 2 or not all(title.fullmatch(line) for line in failures):
        return False
    detail = lines[marker + 1:-2]
    headings = [index for index, line in enumerate(detail) if line.startswith('✖ ')]
    if len(headings) != 1 or not title.fullmatch(detail[headings[0]]):
        return False
    assertions = [line.strip() for line in detail[headings[0] + 1:]
                  if line.strip().startswith('AssertionError [ERR_ASSERTION]: ')]
    if assertions != ['AssertionError [ERR_ASSERTION]: ' + BASE_ASSERTION]:
        return False
    return not any(line.startswith(('npm test:', 'npm test reaper:', 'reaper group:')) for line in lines)


def expected_outcome(mode, result, records, log, run_id):
    final = records[-1]
    event = final.get('namedEvent') or {}
    if mode == 'base':
        return (result == 1 and final.get('namedReads') == 1 and final.get('cutBoundary')
                and not final.get('laterAnsweredLive')
                and event.get('reason') == 'not shown to have ended: the process table could not be read'
                and sum(row.get('kind') == 'forced-boundary' for row in records) == 1
                and protected_base_failure(log))
    p1a = diagnostic(log, run_id, 'P1A')
    p2 = diagnostic(log, run_id, 'P2')
    return (result == 0 and final.get('namedReads', 0) >= 2 and final.get('laterAnsweredLive')
            and event.get('reason') == "still alive when L0's read bound ran out after its kill"
            and not any(row.get('kind') == 'forced-boundary' for row in records)
            and len(p1a) == 1 and complete_internal_trace(p1a[0]) and p1a[0].get('clockJumps')
            and int(p1a[0].get('stateReads', '0')) >= 2
            and any('next ps:' in note for note in p1a[0].get('notReached', []))
            and len(p2) == 1 and complete_internal_trace(p2[0])
            and any('later ps: deadline before read' in note for note in p2[0].get('notReached', []))
            and any(event.get('reason') == 'not shown to have ended: the process table could not be read' for event in p2[0].get('events', [])))


def capture(mode, run_id, auditor, checker, workflow_head):
    start, cpu, processes = load_gate()
    run = RAW / mode / run_id
    run.mkdir(parents=True)
    source = WORKSPACE if mode == 'base' else HEAD
    source_head = BASE_SHA if mode == 'base' else HEAD_SHA
    command = ['npm', 'test', '--', '--test-name-pattern=' + PATTERN, 'test/never-stop.test.mjs']
    env = os.environ.copy()
    env.update({'TMPDIR': str(SCRATCH), 'NODE_OPTIONS': '--require=' + str(PRELOAD),
                'C689_TRACE_DIR': str(run), 'RIGGER_689_RUN_ID': f'forced-{mode}-{run_id}'})
    with (run / 'runner.log').open('wb') as output:
        output.write((f'BASE {BASE_SHA}\nWORKFLOW_HEAD {workflow_head}\nSOURCE_HEAD {source_head}\nRUN_ID {mode}-{run_id}\n'
                      f'COMMAND npm test -- --test-name-pattern={PATTERN} test/never-stop.test.mjs\n'
                      f'START_LOAD {start}\nCPU {cpu}\nUSER_PROCESSES {processes}\n').encode())
        output.flush()
        result = subprocess.run(command, cwd=source, env=env, stdout=output, stderr=subprocess.STDOUT)
        end = subprocess.check_output(['uptime'], text=True).strip()
        output.write(f'END_LOAD {end}\nEXIT {result.returncode}\n'.encode())
    manifest_issues = auditor.write_manifest(run, ('689',))
    audit_issues = auditor.audit(run, ('689',))
    if manifest_issues or audit_issues:
        print(f'CARD689_PRIVACY_BLOCKED {mode}-{run_id} manifest={safe_counts(manifest_issues)} audit={safe_counts(audit_issues)}', flush=True)
        raise SystemExit(2)
    trace = (run / '689.trace.jsonl').read_bytes()
    log = (run / 'runner.log').read_text()
    trace_issues = checker.inspect(trace, *trace_expectations(mode, log, run_id))
    if trace_issues:
        print(f'CARD689_TRACE_BLOCKED {mode}-{run_id} reasons={safe_counts(trace_issues)}', flush=True)
        raise SystemExit(2)
    records = [json.loads(line) for line in trace.splitlines()]
    if not expected_outcome(mode, result.returncode, records, log, run_id):
        print(f'CARD689_OUTCOME_BLOCKED {mode}-{run_id} exit={result.returncode} named_reads={records[-1].get("namedReads")}', flush=True)
        raise SystemExit(2)
    print(f'RUN_SAFE {mode}-{run_id} exit={result.returncode} cpu={cpu} start_load={start.split("load averages: ",1)[1].split()[0]} end_load={end.split("load averages: ",1)[1].split()[0]}', flush=True)


def main():
    RAW.mkdir(parents=True, exist_ok=False)
    preflight()
    auditor = module('c689_audit', WORKSPACE / '.github/evidence/audit.py')
    checker = module('c689_trace', WORKSPACE / '.github/evidence/c689-trace-check.py')
    auditor.self_test()
    checker.self_test()
    workflow_head = git(WORKSPACE, 'rev-parse', 'HEAD')
    for mode in ('base', 'head'):
        for number in range(1, 11):
            capture(mode, f'r{number:02d}', auditor, checker, workflow_head)
    PUBLIC.mkdir()
    for mode in ('base', 'head'):
        for number in range(1, 11):
            run_id = f'r{number:02d}'
            copied = PUBLIC / mode / run_id
            shutil.copytree(RAW / mode / run_id, copied)
            audit_issues = auditor.audit(copied, ('689',))
            trace_issues = checker.inspect((copied / '689.trace.jsonl').read_bytes(),
                                           *trace_expectations(mode, (copied / 'runner.log').read_text(), run_id))
            if audit_issues or trace_issues:
                print(f'CARD689_COPY_BLOCKED {mode}-{run_id} audit={safe_counts(audit_issues)} trace={safe_counts(trace_issues)}', flush=True)
                raise SystemExit(2)
    print('CAPTURE_SAFE base_runs=10 head_runs=10 expected_base_failures=10', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'CARD689_CAPTURE_BLOCKED internal={type(error).__name__}', flush=True)
        sys.exit(2)
