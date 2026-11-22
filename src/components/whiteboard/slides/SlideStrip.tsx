import { useRef, useState } from "react";
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

/** Tutor's slide strip: thumbnails to jump to, drag to reorder, long-press / right-click / ⋯ for more. */
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
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

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
  const isBlank = (s: PresentationSlide) => Boolean((editor.getShape(s.shapeId)?.meta as { mathsySlide?: boolean })?.mathsySlide);
  const item = "min-h-10 w-full rounded-lg px-3 text-left text-xs font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-30";

  return (
    <div className="absolute left-1/2 top-2 z-[400] max-h-[85%] w-[calc(100%-1rem)] max-w-[900px] -translate-x-1/2 overflow-y-auto rounded-2xl border border-[#f59e0b]/40 bg-[#1a1814]/95 p-2 shadow-2xl backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-xs font-bold text-[#f59e0b]">Slides ({slides.length})</span>
        <button type="button" onClick={onClose} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-zinc-300 hover:bg-white/10">
          Close
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" onScroll={cancelPress}>
        {slides.map((s, i) => {
          const src = slideThumbSrc(editor, s);
          return (
            <div key={s.shapeId} className="relative shrink-0">
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
                onPointerDown={() => {
                  longPressed.current = false;
                  cancelPress();
                  pressTimer.current = window.setTimeout(() => {
                    longPressed.current = true;
                    openMenu(i);
                  }, 500);
                }}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onClick={() => {
                  if (longPressed.current) return;
                  onAction({ type: "go", index: i });
                }}
                title={`Slide ${i + 1}`}
                className={`relative block h-12 w-20 sm:h-16 sm:w-24 overflow-hidden rounded-lg border-2 bg-white select-none ${
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
                className="absolute right-0.5 top-0.5 h-6 w-6 rounded-md bg-black/70 text-xs font-bold text-white"
              >
                ⋯
              </button>
            </div>
          );
        })}
      </div>

      {menuFor !== null && slides[menuFor] && (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#221f1a] p-1.5">
          <p className="px-2 pb-1 text-[11px] font-bold text-zinc-400">Slide {menuFor + 1}</p>
          {confirmDelete ? (
            <div className="flex gap-2 p-1">
              <button type="button" onClick={() => act({ type: "delete", index: menuFor })} className="min-h-10 flex-1 rounded-lg bg-red-600 text-xs font-bold text-white">
                Delete slide {menuFor + 1} and its writing
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10">
                Cancel
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              <button type="button" className={item} onClick={() => act({ type: "add-after", index: menuFor })}>+ Add slide after</button>
              <button type="button" className={item} onClick={() => act({ type: "duplicate", index: menuFor })}>Duplicate</button>
              <button type="button" className={item} disabled={menuFor === 0} onClick={() => act({ type: "move", from: menuFor, to: menuFor - 1 })}>← Move left</button>
              <button type="button" className={item} disabled={menuFor === slides.length - 1} onClick={() => act({ type: "move", from: menuFor, to: menuFor + 1 })}>Move right →</button>
              <button type="button" className={`${item} text-red-400`} onClick={() => setConfirmDelete(true)}>Delete…</button>
              <button type="button" className={item} onClick={() => setMenuFor(null)}>Close</button>
              {isBlank(slides[menuFor]) && (
                <div className="col-span-2 flex flex-wrap items-center gap-2 px-2 py-1">
                  {SLIDE_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => act({ type: "color", index: menuFor, color: c.value })}
                      style={{ background: c.value }}
                      className="h-8 w-8 rounded-full border border-white/20"
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
