import { describe, it, expect } from "vitest";
import { emptyDiff, mergeDiff, isEmptyDiff } from "../src/utils/whiteboardDiffBatch";
const r = (id: string, v: number) => ({ id, v }) as any;
describe("mergeDiff", () => {
  it("keeps only the latest state of a stroke drawn across frames", () => {
    const d = emptyDiff();
    mergeDiff(d, { added: { a: r("a", 1) } });
    mergeDiff(d, { updated: { a: [r("a", 1), r("a", 2)] } });
    mergeDiff(d, { updated: { a: [r("a", 2), r("a", 3)] } });
    expect(d.added.a).toEqual(r("a", 3));
    expect(Object.keys(d.updated)).toHaveLength(0);
  });
  it("add then remove cancels out", () => {
    const d = emptyDiff();
    mergeDiff(d, { added: { a: r("a", 1) } });
    mergeDiff(d, { removed: { a: r("a", 1) } });
    expect(isEmptyDiff(d)).toBe(true);
  });
  it("update then remove becomes a remove of the original", () => {
    const d = emptyDiff();
    mergeDiff(d, { updated: { b: [r("b", 1), r("b", 2)] } });
    mergeDiff(d, { removed: { b: r("b", 2) } });
    expect(d.removed.b).toEqual(r("b", 1));
    expect(d.updated.b).toBeUndefined();
  });
  it("chains updates keeping the first 'from'", () => {
    const d = emptyDiff();
    mergeDiff(d, { updated: { c: [r("c", 1), r("c", 2)] } });
    mergeDiff(d, { updated: { c: [r("c", 2), r("c", 5)] } });
    expect(d.updated.c).toEqual([r("c", 1), r("c", 5)]);
  });
});
