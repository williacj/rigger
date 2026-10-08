// ABOUTME: Forces a spent post-kill boundary in the base fixture and traces the named case.

const fs = require('node:fs');
const child = require('node:child_process');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

if (path.basename(process.argv[1] || '') === 'caller.mjs' && process.env.C689_TRACE_DIR) {
  const here = process.argv[2];
  const options = JSON.parse(process.argv[3]);
  if (here && (fs.existsSync(path.join(here, 'c689-trace-id')) || (options.postKillCut && fs.existsSync(path.join(here, 'ps')) && fs.readFileSync(path.join(here, 'ps'), 'utf8').includes('state-count')))) {
    const trace = path.join(process.env.C689_TRACE_DIR, '689.trace.jsonl');
    const rawNow = Date.now.bind(Date);
    const originalAppend = fs.appendFileSync;
    const originalSpawnSync = child.spawnSync;
    const originalKill = process.kill;
    const originalExit = process.exit;
    const outside = Number(fs.readFileSync(path.join(here, 'outside.pid'), 'utf8'));
    let censusStarted;
    let killedAt;
    let namedReads = 0;
    let laterAnsweredLive = false;
    let listingStarted = false;
    let cutBoundary = false;
    let namedEvent;
    let laterResult;
    let namedKilled = false;
    let signalZeroAnswers = 0;
    let waitBoundaries = 0;
    let forcedBoundary = false;
    const record = (kind, fields = {}) => originalAppend(trace, `${JSON.stringify({ kind, at: rawNow(), ...fields })}\n`);
    const stateCount = () => fs.existsSync(path.join(here, 'state-count')) ? fs.readFileSync(path.join(here, 'state-count'), 'utf8').trim() : null;
    const markers = () => ({
      stateCount: stateCount(),
      firstFailed: fs.existsSync(path.join(here, 'state-failed')),
      laterLive: fs.existsSync(path.join(here, 'state-live')),
      omittedListing: fs.existsSync(path.join(here, 'post-kill-omitted')),
    });

    record('caller', { here, args: process.argv.slice(3), outside, readTimeout: options.readTimeout });
    Date.now = function observedNow() {
      const frame = new Error().stack?.split('\n')[2] || '';
      let now = rawNow();
      if (!options.postKillCut && !forcedBoundary && frame.includes('at readingNow (') && listingStarted && namedReads === 1 && killedAt !== undefined) {
        now = killedAt + options.readTimeout + 1;
        forcedBoundary = true;
        record('forced-boundary', { logical: now, afterFirstFailure: true, afterOmittedListing: true });
      }
      if (frame.includes('at sweptNow (') && censusStarted === undefined) {
        censusStarted = now;
        record('census-clock', { logical: now, remaining: options.readTimeout });
      }
      if (frame.includes('at sweeping (') && fs.existsSync(path.join(here, 'hang')) && killedAt === undefined) {
        killedAt = now;
        record('kill-clock', { logical: now });
      }
      if (frame.includes('at readingNow (') && fs.existsSync(path.join(here, 'hang'))) {
        const phase = fs.existsSync(path.join(here, 'post-kill-listing')) ? 'wait' : 'census';
        const from = phase === 'wait' ? killedAt : censusStarted;
        const remaining = from === undefined ? null : from + options.readTimeout - now;
        if (phase === 'wait') waitBoundaries += 1;
        if (phase === 'wait' && remaining !== null && remaining <= 0) cutBoundary = true;
        record('read-boundary', { logical: now, phase, remaining });
      }
      if (frame.includes('at reaped (') && fs.existsSync(path.join(here, 'hang'))) {
        record('terminal-clock', { logical: now, remaining: killedAt === undefined ? null : killedAt + options.readTimeout - now });
      }
      return now;
    };

    child.spawnSync = function observedRead(tool, args, settings) {
      const started = rawNow();
      const namedState = tool === path.join(here, 'ps') && args?.join(' ') === `-p ${outside} -o pid=,stat=` && fs.existsSync(path.join(here, 'hang'));
      const postKillListing = tool === path.join(here, 'lsof') && fs.existsSync(path.join(here, 'hang'));
      if (namedState) namedReads += 1;
      if (postKillListing) listingStarted = true;
      record('read-start', { tool, argv: args, started, timeout: settings?.timeout, namedState, postKillListing, namedRead: namedState ? namedReads : null });
      try {
        const result = originalSpawnSync.apply(this, arguments);
        const ended = rawNow();
        if (namedState && namedReads > 1) laterResult = { status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.code || null };
        if (namedState && namedReads > 1 && result.status === 0 && /^\s*\d+\s+T\s*$/m.test(result.stdout || '')) laterAnsweredLive = true;
        record('read', { tool, argv: args, started, ended, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error && { code: result.error.code, message: result.error.message }, namedState, postKillListing, namedRead: namedState ? namedReads : null, ...markers() });
        return result;
      } catch (error) {
        if (namedState && namedReads > 1) laterResult = { error: error.code || error.message };
        record('read-threw', { tool, argv: args, started, ended: rawNow(), code: error.code, message: error.message, ...markers() });
        throw error;
      }
    };

    process.kill = function observedSignal(target, signal) {
      const started = rawNow();
      try {
        const answer = originalKill.apply(this, arguments);
        if (target === outside && signal === 0) signalZeroAnswers += 1;
        record('signal-answer', { target, signal, started, answer });
        return answer;
      } catch (error) {
        if (target === outside && signal === 0) signalZeroAnswers += 1;
        record('signal-answer', { target, signal, started, code: error.code, message: error.message });
        throw error;
      }
    };

    fs.appendFileSync = function observedAppend(file, data) {
      const answer = originalAppend.apply(this, arguments);
      if (path.dirname(file) === here && ['pairs', 'events', 'exiting', 'ending'].includes(path.basename(file))) {
        record('append', { file: path.basename(file), data: String(data) });
        if (path.basename(file) === 'events') {
          for (const line of String(data).split('\n').filter(Boolean)) {
            const event = JSON.parse(line);
            if (event.pid === outside && event.event === 'survivor.unended') namedEvent = event;
          }
        }
        if (path.basename(file) === 'pairs') {
          for (const line of String(data).split('\n').filter(Boolean)) {
            const [target, signal, at] = JSON.parse(line);
            if (target === outside && signal === 'SIGKILL') { namedKilled = true; record('named-kill', { target, logical: at }); }
          }
        }
      }
      return answer;
    };
    syncBuiltinESMExports();

    const finishTrace = (status) => {
      const observed = originalSpawnSync('/bin/ps', ['-p', String(outside), '-o', 'pid=,stat='], { encoding: 'utf8' });
      let signal0;
      try { signal0 = originalKill(outside, 0) ? 'yes' : 'no'; }
      catch (error) { signal0 = error.code || error.message; }
      const notReached = [];
      if (!namedKilled) notReached.push('named kill: no signal request for the outside PID was recorded');
      if (signalZeroAnswers === 0) notReached.push('signal 0: no named answer was requested by L0');
      if (waitBoundaries === 0) notReached.push('wait read boundary: no post-kill wait boundary was reached');
      if (namedReads === 0) notReached.push('first post-kill ps: no named state read started');
      if (!listingStarted) notReached.push('post-kill lsof: no later directory listing started');
      if (namedReads < 2) notReached.push(cutBoundary ? 'later ps: wait deadline was spent before a second named state read started' : 'later ps: no second named state read started; inspect signal answers and emitted events');
      if (!laterAnsweredLive) notReached.push(`later live answer: ${laterResult?.error === 'ETIMEDOUT' ? 'later ps timed out without an answer' : laterResult?.stderr ? 'later ps failed plainly without an answer' : 'no later named ps answered live'}`);
      if (cutBoundary) notReached.push('read after spent wait deadline: runOnce returned LATE before spawning it');
      if (!namedEvent) notReached.push('named survivor.unended event: no such event was emitted');
      record('caller-end', { status, outside, observedState: observed.stdout, observedStateStatus: observed.status, observedSignal0: signal0, namedKilled, signalZeroAnswers, waitBoundaries, namedReads, laterAnsweredLive, cutBoundary, namedEvent: namedEvent || null, notReached, ...markers() });
    };
    // The exit cleanup reads after process.exit is requested, so record completion after its listener.
    process.exit = function observedExit() {
      process.once('exit', finishTrace);
      return originalExit.apply(this, arguments);
    };
  }
}
