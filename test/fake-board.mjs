// ABOUTME: The fake board every M1 scheduling behaviour is proven against. Test-only, never
// imported from src/, and holding forge facts only: no card's linked pull request, no verdict.

export function createFakeBoard({ columns = [], fields = [], items = [] } = {}) {
  const board = structuredClone({
    columns,
    fields,
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
