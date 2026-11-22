import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import type { PresentationSlide } from "../importers/whiteboardImporter";
import { SLIDE_COLORS, slideThumbSrc } from "./slideOps";

export type SlideAction =
  | { type: "go"; index: number }
  | { type: "move"; from: number; to: number }
  | { type: "add-after"; index: number }
  | { type: "duplicate"; index: number }
  | { type: "delete"; index: number }
  | { type: "color"; index: number; color: string };

/** Tablets (touch/pen, 768px+): the strip sits down the left side. Phones and laptops: across the top. */
function useSideLayout(): boolean {
  const query = "(pointer: coarse) and (min-width: 768px)";
  const [side, setSide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setSide(mq.matches);
    mq.addEventListener("change", update); // also covers rotation
    return () => mq.removeEventListener("change", update);
  }, []);
  return side;
}

/** Stylus guard: while a pen is in use, touches (a resting palm) on the strip are ignored. */
function usePenActive(): () => boolean {
  const lastPen = useRef(0);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "pen") lastPen.current = Date.now();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("pointermove", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("pointermove", onPointer, true);
    };
  }, []);
  return () => Date.now() - lastPen.current < 1000;
}

/**
 * Tutor's slide strip: tap to jump; drag (mouse) or the ⠿ handle (touch/pen) to reorder;
 * long-press / right-click / ⋯ for more.
 */
export function SlideStrip({
  editor,
  slides,
  currentIndex,
  onAction,
  onClose,
}: {
  editor: Editor;
  slides: PresentationSlide[];
  currentIndex: number;
  onAction: (action: SlideAction) => void;
  onClose: () => void;
}) {
  const side = useSideLayout();
  const penActive = usePenActive();
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  // Palm touches while writing with a pen do nothing.
  const blocked = (e: React.PointerEvent | React.MouseEvent) =>
    "pointerType" in e && e.pointerType === "touch" && penActive();

  const openMenu = (i: number) => {
    setConfirmDelete(false);
    setMenuFor(i);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const act = (a: SlideAction) => {
    setMenuFor(null);
    onAction(a);
  };
  const indexAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-slide-index]");
    return el ? Number(el.getAttribute("data-slide-index")) : null;
  };
  const isBlank = (s: PresentationSlide) => Boolean((editor.getShape(s.shapeId)?.meta as { mathsySlide?: boolean })?.mathsySlide);
  const item = "min-h-11 sm:min-h-10 w-full rounded-lg px-3 text-left text-xs font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-30";

  return (
    <div
      className={`absolute z-[400] rounded-2xl border border-[#f59e0b]/40 bg-[#1a1814]/95 p-2 shadow-2xl backdrop-blur ${
        side
          ? "bottom-2 left-2 top-2 flex w-40 flex-col"
          : "left-1/2 top-2 max-h-[85%] w-[calc(100%-1rem)] max-w-[900px] -translate-x-1/2 overflow-y-auto"
      }`}
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between px-1">
        <span className="text-xs font-bold text-[#f59e0b]">Slides ({slides.length})</span>
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-2 text-xs font-semibold text-zinc-300 hover:bg-white/10">
          Close
        </button>
      </div>
      <div
        className={`flex gap-2 ${side ? "min-h-0 flex-1 flex-col items-center overflow-y-auto" : "overflow-x-auto pb-1"}`}
        onScroll={cancelPress}
      >
        {slides.map((s, i) => {
          const src = slideThumbSrc(editor, s);
          return (
            <div key={s.shapeId} data-slide-index={i} className={`relative shrink-0 rounded-lg ${dropAt === i && dragFrom !== i ? "ring-2 ring-sky-400" : ""}`}>
              <button
                type="button"
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null && dragFrom !== i) onAction({ type: "move", from: dragFrom, to: i });
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(i);
                }}
                onPointerDown={(e) => {
                  longPressed.current = false;
                  cancelPress();
                  if (blocked(e)) return;
                  pressTimer.current = window.setTimeout(() => {
                    longPressed.current = true;
                    openMenu(i);
                  }, 500);
                }}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onClick={(e) => {
                  if (longPressed.current || (e.nativeEvent as PointerEvent).pointerType === "touch" && penActive()) return;
                  onAction({ type: "go", index: i });
                }}
                title={`Slide ${i + 1}`}
                className={`relative block h-14 w-24 overflow-hidden rounded-lg border-2 bg-white select-none sm:h-16 sm:w-28 [-webkit-touch-callout:none] ${
                  i === currentIndex ? "border-[#f59e0b]" : "border-transparent"
                } ${dragFrom === i ? "opacity-40" : ""}`}
              >
                {src && <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] font-bold text-white">{i + 1}</span>
              </button>
              <button
                type="button"
                aria-label={`Slide ${i + 1} options`}
                onClick={() => openMenu(i)}
                className="absolute right-0.5 top-0.5 h-7 w-7 rounded-md bg-black/70 text-xs font-bold text-white"
              >
                ⋯
              </button>
              {/* Touch / pen reorder handle: hold and drag onto another slide. */}
              <button
                type="button"
                aria-label={`Drag to move slide ${i + 1}`}
                className="absolute bottom-0.5 right-0.5 h-7 w-7 touch-none rounded-md bg-black/70 text-xs font-bold text-white"
                onPointerDown={(e) => {
                  if (blocked(e)) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragFrom(i);
                  setDropAt(i);
                }}
                onPointerMove={(e) => {
                  if (dragFrom !== i) return;
                  setDropAt(indexAt(e.clientX, e.clientY));
                }}
                onPointerUp={(e) => {
                  if (dragFrom !== i) return;
                  const to = indexAt(e.clientX, e.clientY);
                  setDragFrom(null);
                  setDropAt(null);
                  if (to !== null && to !== i) onAction({ type: "move", from: i, to });
                }}
                onPointerCancel={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
              >
                ⠿
              </button>
            </div>
          );
        })}
      </div>

      {menuFor !== null && slides[menuFor] && (
        <div className={`mt-2 shrink-0 rounded-xl border border-white/10 bg-[#221f1a] p-1.5 ${side ? "max-h-[50%] overflow-y-auto" : ""}`}>
          <p className="px-2 pb-1 text-[11px] font-bold text-zinc-400">Slide {menuFor + 1}</p>
          {confirmDelete ? (
            <div className="flex flex-wrap gap-2 p-1">
              <button type="button" onClick={() => act({ type: "delete", index: menuFor })} className="min-h-11 flex-1 rounded-lg bg-red-600 px-2 text-xs font-bold text-white">
                Delete slide {menuFor + 1} and its writing
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10">
                Cancel
              </button>
            </div>
          ) : (
            <div className={`grid gap-1 ${side ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
              <button type="button" className={item} onClick={() => act({ type: "add-after", index: menuFor })}>+ Add slide after</button>
              <button type="button" className={item} onClick={() => act({ type: "duplicate", index: menuFor })}>Duplicate</button>
              <button type="button" className={item} disabled={menuFor === 0} onClick={() => act({ type: "move", from: menuFor, to: menuFor - 1 })}>{side ? "↑ Move up" : "← Move left"}</button>
              <button type="button" className={item} disabled={menuFor === slides.length - 1} onClick={() => act({ type: "move", from: menuFor, to: menuFor + 1 })}>{side ? "↓ Move down" : "Move right →"}</button>
              <button type="button" className={`${item} text-red-400`} onClick={() => setConfirmDelete(true)}>Delete…</button>
              <button type="button" className={item} onClick={() => setMenuFor(null)}>Close</button>
              {isBlank(slides[menuFor]) && (
                <div className={`flex flex-wrap items-center gap-2 px-2 py-1 ${side ? "" : "col-span-2 sm:col-span-3"}`}>
                  {SLIDE_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => act({ type: "color", index: menuFor, color: c.value })}
                      style={{ background: c.value }}
                      className="h-9 w-9 rounded-full border border-white/20"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
