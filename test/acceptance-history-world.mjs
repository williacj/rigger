// ABOUTME: Drives acceptance-history tests through the shared forge store and the real L2 and event sink.

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { forgeStore } from './in-process-fixtures.mjs';
import { openingTransport } from './opening-transport.mjs';
import { seedRepositoryAt } from './fake-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Recognises the selected history field, independent of query whitespace and field order. */
export function isHistoryRequest(args) {
  if (args[0] !== 'api' || args[1] !== 'graphql') return false;
  const hasHistory = (selections) => selections.some((field) =>
    (field.kind === 'field' && field.name === 'userContentEdits') || hasHistory(field.selections ?? []));
  return parseDocument(args[3].slice('query='.length)).operations.some(({ selections }) => hasHistory(selections));
}

/** A controlled forge whose raw history snapshots are supplied by each test, never by its oracle. */
export function historyWorld(t, { clock, body, history, column = 'Review', reply, repository = {} }) {
  const directory = realpathSync.native(temporaryDirectory('rigger-acceptance-history-', { context: t }));
  const statePath = join(directory, 'board.json');
  const settings = { ...config, board: { ...config.board } };
  const board = { ...settings.board, repo: settings.repo };
  // Existing installFakeGh/forgeStore state contract, used without an executable gh.
  writeFileSync(statePath, JSON.stringify({
    repo: settings.repo, owner: settings.board.owner, project: settings.board.project,
    model: { columns: Object.values(settings.board.columns), items: [
      { type: 'issue', repository: settings.repo, number: 12, title: 'History', body, labels: ['type:change'], column },
    ] }, writes: [], sent: [],
  }));
  seedRepositoryAt(statePath, { ...repository, issues: [{ number: 12, title: 'History', body, labels: ['type:change'], history }] });
  const store = forgeStore(statePath);
  const requests = [];
  const send = (command, args, options) => {
    requests.push({ command, args, side: options.side, timeout: options.timeout, at: clock.now() });
    const answer = () => store.answer(args, { cwd: directory, now: () => new Date(clock.now()).toISOString() });
    // Faults use the documented runner status/text contract; normal replies still use the shared forge.
    const transport = openingTransport(() => reply === undefined ? answer() : reply(args, options, answer));
    return transport.send(command, args, options);
  };
  const eventsAt = join(directory, 'events');
  const sink = openSink({ directory: eventsAt, run: 'r-history', now: clock.now });
  const events = () => existsSync(streamPath(eventsAt)) ? readEvents(eventsAt) : [];
  const reads = readSide(board, { send, emitter: sink.emitter({ layer: 'L0' }) });
  const held = () => JSON.parse(readFileSync(statePath, 'utf8'));
  return {
    clock, settings, sink, send, held, events,
    changes: columnChanges({ config: settings, sink, send }),
    card: async (number = 12) => (await reads.readItems()).find((card) => card.number === number),
    histories: () => events().filter(({ layer, event }) => layer === 'L2' && event === 'acceptance.history'),
    historyRequests: () => requests.filter(({ args }) => isHistoryRequest(args)),
    refuseEvents: (predicate, refusal) => {
      const emitter = sink.emitter.bind(sink);
      sink.emitter = (context) => {
        const destination = emitter(context);
        return { emit: (event, fields) => {
          if (predicate({ ...context, event, ...fields })) throw refusal;
          return destination.emit(event, fields);
        } };
      };
    },
    replaceHistory: (body, history) => {
      const state = held();
      Object.assign(state.repository.issues.find(({ number }) => number === 12), { body, history });
      state.model.items.find(({ number }) => number === 12).body = body;
      writeFileSync(statePath, JSON.stringify(state));
    },
  };
}
