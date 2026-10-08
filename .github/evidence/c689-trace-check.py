# ABOUTME: Rejects incomplete original card 689 caller traces before a run can be published.

from collections import Counter
from copy import deepcopy
import json
import math
from pathlib import Path
import sys


def finite_number(value):
    return type(value) is int or (type(value) is float and math.isfinite(value))


def source_path(records):
    issues = Counter()
    caller, final = records[0], records[-1]
    outside = caller.get('outside')
    timeout = caller.get('readTimeout')
    census = [(index, row) for index, row in enumerate(records) if row['kind'] == 'census-clock']
    kills = [(index, row) for index, row in enumerate(records) if row['kind'] == 'named-kill' and row.get('target') == outside]
    kill_clocks = [(index, row) for index, row in enumerate(records) if row['kind'] == 'kill-clock']
    boundaries = [(index, row) for index, row in enumerate(records) if row['kind'] == 'read-boundary']
    listing_starts = [index for index, row in enumerate(records) if row['kind'] == 'read-start' and row.get('postKillListing')]
    listing_ends = [index for index, row in enumerate(records) if row['kind'] == 'read' and row.get('postKillListing')]
    named_starts = [row for row in records if row['kind'] == 'read-start' and row.get('namedState')]
    named_ends = [row for row in records if row['kind'] == 'read' and row.get('namedState')]
    first_state_start = next((index for index, row in enumerate(records) if row['kind'] == 'read-start' and row.get('namedState')), None)
    first_state_end = next((index for index, row in enumerate(records) if row['kind'] == 'read' and row.get('namedState')), None)

    # The frozen named fixture passes CLEANUP_BOUND and records one census start and one kill.
    clocks_valid = (type(timeout) is int and timeout == 1000 and len(census) == len(kills) == len(kill_clocks) == 1
                    and finite_number(census[0][1].get('logical')) and census[0][1]['logical'] >= 0
                    and type(census[0][1].get('remaining')) is int and census[0][1]['remaining'] == timeout
                    and finite_number(kill_clocks[0][1].get('logical')) and kill_clocks[0][1]['logical'] >= 0
                    and bool(boundaries) and census[0][0] < kills[0][0] < kill_clocks[0][0] < boundaries[0][0])
    if not clocks_valid:
        issues['clock_source'] += 1
    if len(listing_starts) != 1 or len(listing_ends) != 1 or listing_starts[0] >= listing_ends[0]:
        issues['listing_order'] += 1
    if (first_state_start is None or first_state_end is None or not listing_starts or
            not kills or not (kills[0][0] < first_state_start < first_state_end < listing_starts[0])):
        issues['first_state_order'] += 1

    wait_seen = False
    spent_wait = []
    for index, row in boundaries:
        phase, logical, remaining = row.get('phase'), row.get('logical'), row.get('remaining')
        if finite_number(logical) and logical < 0:
            issues['boundary_source'] += 1
        if clocks_valid and finite_number(logical) and finite_number(remaining):
            origin = census[0][1]['logical'] if phase == 'census' else kill_clocks[0][1]['logical']
            if remaining != origin + timeout - logical:
                issues['boundary_source'] += 1
        if phase == 'wait':
            wait_seen = True
            if finite_number(remaining) and remaining <= 0:
                spent_wait.append(index)
        if ((phase == 'census' and (wait_seen or listing_starts and index >= listing_starts[0])) or
                (phase == 'wait' and (not listing_ends or index <= listing_ends[0]))):
            issues['phase_order'] += 1
        if finite_number(remaining):
            next_kind = records[index + 1]['kind'] if index + 1 < len(records) else None
            if (remaining > 0) != (next_kind == 'read-start'):
                issues['boundary_read_order'] += 1

    if len(spent_wait) > 1:
        issues['read_after_cut'] += 1
    if spent_wait and any(row['kind'] in ('read-boundary', 'read-start', 'read', 'read-threw')
                          for row in records[spent_wait[0] + 1:]):
        issues['read_after_cut'] += 1
    if kill_clocks:
        for index, row in enumerate(records):
            if row['kind'] == 'read-start' and index > kill_clocks[0][0]:
                before = records[index - 1] if index > 0 else {}
                if before.get('kind') != 'read-boundary' or not finite_number(before.get('remaining')) or before['remaining'] <= 0:
                    issues['read_without_boundary'] += 1

    if any(row.get('namedRead') != number for number, row in enumerate(named_starts, 1)) or any(
            row.get('namedRead') != number for number, row in enumerate(named_ends, 1)) or len(named_starts) != len(named_ends):
        issues['named_read_order'] += 1
    notes = final.get('notReached', [])
    note = lambda prefix: isinstance(notes, list) and any(isinstance(item, str) and item.startswith(prefix) for item in notes)
    answers = sum(row['kind'] == 'signal-answer' and row.get('target') == outside and row.get('signal') == 0 for row in records)
    live_answer = any(type(row.get('namedRead')) is int and row['namedRead'] > 1
                      and row.get('laterLive') and row.get('status') == 0 for row in named_ends)
    event = any(row['kind'] == 'append' and row.get('file') == 'events' and 'survivor.unended' in row.get('data', '') for row in records)
    if (type(final.get('waitBoundaries')) is not int or final['waitBoundaries'] != sum(row.get('phase') == 'wait' for _, row in boundaries)
            or type(final.get('cutBoundary')) is not bool or final['cutBoundary'] != bool(spent_wait)
            or type(final.get('namedReads')) is not int or final['namedReads'] != len(named_starts)
            or type(final.get('laterAnsweredLive')) is not bool or final['laterAnsweredLive'] != live_answer
            or type(final.get('namedKilled')) is not bool or final['namedKilled'] != (len(kills) == 1)
            or type(final.get('signalZeroAnswers')) is not int or final['signalZeroAnswers'] != answers
            or bool(final.get('namedEvent')) != event
            or note('wait read boundary:') != (not any(row.get('phase') == 'wait' for _, row in boundaries))
            or note('read after spent wait deadline:') != bool(spent_wait)
            or note('later ps:') != (len(named_starts) < 2)
            or note('later live answer:') != (not live_answer)):
        issues['caller_claim'] += 1
    return issues


def diagnostic_path(operations, records):
    issues = Counter()
    if not isinstance(operations, list) or not operations or any(not isinstance(row, dict) for row in operations):
        return Counter({'diagnostic_source_order': 1})
    kinds = [row.get('operation') for row in operations]
    if kinds[-1] != 'caller-end' or kinds.count('caller-end') != 1:
        issues['diagnostic_source_order'] += 1
    census = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'census-bound']
    kills = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'named-kill']
    kill_clocks = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'kill-clock']
    boundaries = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'read-boundary']
    listings = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'read-start' and row.get('tool') == 'lsof']
    listing_ends = [(i, row) for i, row in enumerate(operations) if row.get('operation') == 'read-end' and row.get('tool') == 'lsof']
    states = [i for i, row in enumerate(operations) if row.get('operation') == 'read-start' and row.get('tool') == 'ps']
    state_ends = [i for i, row in enumerate(operations) if row.get('operation') == 'read-end' and row.get('tool') == 'ps']
    timeout = records[0].get('readTimeout')
    clocks_valid = (len(census) == len(kills) == len(kill_clocks) == 1 and type(timeout) is int and timeout == 1000
                    and finite_number(census[0][1].get('logical')) and census[0][1]['logical'] >= 0
                    and type(census[0][1].get('remaining')) is int and census[0][1]['remaining'] == timeout
                    and finite_number(kill_clocks[0][1].get('logical')) and kill_clocks[0][1]['logical'] >= 0
                    and bool(boundaries) and census[0][0] < kills[0][0] < kill_clocks[0][0] < boundaries[0][0])
    if not clocks_valid or len(listings) != 1 or len(listing_ends) != 1 or listings[0][0] >= listing_ends[0][0]:
        issues['diagnostic_source_order'] += 1
    if (not states or not state_ends or not listings or not kills or
            not (kills[0][0] < states[0] < state_ends[0] < listings[0][0])):
        issues['diagnostic_source_order'] += 1
    wait_seen = False
    spent = []
    for index, row in boundaries:
        phase, logical, remaining = row.get('phase'), row.get('logical'), row.get('remaining')
        if (phase not in ('census', 'wait') or not finite_number(logical) or logical < 0 or
                not finite_number(remaining)):
            issues['diagnostic_source_order'] += 1
            continue
        if clocks_valid:
            origin = census[0][1]['logical'] if phase == 'census' else kill_clocks[0][1]['logical']
            if remaining != origin + timeout - logical:
                issues['diagnostic_source_order'] += 1
        if phase == 'wait':
            wait_seen = True
            if remaining <= 0:
                spent.append(index)
        if ((phase == 'census' and (wait_seen or listings and index >= listings[0][0])) or
                (phase == 'wait' and (not listing_ends or index <= listing_ends[0][0]))):
            issues['diagnostic_source_order'] += 1
        next_kind = kinds[index + 1] if index + 1 < len(kinds) else None
        if (remaining > 0) != (next_kind == 'read-start'):
            issues['diagnostic_source_order'] += 1
    if len(spent) > 1 or spent and any(kind in ('read-boundary', 'read-start', 'read-end', 'read-threw')
                                     for kind in kinds[spent[0] + 1:]):
        issues['diagnostic_source_order'] += 1
    if kill_clocks:
        for index, row in enumerate(operations):
            if row.get('operation') == 'read-start' and index > kill_clocks[0][0]:
                before = operations[index - 1]
                if before.get('operation') != 'read-boundary' or not finite_number(before.get('remaining')) or before['remaining'] <= 0:
                    issues['diagnostic_source_order'] += 1
    pending = None
    for row in operations:
        if row.get('operation') == 'read-start':
            if pending is not None:
                issues['diagnostic_source_order'] += 1
            pending = (row.get('tool'), row.get('argv'))
        if row.get('operation') in ('read-end', 'read-threw'):
            if pending != (row.get('tool'), row.get('argv')):
                issues['diagnostic_source_order'] += 1
            pending = None
    if pending is not None:
        issues['diagnostic_source_order'] += 1
    named_kill = next((i for i, row in enumerate(records) if row['kind'] == 'named-kill'), None)
    if named_kill is not None:
        actual = records[named_kill + 1:]
        starts = [(Path(str(row.get('tool', ''))).name, row.get('argv')) for row in actual if row['kind'] == 'read-start']
        expected = [(row.get('tool'), row.get('argv')) for row in operations if row.get('operation') == 'read-start']
        answers = [(Path(str(row.get('tool', ''))).name, row.get('argv'), row.get('status'))
                   for row in actual if row['kind'] == 'read']
        expected_answers = [(row.get('tool'), row.get('argv'), row.get('status'))
                            for row in operations if row.get('operation') == 'read-end']
        if starts != expected or answers != expected_answers:
            issues['diagnostic_read_agreement'] += 1
    else:
        issues['diagnostic_read_agreement'] += 1
    return issues


def inspect(data, expected_boundaries=None, expected_operations=None):
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
    all_boundaries = [record for record in records if record['kind'] == 'read-boundary']
    boundaries = [record for record in all_boundaries if record.get('phase') == 'wait']
    valid_boundary = lambda record: (isinstance(record, dict) and record.get('phase') in ('census', 'wait')
                                     and finite_number(record.get('logical')) and finite_number(record.get('remaining')))
    if any(not valid_boundary(record) for record in all_boundaries):
        issues['boundary_shape'] += 1
    if (not boundaries and not has_note('wait read boundary:')) or any(not finite_number(record.get('remaining')) for record in boundaries):
        issues['wait_boundaries'] += 1
    spent = any(finite_number(record.get('remaining')) and record['remaining'] <= 0 for record in boundaries)
    if final.get('waitBoundaries') != len(boundaries) or final.get('cutBoundary') is not spent:
        issues['boundary_count'] += 1
    if boundaries and has_note('wait read boundary:'):
        issues['boundary_claim'] += 1
    if expected_boundaries is not None:
        observed = [{key: row.get(key) for key in ('phase', 'logical', 'remaining')} for row in all_boundaries]
        if not isinstance(expected_boundaries, list) or any(not valid_boundary(row) for row in expected_boundaries):
            issues['diagnostic_boundary_shape'] += 1
        fields = ('phase', 'logical', 'remaining')
        if (not isinstance(expected_boundaries, list) or not expected_boundaries or
                len(observed) != len(expected_boundaries) or
                any(not isinstance(right, dict) or any(type(left[key]) is not type(right.get(key)) or left[key] != right.get(key)
                                                        for key in fields)
                    for left, right in zip(observed, expected_boundaries))):
            issues['boundary_agreement'] += 1

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
    issues.update(source_path(records))
    if expected_operations is not None:
        issues.update(diagnostic_path(expected_operations, records))
    return issues


def self_test():
    safe = [
        {'kind': 'caller', 'at': 1, 'outside': 7, 'readTimeout': 1000},
        {'kind': 'census-clock', 'at': 2, 'logical': 10, 'remaining': 1000},
        {'kind': 'named-kill', 'at': 3, 'target': 7},
        {'kind': 'kill-clock', 'at': 4, 'logical': 20},
        {'kind': 'read-boundary', 'at': 5, 'phase': 'census', 'logical': 11, 'remaining': 999},
        {'kind': 'read-start', 'at': 6, 'tool': 'ps', 'argv': ['-p', '7'], 'started': 6, 'namedState': True, 'namedRead': 1},
        {'kind': 'read', 'at': 7, 'tool': 'ps', 'argv': ['-p', '7'], 'ended': 7, 'namedState': True, 'namedRead': 1, 'status': 2, 'stdout': '', 'stderr': 'forced failure', 'stateCount': '1'},
        {'kind': 'read-boundary', 'at': 8, 'phase': 'census', 'logical': 12, 'remaining': 998},
        {'kind': 'read-start', 'at': 9, 'tool': 'lsof', 'argv': [], 'started': 9, 'postKillListing': True},
        {'kind': 'read', 'at': 10, 'tool': 'lsof', 'argv': [], 'ended': 10, 'postKillListing': True, 'status': 1, 'stdout': '', 'stderr': '', 'stateCount': '1'},
        {'kind': 'signal-answer', 'at': 11, 'target': 7, 'signal': 0, 'answer': True},
        {'kind': 'read-boundary', 'at': 12, 'phase': 'wait', 'logical': 21, 'remaining': 999},
        {'kind': 'read-start', 'at': 13, 'tool': 'ps', 'argv': ['-p', '7'], 'started': 13, 'namedState': True, 'namedRead': 2},
        {'kind': 'read', 'at': 14, 'tool': 'ps', 'argv': ['-p', '7'], 'ended': 14, 'namedState': True, 'namedRead': 2, 'laterLive': True, 'status': 0, 'stdout': '7 T', 'stderr': '', 'stateCount': '2'},
        {'kind': 'signal-answer', 'at': 15, 'target': 7, 'signal': 0, 'answer': True},
        {'kind': 'read-boundary', 'at': 16, 'phase': 'wait', 'logical': 1021, 'remaining': -1},
        {'kind': 'append', 'at': 17, 'file': 'events', 'data': '{"event":"survivor.unended","pid":7}'},
        {'kind': 'caller-end', 'at': 18, 'observedState': '7 T', 'namedKilled': True, 'signalZeroAnswers': 2,
         'namedReads': 2, 'laterAnsweredLive': True, 'waitBoundaries': 2, 'cutBoundary': True,
         'namedEvent': {'event': 'survivor.unended', 'pid': 7},
         'notReached': ['read after spent wait deadline: runOnce returned LATE before spawning it']},
    ]
    encode = lambda rows: ('\n'.join(json.dumps(row) for row in rows) + '\n').encode()
    agreed = lambda rows: [{key: row.get(key) for key in ('phase', 'logical', 'remaining')}
                           for row in rows if row['kind'] == 'read-boundary']
    rejected = lambda rows, reason: inspect(encode(rows), agreed(rows))[reason]
    assert not inspect(encode(safe), agreed(safe))
    diagnostic = [
        {'operation': 'census-bound', 'logical': 10, 'remaining': 1000},
        {'operation': 'named-kill', 'target': 7},
        {'operation': 'kill-clock', 'logical': 20},
        {'operation': 'read-boundary', 'phase': 'census', 'logical': 11, 'remaining': 999},
        {'operation': 'read-start', 'tool': 'ps', 'argv': ['-p', '7']},
        {'operation': 'read-end', 'tool': 'ps', 'argv': ['-p', '7'], 'status': 2},
        {'operation': 'read-boundary', 'phase': 'census', 'logical': 12, 'remaining': 998},
        {'operation': 'read-start', 'tool': 'lsof', 'argv': []},
        {'operation': 'read-end', 'tool': 'lsof', 'argv': [], 'status': 1},
        {'operation': 'read-boundary', 'phase': 'wait', 'logical': 21, 'remaining': 999},
        {'operation': 'read-start', 'tool': 'ps', 'argv': ['-p', '7']},
        {'operation': 'read-end', 'tool': 'ps', 'argv': ['-p', '7'], 'status': 0},
        {'operation': 'read-boundary', 'phase': 'wait', 'logical': 1021, 'remaining': -1},
        {'operation': 'caller-end'},
    ]
    assert not inspect(encode(safe), agreed(safe), diagnostic)
    safe_diagnostic = deepcopy(diagnostic)
    bad_diagnostic = deepcopy(diagnostic)
    bad_diagnostic.insert(-1, {'operation': 'read-start', 'tool': 'ps', 'argv': ['-p', '7']})
    assert inspect(encode(safe), agreed(safe), bad_diagnostic)['diagnostic_source_order']
    assert inspect(encode(safe[:-1]))['trace_endpoints']
    assert rejected(safe[:6] + safe[7:], 'overlapping_read')
    assert inspect(b'{bad json')['malformed_trace']
    assert inspect(encode(safe), agreed(safe)[:-1])['boundary_agreement']
    wrong_note = deepcopy(safe)
    wrong_note[-1]['notReached'].append('wait read boundary: no post-kill wait boundary was reached')
    assert rejected(wrong_note, 'boundary_claim')
    for phase in ('census', 'wait'):
        for field in ('logical', 'remaining'):
            for invalid in (None, True, False, float('nan'), float('inf'), -float('inf'), 'spent', [], {}):
                changed = deepcopy(safe)
                changed[4 if phase == 'census' else 11][field] = invalid
                assert rejected(changed, 'boundary_shape')
                diagnostic = deepcopy(agreed(safe))
                diagnostic[0 if phase == 'census' else 2][field] = invalid
                assert inspect(encode(safe), diagnostic)['diagnostic_boundary_shape']
    for invalid_phase in (None, True, 'other'):
        changed = deepcopy(safe)
        changed[4]['phase'] = invalid_phase
        assert rejected(changed, 'boundary_shape')
    typed = deepcopy(agreed(safe))
    typed[0]['logical'] = 11.0
    assert inspect(encode(safe), typed)['boundary_agreement']

    matrix = {}
    changed = deepcopy(safe); changed[4]['phase'] = 'wait'; changed[11]['phase'] = 'census'; matrix['wait_before_census'] = (changed, 'phase_order')
    changed = deepcopy(safe); changed[4]['logical'] = -1; matrix['negative_logical'] = (changed, 'boundary_source')
    changed = deepcopy(safe); changed[11]['phase'] = 'census'; changed[-1]['waitBoundaries'] = 1; matrix['census_after_listing'] = (changed, 'phase_order')
    changed = deepcopy(safe); changed[7]['phase'] = 'wait'; changed[-1]['waitBoundaries'] = 3; matrix['wait_before_listing'] = (changed, 'phase_order')
    changed = deepcopy(safe); changed.pop(4); matrix['missing_boundary'] = (changed, 'read_without_boundary')
    changed = deepcopy(safe); changed.insert(5, dict(changed[4])); matrix['duplicate_boundary'] = (changed, 'boundary_read_order')
    changed = deepcopy(safe); changed[4], changed[7] = changed[7], changed[4]; matrix['reordered_boundary'] = (changed, 'trace_order')
    changed = deepcopy(safe); changed.pop(6); matrix['partial_read'] = (changed, 'overlapping_read')
    changed = deepcopy(safe); changed[4]['remaining'] = 998; matrix['wrong_bound_arithmetic'] = (changed, 'boundary_source')
    changed = deepcopy(safe); changed.pop(3); matrix['missing_kill_clock'] = (changed, 'clock_source')
    changed = deepcopy(safe); changed.insert(4, dict(changed[3])); matrix['duplicate_kill_clock'] = (changed, 'clock_source')
    changed = deepcopy(safe); changed.insert(-2, {'kind': 'read-start', 'at': 16, 'tool': 'ps', 'argv': ['-p', '7'], 'started': 16, 'namedState': True, 'namedRead': 3}); changed.insert(-2, {'kind': 'read', 'at': 16, 'tool': 'ps', 'argv': ['-p', '7'], 'ended': 16, 'namedState': True, 'namedRead': 3, 'laterLive': True, 'status': 0, 'stdout': '7 T', 'stderr': '', 'stateCount': '3'}); changed[-1]['namedReads'] = 3; matrix['read_after_cut'] = (changed, 'read_after_cut')
    changed = deepcopy(safe); changed[-1]['cutBoundary'] = False; matrix['false_cut_claim'] = (changed, 'caller_claim')
    changed = deepcopy(safe); changed[-1]['notReached'] = []; matrix['missing_cut_note'] = (changed, 'caller_claim')
    changed = deepcopy(safe); changed[12]['namedRead'] = 1; matrix['duplicate_named_read'] = (changed, 'named_read_order')
    changed = deepcopy(safe); changed[-1]['laterAnsweredLive'] = False; matrix['false_answer_claim'] = (changed, 'caller_claim')
    changed = deepcopy(safe)
    changed = changed[:4] + [changed[index] for index in (4, 8, 9, 10, 11, 5, 6, 7, 12, 13, 14, 15, 16, 17)]
    changed[11].update(phase='wait', logical=22, remaining=998)
    changed[-1]['waitBoundaries'] = 3
    for at, row in enumerate(changed, 1):
        row['at'] = at
        if row['kind'] == 'read-start': row['started'] = at
        if row['kind'] == 'read': row['ended'] = at
    matrix['listing_before_first_state'] = (changed, 'first_state_order')
    coforged = deepcopy(safe_diagnostic)
    coforged = coforged[:3] + [coforged[index] for index in (3, 7, 8, 9, 4, 5, 6, 10, 11, 12, 13)]
    coforged[9].update(phase='wait', logical=22, remaining=998)
    assert inspect(encode(changed), agreed(changed), coforged)['diagnostic_source_order']
    for name, (changed, reason) in matrix.items():
        assert rejected(changed, reason), name
    print(f'CARD689_TRACE_SELF_TEST_PASS numeric=72 semantic={len(matrix)} source_order=pass')


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        issues = inspect(Path(sys.argv[1]).read_bytes())
        if issues:
            print(f'CARD689_TRACE_BLOCKED {dict(sorted(issues.items()))}')
            sys.exit(1)
        print('CARD689_TRACE_PASS')
