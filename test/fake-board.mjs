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
 * A board holding `columns` (the `Status` options, in board order), `fields` as `{ name, options }`
 * or, for a field of another type, `{ name, type }` with the type as GitHub names it, `items`, and
 * the repository's `labels`. Each item is given the board item
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
      readFields: () => read(() => board.fields.filter((field) => field.type === undefined)),
      readFieldTypes: () => read(() => [{ name: 'Status', type: 'SINGLE_SELECT' }, ...board.fields.map(({ name, type = 'SINGLE_SELECT' }) => ({ name, type }))]),
      readLabels: () => read(() => board.labels),
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
