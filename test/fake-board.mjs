// ABOUTME: The fake board every M1 scheduling behaviour is proven against. Test-only, never
// imported from src/, and holding forge facts only: no card's linked pull request, no verdict.

export function createFakeBoard({ columns = [], fields = [], items = [] } = {}) {
  const board = structuredClone({
    columns,
    fields,
    items: items.map((item, index) => ({ ...item, id: `item-${index + 1}` })),
  });
  return {
    operations: {
      readItems: async () => structuredClone(board.items),
      readColumns: async () => structuredClone(board.columns),
      readFields: async () => structuredClone(board.fields),
      moveItem: async (itemId, column) => {
        board.items.find((item) => item.id === itemId).column = column;
      },
    },
  };
}
