# ABOUTME: Rejects incomplete original card 689 caller traces before a run can be published.

from collections import Counter
import json
from pathlib import Path
import sys


def inspect(data):
    issues = Counter()
    try:
        records = [json.loads(line) for line in data.splitlines()]
    except (UnicodeDecodeError, json.JSONDecodeError):
        return Counter({'malformed_trace': 1})
    if not records or records[0].get('kind') != 'caller' or records[-1].get('kind') != 'caller-end':
        issues['trace_endpoints'] += 1
        return issues
    if any(not isinstance(record, dict) or not isinstance(record.get('at'), int) for record in records):
        issues['trace_record_shape'] += 1
        return issues
    if any(one['at'] > two['at'] for one, two in zip(records, records[1:])):
        issues['trace_order'] += 1

    ends = [record for record in records if record['kind'] == 'caller-end']
    if len(ends) != 1:
        issues['caller_end_count'] += 1
        return issues
    final = ends[0]
    outside = records[0].get('outside')
    notes = final.get('notReached', [])
    has_note = lambda prefix: any(isinstance(note, str) and note.startswith(prefix) for note in notes)
    if not isinstance(outside, int) or outside <= 0:
        issues['named_pid'] += 1
    if not isinstance(final.get('notReached'), list) or not isinstance(final.get('observedState'), str):
        issues['caller_observation'] += 1
    if not any(record['kind'] == 'named-kill' and record.get('target') == outside for record in records) and not has_note('named kill:'):
        issues['named_kill'] += 1
    if not any(record['kind'] == 'signal-answer' and record.get('target') == outside and record.get('signal') == 0 for record in records) and not has_note('signal 0:'):
        issues['signal_zero'] += 1
    boundaries = [record for record in records if record['kind'] == 'read-boundary' and record.get('phase') == 'wait']
    if (not boundaries and not has_note('wait read boundary:')) or any(not isinstance(record.get('remaining'), (int, float)) for record in boundaries):
        issues['wait_boundaries'] += 1

    pending = None
    for record in records:
        if record['kind'] == 'read-start':
            if pending is not None:
                issues['overlapping_read'] += 1
            pending = record
        if record['kind'] in ('read', 'read-threw'):
            if pending is None or pending.get('tool') != record.get('tool') or pending.get('argv') != record.get('argv'):
                issues['unpaired_read'] += 1
            elif record.get('ended', 0) < pending.get('started', 0):
                issues['read_time_order'] += 1
            pending = None
    if pending is not None:
        issues['unfinished_read'] += 1

    named_starts = [record for record in records if record['kind'] == 'read-start' and record.get('namedState')]
    named_ends = [record for record in records if record['kind'] == 'read' and record.get('namedState')]
    listings = [record for record in records if record['kind'] == 'read' and record.get('postKillListing')]
    if not named_starts and not has_note('first post-kill ps:'):
        issues['first_state_explanation'] += 1
    if not listings and not has_note('post-kill lsof:'):
        issues['listing_explanation'] += 1
    if any('stdout' not in record or 'stderr' not in record or 'stateCount' not in record for record in named_ends + listings):
        issues['read_result_fields'] += 1
    if len(named_starts) != final.get('namedReads'):
        issues['state_read_count'] += 1
    if len(named_starts) < 2 and not any('later ps:' in note for note in final.get('notReached', [])):
        issues['missing_later_explanation'] += 1
    if final.get('laterAnsweredLive') and not any(record.get('namedRead', 0) > 1 and record.get('laterLive') and record.get('status') == 0 for record in named_ends):
        issues['later_live_answer'] += 1
    if final.get('cutBoundary') and not any('spent wait deadline' in note for note in final.get('notReached', [])):
        issues['cut_explanation'] += 1
    if final.get('namedEvent') and not any(record['kind'] == 'append' and record.get('file') == 'events' and 'survivor.unended' in record.get('data', '') for record in records):
        issues['named_event'] += 1
    return issues


def self_test():
    safe = [
        {'kind': 'caller', 'at': 1, 'outside': 7},
        {'kind': 'named-kill', 'at': 2, 'target': 7},
        {'kind': 'signal-answer', 'at': 3, 'target': 7, 'signal': 0, 'answer': True},
        {'kind': 'read-boundary', 'at': 4, 'phase': 'wait', 'remaining': 900},
        {'kind': 'read-start', 'at': 5, 'tool': 'ps', 'argv': ['-p', '7'], 'started': 5, 'namedState': True, 'namedRead': 1},
        {'kind': 'read', 'at': 6, 'tool': 'ps', 'argv': ['-p', '7'], 'ended': 6, 'namedState': True, 'namedRead': 1, 'firstFailed': True, 'stdout': '', 'stderr': 'forced failure', 'stateCount': '1'},
        {'kind': 'read-start', 'at': 7, 'tool': 'lsof', 'argv': [], 'started': 7, 'postKillListing': True},
        {'kind': 'read', 'at': 8, 'tool': 'lsof', 'argv': [], 'ended': 8, 'postKillListing': True, 'status': 1, 'omittedListing': True, 'stdout': '', 'stderr': '', 'stateCount': '1'},
        {'kind': 'caller-end', 'at': 9, 'observedState': '7 T', 'namedReads': 1, 'laterAnsweredLive': False, 'notReached': ['later ps: deadline before read']},
    ]
    encode = lambda rows: ('\n'.join(json.dumps(row) for row in rows) + '\n').encode()
    assert not inspect(encode(safe))
    assert inspect(encode(safe[:-1]))['trace_endpoints']
    assert inspect(encode(safe[:5] + safe[6:]))['overlapping_read']
    assert inspect(b'{bad json')['malformed_trace']
    print('CARD689_TRACE_SELF_TEST_PASS safe missing_end unpaired malformed')


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        issues = inspect(Path(sys.argv[1]).read_bytes())
        if issues:
            print(f'CARD689_TRACE_BLOCKED {dict(sorted(issues.items()))}')
            sys.exit(1)
        print('CARD689_TRACE_PASS')
