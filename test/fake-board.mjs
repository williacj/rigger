// ABOUTME: The fake board every M1 scheduling behaviour is proven against. Test-only, never
// imported from src/, and holding forge facts only: no card's linked pull request, no verdict.

/**
 * Everything the fake holds of one board item. Each is a forge fact the board itself carries; a
 * card's linked pull request and any verdict are not, so an item naming either is refused.
 * `type` is `issue`, `draftIssue` or `pullRequest`, and `fieldValues` maps a field's name to the
 * option the item holds in it, as `{ Priority: 'P1' }`.
 */
const ITEM_FACTS = ['type', 'repository', 'number', 'title', 'body', 'labels', 'column', 'fieldValues'];

/**
 * A board holding `columns` (the `Status` options, in board order), single-select `fields` as
 * `{ name, options }`, `items`, and the repository's `labels`. Each item is given the board item
 * id `item-1`, `item-2` and so on, in the order given, which is what a move names.
 *
 * Its `operations` are what the forge adapter offers, and nothing else is: `writes()` and
 * `holdNextRead()` are the test's controls, not the board's.
 */
export function createFakeBoard({ columns = [], fields = [], items = [], labels = [] } = {}) {
  for (const item of items) {
    const unmodelled = Object.keys(item).filter((fact) => !ITEM_FACTS.includes(fact));
    if (unmodelled.length > 0) {
      throw new Error(`the fake board does not hold an item's ${unmodelled.join(', ')}`);
    }
  }
  const board = structuredClone({
    columns,
    fields,
    labels,
    items: items.map((item, index) => ({ ...item, id: `item-${index + 1}` })),
  });
  const writes = [];
  const record = (operation, args) => writes.push(structuredClone({ operation, args }));

  // A held read answers when the test releases it, with the board as it stands then.
  let heldGate = null;
  const read = (answer) => {
    const gate = heldGate ?? Promise.resolve();
    heldGate = null;
    return gate.then(() => structuredClone(answer()));
  };

  return {
    operations: {
      readItems: () => read(() => board.items),
      readColumns: () => read(() => board.columns),
      readFields: () => read(() => board.fields),
      readLabels: () => read(() => board.labels),
      /**
       * What L0 hands L3 for the priority declaration `priority`, a config's `board.priority`:
       * every item with its `priority` as `{ value, declared }`, the declared order, and the
       * field's options in board order. With no declaration, no item has a priority and there is
       * no order. The adapter's read takes its declaration from the config it was given.
       */
      readPriority: (priority) => read(() => {
        if (!priority) return { items: board.items.map((item) => ({ ...item, priority: null })), declared: null, options: null };
        const field = board.fields.find(({ name }) => name === priority.field);
        if (!field) throw new Error(`the fake board has no field named ${priority.field}`);
        const items = board.items.map((item) => {
          const value = item.fieldValues?.[priority.field] ?? null;
          return { ...item, priority: { value, declared: priority.options.includes(value) } };
        });
        return { items, declared: [...priority.options], options: field.options };
      }),
      moveItem: async (itemId, column) => {
        if (!board.columns.includes(column)) {
          throw new Error(`the fake board has no column named ${column}`);
        }
        board.items.find((item) => item.id === itemId).column = column;
        record('moveItem', [itemId, column]);
      },
      createColumn: async (name) => {
        board.columns.push(name);
        record('createColumn', [name]);
      },
      createField: async (name, options) => {
        board.fields.push(structuredClone({ name, options }));
        record('createField', [name, options]);
      },
      createLabel: async (name) => {
        board.labels.push(name);
        record('createLabel', [name]);
      },
    },
    writes: () => structuredClone(writes),
    /** Holds the next read unanswered, and returns the function that releases it. */
    holdNextRead: () => {
      let release;
      heldGate = new Promise((resolve) => (release = resolve));
      return release;
    },
  };
}
