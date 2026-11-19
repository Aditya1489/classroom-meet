/**
 * Batches tldraw store diffs so a stroke goes to peers as a few small messages per second instead of one
 * per animation frame. Merging keeps only each record's latest state, so the batch is never larger than
 * the records that actually changed.
 */
type Rec = { id: string };
export interface WhiteboardDiff {
  added: Record<string, Rec>;
  updated: Record<string, [Rec, Rec]>;
  removed: Record<string, Rec>;
}

export const emptyDiff = (): WhiteboardDiff => ({ added: {}, updated: {}, removed: {} });

export const isEmptyDiff = (d: WhiteboardDiff) =>
  !Object.keys(d.added).length && !Object.keys(d.updated).length && !Object.keys(d.removed).length;

/** Folds `next` into `into` (mutates and returns `into`). */
export function mergeDiff(into: WhiteboardDiff, next: Partial<WhiteboardDiff>): WhiteboardDiff {
  for (const [id, rec] of Object.entries(next.added || {})) {
    if (into.removed[id]) {
      into.updated[id] = [into.removed[id], rec];
      delete into.removed[id];
    } else {
      into.added[id] = rec;
    }
  }
  for (const [id, [from, to]] of Object.entries(next.updated || {})) {
    if (into.added[id]) into.added[id] = to;
    else if (into.updated[id]) into.updated[id] = [into.updated[id][0], to];
    else into.updated[id] = [from, to];
  }
  for (const [id, rec] of Object.entries(next.removed || {})) {
    if (into.added[id]) {
      delete into.added[id];
    } else {
      into.removed[id] = into.updated[id] ? into.updated[id][0] : rec;
      delete into.updated[id];
    }
  }
  return into;
}
