/** Pure board operations: find a card and move it within or between columns. */

export interface CardLocation {
  columnIndex: number;
  cardIndex: number;
}

export function findCard<C extends { id: string; cards: readonly { id: string }[] }>(
  columns: readonly C[],
  cardId: string,
): CardLocation | null {
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const cardIndex = columns[columnIndex].cards.findIndex((card) => card.id === cardId);
    if (cardIndex !== -1) return { columnIndex, cardIndex };
  }
  return null;
}

/**
 * Moves a card to `toColumnId` so that it ends up at `toIndex` (its final
 * position, clamped). Returns the same array when nothing changes, otherwise
 * a new array where only the touched columns are copied.
 */
export function moveCard<K extends { id: string }, C extends { id: string; cards: readonly K[] }>(
  columns: readonly C[],
  cardId: string,
  toColumnId: string,
  toIndex: number,
): C[] {
  const from = findCard(columns, cardId);
  const toColumnIndex = columns.findIndex((column) => column.id === toColumnId);
  if (!from || toColumnIndex === -1) return columns as C[];

  const source = columns[from.columnIndex];
  const card = source.cards[from.cardIndex];
  const sameColumn = from.columnIndex === toColumnIndex;
  const targetLength = columns[toColumnIndex].cards.length - (sameColumn ? 1 : 0);
  const index = Math.min(Math.max(0, Math.floor(toIndex)), targetLength);
  if (sameColumn && index === from.cardIndex) return columns as C[];

  const next = columns.slice();
  const remaining = source.cards.filter((_, i) => i !== from.cardIndex);
  if (sameColumn) {
    remaining.splice(index, 0, card);
    next[from.columnIndex] = { ...source, cards: remaining };
  } else {
    const target = columns[toColumnIndex];
    const cards = target.cards.slice();
    cards.splice(index, 0, card);
    next[from.columnIndex] = { ...source, cards: remaining };
    next[toColumnIndex] = { ...target, cards };
  }
  return next;
}

/**
 * Converts a drop-indicator slot (0…length, counted with the dragged card
 * still in place) into the final index expected by `moveCard`.
 */
export function slotToIndex(slot: number, from: CardLocation | null, toColumnIndex: number): number {
  return from && from.columnIndex === toColumnIndex && from.cardIndex < slot ? slot - 1 : slot;
}

export interface HorizontalRect {
  left: number;
  right: number;
}

/**
 * Column under a pointer x: the one containing it, else the nearest one (the
 * pointer is in a gap). -1 when there are no columns.
 */
export function pickColumn(rects: readonly HorizontalRect[], x: number): number {
  let best = -1;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Auto-scroll step while dragging near an edge: 0 outside `zone`, growing
 * linearly to `max` px per frame at the edge. Negative scrolls back.
 */
export function edgeScrollStep(position: number, start: number, end: number, zone = 48, max = 14): number {
  if (end - start <= zone * 2) return 0;
  if (position < start + zone) return -Math.round(max * Math.min(1, (start + zone - position) / zone));
  if (position > end - zone) return Math.round(max * Math.min(1, (position - (end - zone)) / zone));
  return 0;
}
