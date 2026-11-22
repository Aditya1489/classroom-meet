import { AssetRecordType, createShapeId, type Editor, type TLAssetId, type TLShapeId } from "tldraw";
import type { PresentationSlide } from "../importers/whiteboardImporter";

/**
 * Tutor-added blank slides. A slide is a locked, solid-colour image on the board — the same kind of shape an
 * imported PDF page is — so students' boards, slide navigation and the class-notes PDF handle it unchanged.
 * Slides sit side by side; inserting one in the middle moves the later slides (and what was drawn on them) right.
 */

/** Preset slide colours (the tutor can also pick any colour). */
export const SLIDE_COLORS = [
  { name: "White", value: "#ffffff" },
  { name: "Cream", value: "#fdf6e3" },
  { name: "Light yellow", value: "#fff9c4" },
  { name: "Light blue", value: "#e3f2fd" },
  { name: "Mint", value: "#e8f5e9" },
  { name: "Pink", value: "#fce4ec" },
  { name: "Chalkboard", value: "#1f3b2d" },
  { name: "Black", value: "#111111" },
] as const;

/** Default slide size when the board has no slides yet (matches the importer's 1600px-wide slides, 16:9). */
export const DEFAULT_SLIDE_SIZE = { w: 1600, h: 900 };
/** Gap between slides when there is no second slide to measure it from (matches the importer). */
export const DEFAULT_SLIDE_GAP = 1200;

export type SlidePosition =
  | { kind: "after" }
  | { kind: "before" }
  | { kind: "end" }
  | { kind: "number"; number: number };

/** Where the new slide goes in the list (0 … count). */
export function resolveInsertIndex(position: SlidePosition, currentIndex: number, count: number): number {
  if (count <= 0) return 0;
  const current = Math.max(0, Math.min(currentIndex, count - 1));
  switch (position.kind) {
    case "after":
      return current + 1;
    case "before":
      return current;
    case "end":
      return count;
    case "number":
      return Math.max(0, Math.min(Math.round(position.number) - 1, count));
  }
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** A solid-colour SVG image to use as the slide's background. */
export function solidColorDataUrl(hex: string, w: number, h: number): string {
  const color = isHexColor(hex) ? hex : "#ffffff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

type Box = { x: number; y: number; w: number; h: number };

export interface SlidePlacement {
  box: Box;
  /** Shapes whose centre is at or right of this x move right by shiftBy (the new slide's place onwards). */
  shiftFromX: number | null;
  shiftBy: number;
}

/** Slide size that fills the tutor's visible board (its aspect ratio), whatever size imported slides are. */
export function slideSizeForView(view: { w: number; h: number }): { w: number; h: number } {
  const w = DEFAULT_SLIDE_SIZE.w;
  const ratio = view.w > 0 && view.h > 0 ? view.h / view.w : DEFAULT_SLIDE_SIZE.h / DEFAULT_SLIDE_SIZE.w;
  return { w, h: Math.round(w * Math.min(Math.max(ratio, 0.3), 3)) };
}

/**
 * Decides where the new slide (of the given size) goes. Keeps the existing gap between slides;
 * with no slides yet, it goes right of anything already drawn (or in the current view).
 */
export function planSlidePlacement(
  slides: Box[],
  insertIndex: number,
  size: { w: number; h: number },
  context: { contentRight: number | null; viewportCenter: { x: number; y: number } }
): SlidePlacement {
  const { w, h } = size;
  const sorted = [...slides].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) {
    const x = context.contentRight !== null ? context.contentRight + DEFAULT_SLIDE_GAP : context.viewportCenter.x - w / 2;
    return { box: { x, y: context.viewportCenter.y - h / 2, w, h }, shiftFromX: null, shiftBy: 0 };
  }
  const gap = sorted.length >= 2 ? Math.max(sorted[1].x - (sorted[0].x + sorted[0].w), 0) : DEFAULT_SLIDE_GAP;
  const y = sorted[0].y;
  if (insertIndex >= sorted.length) {
    const last = sorted[sorted.length - 1];
    return { box: { x: last.x + last.w + gap, y, w, h }, shiftFromX: null, shiftBy: 0 };
  }
  const at = sorted[Math.max(0, insertIndex)];
  // Everything from the middle of the gap before the slide being pushed along moves right by the new slide's width + gap.
  return { box: { x: at.x, y, w, h }, shiftFromX: at.x - gap / 2, shiftBy: w + gap };
}

/** The slide list as it is on the board: locked images, left to right (same rule students' boards use). */
export function readSlidesFromBoard(editor: Editor): PresentationSlide[] {
  const images = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "image" && s.isLocked)
    .map((s) => ({ shape: s, bounds: editor.getShapePageBounds(s.id) }))
    .filter((s): s is { shape: (typeof s)["shape"]; bounds: NonNullable<(typeof s)["bounds"]> } => Boolean(s.bounds))
    .sort((a, b) => a.bounds.x - b.bounds.x);
  return images.map(({ shape, bounds }, index) => {
    const props = shape.props as { altText?: string; assetId?: string };
    return {
      index,
      pageNumber: index + 1,
      totalCount: images.length,
      title: props.altText || `Slide ${index + 1}`,
      shapeId: shape.id as TLShapeId,
      assetId: props.assetId || "",
      bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
    };
  });
}

/**
 * Adds a blank slide of the given colour at insertIndex, moving later slides and their drawings right.
 * Returns the new slide list and the new slide's index.
 */
export function insertBlankSlide(
  editor: Editor,
  slides: PresentationSlide[],
  insertIndex: number,
  color: string
): { slides: PresentationSlide[]; index: number; shapeId: TLShapeId } {
  const pageBounds = editor.getCurrentPageBounds();
  const placement = planSlidePlacement(
    slides.map((s) => editor.getShapePageBounds(s.shapeId) ?? s.bounds),
    insertIndex,
    slideSizeForView(editor.getViewportScreenBounds()),
    { contentRight: pageBounds ? pageBounds.maxX : null, viewportCenter: editor.getViewportPageBounds().center }
  );
  const { box } = placement;
  const assetId = AssetRecordType.createId() as TLAssetId;
  const shapeId = createShapeId();
  const title = "Blank slide";

  editor.run(
    () => {
      if (placement.shiftFromX !== null && placement.shiftBy > 0) {
        const pageId = editor.getCurrentPageId();
        const toMove = editor
          .getCurrentPageShapes()
          .filter((s) => s.parentId === pageId)
          .filter((s) => {
            const b = editor.getShapePageBounds(s.id);
            return Boolean(b) && b!.center.x >= placement.shiftFromX!;
          });
        if (toMove.length) {
          editor.updateShapes(toMove.map((s) => ({ id: s.id, type: s.type, x: s.x + placement.shiftBy })));
        }
      }
      editor.createAssets([
        {
          id: assetId,
          typeName: "asset",
          type: "image",
          props: { name: title, src: solidColorDataUrl(color, box.w, box.h), w: box.w, h: box.h, mimeType: "image/svg+xml", isAnimated: false },
          meta: { mathsySlide: true, color },
        },
      ]);
      editor.createShapes([
        {
          id: shapeId,
          type: "image",
          x: box.x,
          y: box.y,
          isLocked: true,
          props: { assetId, w: box.w, h: box.h, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: title },
          meta: { mathsySlide: true, color },
        },
      ]);
    },
    { ignoreShapeLock: true }
  );

  const next = readSlidesFromBoard(editor);
  const index = Math.max(0, next.findIndex((s) => s.shapeId === shapeId));
  return { slides: next, index, shapeId };
}
