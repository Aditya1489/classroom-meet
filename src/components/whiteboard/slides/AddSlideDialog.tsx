import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SLIDE_COLORS, isHexColor, type SlidePosition } from "./slideOps";

/** Tutor's "+ Slide" menu: where the new slide goes and its colour. */
export function AddSlideDialog({
  open,
  onOpenChange,
  slideCount,
  currentIndex,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slideCount: number;
  currentIndex: number;
  onAdd: (position: SlidePosition, color: string) => void;
}) {
  const [kind, setKind] = useState<SlidePosition["kind"]>("after");
  const [number, setNumber] = useState(1);
  const [color, setColor] = useState<string>(SLIDE_COLORS[0].value);
  const options: { kind: SlidePosition["kind"]; label: string }[] = slideCount
    ? [
        { kind: "after", label: `After this slide (${currentIndex + 1})` },
        { kind: "before", label: "Before this slide" },
        { kind: "end", label: "At the end" },
        { kind: "number", label: "At slide no." },
      ]
    : [{ kind: "end", label: "First slide" }];
  const active = slideCount ? kind : "end";

  const add = () => {
    onAdd(active === "number" ? { kind: "number", number } : ({ kind: active } as SlidePosition), color);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm w-[calc(100%-1rem)] p-4 sm:p-5 gap-4">
        <DialogHeader>
          <DialogTitle>Add a slide</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => setKind(o.kind)}
              className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${
                active === o.kind ? "border-amber-500 bg-amber-500/15 text-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {active === "number" && (
          <input
            type="number"
            min={1}
            max={slideCount + 1}
            value={number}
            onChange={(e) => setNumber(Number(e.target.value) || 1)}
            className="h-11 rounded-lg border border-border bg-background px-3 text-sm"
            aria-label="Slide number"
          />
        )}
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Colour</p>
          <div className="flex flex-wrap items-center gap-2">
            {SLIDE_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.name}
                aria-label={c.name}
                onClick={() => setColor(c.value)}
                style={{ background: c.value }}
                className={`h-9 w-9 rounded-full border ${color === c.value ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-background" : "border-border"}`}
              />
            ))}
            <label className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold">
              Custom
              <input type="color" value={isHexColor(color) ? color : "#ffffff"} onChange={(e) => setColor(e.target.value)} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
            </label>
          </div>
        </div>
        <button type="button" onClick={add} className="min-h-11 rounded-lg bg-amber-500 text-sm font-bold text-black">
          Add slide
        </button>
      </DialogContent>
    </Dialog>
  );
}
