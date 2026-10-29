// ABOUTME: Composes and parses a clock firing's mark and finds its exact line in a card body.

const PREFIX = 'Rigger clock: ';

/** One inert line encoding the exact name and the occurrence's millisecond time value. */
export function composeClockMark(name, occurrence) {
  if (typeof name !== 'string') throw new TypeError(`Invalid clock name: ${name}`);
  if (!Number.isInteger(occurrence) || Math.abs(occurrence) > 8640000000000000) {
    throw new RangeError(`Invalid clock occurrence: ${occurrence}`);
  }
  return PREFIX + JSON.stringify([name, occurrence]);
}

/** The pair named by a composed line, or null where the line is not a mark. */
export function parseClockMark(line) {
  if (!line.startsWith(PREFIX)) return null;
  try {
    const pair = JSON.parse(line.slice(PREFIX.length));
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [name, occurrence] = pair;
    return composeClockMark(name, occurrence) === line ? { name, occurrence } : null;
  } catch {
    return null;
  }
}

/** Whether any LF/CRLF-delimited body line is exactly this pair's composed mark. */
export function carriesClockMark(body, name, occurrence) {
  return body.split(/\r?\n/).includes(composeClockMark(name, occurrence));
}
