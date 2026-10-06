import { useState, useRef } from "react";
import {
  ShapeUtil,
  TLBaseShape,
  HTMLContainer,
  Rectangle2d,
  TLIndicatorPath,
  TLResizeInfo,
  TLShapePartial,
  createShapeId,
  DefaultColorStyle,
} from "tldraw";

// ── Module augmentation: register 'ruler' in tldraw's global shape type map ─
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    ruler: { w: number; h: number; rotation: number; color?: string };
  }
}

export type RulerShape = TLBaseShape<
  "ruler",
  { w: number; h: number; rotation: number; color?: string }
>;

// Available Ruler Line Colors
const RULER_COLORS: Record<
  string,
  { hex: string; bg: string; border: string; name: string; fillHex: string }
> = {
  blue: { hex: "#2563eb", bg: "bg-blue-600", border: "border-blue-400", name: "Blue", fillHex: "#3b82f6" },
  green: { hex: "#16a34a", bg: "bg-emerald-600", border: "border-emerald-400", name: "Green", fillHex: "#22c55e" },
  red: { hex: "#dc2626", bg: "bg-red-600", border: "border-red-400", name: "Red", fillHex: "#ef4444" },
  orange: { hex: "#ea580c", bg: "bg-orange-600", border: "border-orange-400", name: "Orange", fillHex: "#f97316" },
  purple: { hex: "#9333ea", bg: "bg-purple-600", border: "border-purple-400", name: "Purple", fillHex: "#a855f7" },
  black: { hex: "#0f172a", bg: "bg-slate-800", border: "border-slate-500", name: "Black", fillHex: "#334155" },
};

// ── Ruler Renderer Component ──────────────────────────────────────────────────
const RulerComponent = ({
  shape,
  editor,
}: {
  shape: RulerShape;
  editor: any;
}) => {
  const { w = 420, h = 70, rotation = 0 } = shape.props;
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Resolve active color from shape props OR active Tldraw toolbar color
  const activeColorKey =
    shape.props.color ||
    (editor ? editor.getSharedStyles().getAsKnownValue(DefaultColorStyle) : "blue");

  const colorConfig = RULER_COLORS[activeColorKey] || RULER_COLORS["blue"];

  // 1 cm = ~37.8px on screen
  const cmLength = Math.max(5, Math.floor((w - 40) / 37.8));
  const measuredCm = ((w - 40) / 37.8).toFixed(1);

  // Quick Action: Commit exact measured straight line along ruler top edge
  const handleCommitLine = () => {
    if (!editor) return;

    const rotRad = (rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // World start & end coordinates of top edge scale line
    const localStartX = 20;
    const localStartY = 1;
    const localEndX = w - 20;
    const localEndY = 1;

    const relStartX = localStartX - w / 2;
    const relStartY = localStartY - h / 2;
    const relEndX = localEndX - w / 2;
    const relEndY = localEndY - h / 2;

    const worldStartX = shape.x + w / 2 + (relStartX * cosR - relStartY * sinR);
    const worldStartY = shape.y + h / 2 + (relStartX * sinR + relStartY * cosR);

    const worldEndX = shape.x + w / 2 + (relEndX * cosR - relEndY * sinR);
    const worldEndY = shape.y + h / 2 + (relEndX * sinR + relEndY * cosR);

    const lineId = createShapeId(`ruler-line-${Date.now()}`);
    const tldrawColor = activeColorKey in RULER_COLORS ? activeColorKey : "blue";

    editor.createShapes([
      {
        id: lineId,
        type: "arrow",
        x: worldStartX,
        y: worldStartY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: worldEndX - worldStartX, y: worldEndY - worldStartY },
          color: tldrawColor as any,
          size: "m",
        },
      },
    ]);
  };

  const pivotRef = useRef<HTMLDivElement>(null);

  const handleSelectColor = (colorKey: string) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "ruler",
        props: { ...shape.props, color: colorKey },
      },
    ]);
    setShowColorPicker(false);
  };

  const handleSnapAngle = (targetDeg: number) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "ruler",
        props: { ...shape.props, rotation: targetDeg },
      },
    ]);
  };

  // Drag interaction handler with True 1:1 Angle Tracking
  const handlePointerDown = (
    e: React.PointerEvent,
    mode: "move" | "rotate" | "scale"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    isDraggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;

    const startRotation = rotation;
    const startW = w;
    const startXPos = shape.x;
    const startYPos = shape.y;

    const pivotRect = pivotRef.current?.getBoundingClientRect();
    const centerScreenX = pivotRect ? pivotRect.left + pivotRect.width / 2 : startX;
    const centerScreenY = pivotRect ? pivotRect.top + pivotRect.height / 2 : startY;

    const startMouseRad = Math.atan2(startY - centerScreenY, startX - centerScreenX);
    const startRotationRad = (startRotation * Math.PI) / 180;

    const onPointerMove = (moveEv: PointerEvent) => {
      moveEv.stopPropagation();
      moveEv.preventDefault();

      const deltaX = moveEv.clientX - startX;
      const deltaY = moveEv.clientY - startY;

      if (mode === "move") {
        editor.updateShapes([
          {
            id: shape.id,
            type: "ruler",
            x: startXPos + deltaX,
            y: startYPos + deltaY,
          },
        ]);
      } else if (mode === "rotate") {
        const currentMouseRad = Math.atan2(moveEv.clientY - centerScreenY, moveEv.clientX - centerScreenX);
        const totalDiffRad = currentMouseRad - startMouseRad;
        let newRotation = ((startRotationRad + totalDiffRad) * (180 / Math.PI) + 360) % 360;

        if (moveEv.shiftKey) {
          newRotation = Math.round(newRotation / 15) * 15;
        } else {
          newRotation = Math.round(newRotation);
        }

        editor.updateShapes([
          {
            id: shape.id,
            type: "ruler",
            props: { ...shape.props, rotation: newRotation },
          },
        ]);
      } else if (mode === "scale") {
        const newW = Math.max(220, Math.min(800, startW + deltaX));
        editor.updateShapes([
          {
            id: shape.id,
            type: "ruler",
            props: { ...shape.props, w: newW },
          },
        ]);
      }
    };

    const onPointerUp = (upEv: PointerEvent) => {
      upEv.stopPropagation();
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Render ticks for Top (cm/mm) and Bottom (inches)
  const renderScaleTicks = () => {
    const ticks = [];
    const scaleWidth = w - 40;
    const totalMm = Math.floor(scaleWidth / 3.78);

    // Top CM / MM scale
    for (let mm = 0; mm <= totalMm; mm++) {
      const x = 20 + mm * 3.78;
      if (x > w - 20) break;
      const isCm = mm % 10 === 0;
      const isHalfCm = mm % 5 === 0 && !isCm;
      const tickLen = isCm ? 18 : isHalfCm ? 12 : 7;

      ticks.push(
        <line
          key={`mm-${mm}`}
          x1={x}
          y1={0}
          x2={x}
          y2={tickLen}
          stroke="#1e293b"
          strokeWidth={isCm ? 1.5 : 1}
        />
      );

      if (isCm) {
        const cmVal = mm / 10;
        ticks.push(
          <text
            key={`cm-lbl-${mm}`}
            x={x}
            y={32}
            fontSize="10"
            fontWeight="bold"
            fill="#0f172a"
            textAnchor="middle"
          >
            {cmVal}
          </text>
        );
      }
    }

    // Bottom Inches scale (1 in = 96px)
    const totalInches = Math.floor(scaleWidth / 96);
    for (let inch = 0; inch <= totalInches; inch++) {
      const x = 20 + inch * 96;
      if (x > w - 20) break;

      ticks.push(
        <line
          key={`in-${inch}`}
          x1={x}
          y1={h}
          x2={x}
          y2={h - 16}
          stroke="#475569"
          strokeWidth="1.5"
        />
      );

      ticks.push(
        <text
          key={`in-lbl-${inch}`}
          x={x}
          y={h - 22}
          fontSize="9"
          fontWeight="bold"
          fill="#475569"
          textAnchor="middle"
        >
          {inch}"
        </text>
      );
    }

    return ticks;
  };

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        overflow: "visible",
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        ref={containerRef}
        className="relative w-full h-full"
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: `${w / 2}px ${h / 2}px`,
          transition: isDraggingRef.current ? "none" : "transform 0.05s ease-out",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Pivot Ref Anchor Element */}
        <div
          ref={pivotRef}
          className="absolute w-1 h-1 pointer-events-none"
          style={{ left: w / 2, top: h / 2 }}
        />

        {/* ── Control Handles ── */}
        {/* Delete Handle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            editor?.deleteShapes([shape.id]);
          }}
          className="absolute -top-10 left-4 z-50 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-pointer active:scale-95 transition-transform"
          title="Delete Ruler"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Move Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "move")}
          className="absolute -top-10 left-14 z-50 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-move active:scale-95 transition-transform"
          title="Drag to Position Ruler"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>

        {/* Rotate Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "rotate")}
          className="absolute -top-10 left-24 z-50 w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-grab active:cursor-grabbing active:scale-95 transition-transform"
          title="Rotate Ruler Angle"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>

        {/* Color Picker Toggle Handle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowColorPicker(!showColorPicker);
          }}
          className="absolute -top-10 left-34 z-50 w-7 h-7 rounded-full border border-white/30 shadow-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          style={{ backgroundColor: colorConfig.fillHex }}
          title="Change Ruler Line Color"
        />

        {/* Commit Measured Line Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCommitLine();
          }}
          className={`absolute -top-10 right-12 z-50 flex items-center gap-1.5 ${colorConfig.bg} text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer`}
          title="Commit Measured Line to Whiteboard"
        >
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
          <span>Draw {measuredCm} cm Line</span>
        </button>

        {/* Extend / Scale Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "scale")}
          className="absolute -top-10 right-2 z-50 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-ew-resize active:scale-95 transition-transform"
          title="Extend or Shorten Ruler"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7h8M8 17h8M7 12h10" />
          </svg>
        </div>

        {/* Color Palette Popup */}
        {showColorPicker && (
          <div
            className="absolute -top-20 left-10 z-50 flex items-center gap-1.5 bg-zinc-900/95 border border-white/20 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] font-bold text-zinc-400 mr-1 select-none">Color:</span>
            {Object.entries(RULER_COLORS).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => handleSelectColor(key)}
                className={`w-5 h-5 rounded-full transition-transform active:scale-95 border ${
                  activeColorKey === key ? "ring-2 ring-white scale-110 border-white" : "border-transparent opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: cfg.fillHex }}
                title={`Select ${cfg.name}`}
              />
            ))}
          </div>
        )}

        {/* ── Ruler SVG Body ── */}
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="overflow-visible select-none"
        >
          <defs>
            <linearGradient id="rulerGlassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#f1f5f9" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* Main Acrylic Glass Rect */}
          <rect
            x="0"
            y="0"
            width={w}
            height={h}
            rx="6"
            ry="6"
            fill="url(#rulerGlassGrad)"
            stroke="#94a3b8"
            strokeWidth="2"
          />

          {/* Colored Top Measuring Edge Line */}
          <line
            x1="20"
            y1="0"
            x2={w - 20}
            y2="0"
            stroke={colorConfig.hex}
            strokeWidth="3.5"
          />

          {/* Scale Markings */}
          {renderScaleTicks()}

          {/* Centimeter & Unit Label */}
          <text
            x={w - 28}
            y={24}
            fontSize="10"
            fontWeight="bold"
            fill="#334155"
            textAnchor="end"
          >
            cm
          </text>
        </svg>

        {/* Angle / Info HUD */}
        <div className="absolute bottom-1 right-3 text-[10px] font-mono font-bold text-zinc-500 pointer-events-none select-none">
          {rotation}°
        </div>
      </div>
    </HTMLContainer>
  );
};

// ── Shape Util Class ──────────────────────────────────────────────────────────
export class RulerShapeUtil extends ShapeUtil<RulerShape> {
  static override type = "ruler" as const;

  override getDefaultProps(): RulerShape["props"] {
    return { w: 420, h: 70, rotation: 0, color: "blue" };
  }

  override canEdit = () => false;
  override isAspectRatioLocked = () => false;
  override canResize = () => true;
  override canBind = () => false;

  override getGeometry(shape: RulerShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override onResize(
    shape: RulerShape,
    info: TLResizeInfo<RulerShape>
  ): Omit<TLShapePartial<RulerShape>, "id" | "type"> | void {
    const { initialShape, scaleX } = info;
    const newW = Math.max(220, Math.min(800, Math.abs(initialShape.props.w * scaleX)));
    return {
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: { ...shape.props, w: newW },
    };
  }

  override getIndicatorPath(shape: RulerShape): TLIndicatorPath | undefined {
    const { w, h } = shape.props;
    const path = new Path2D();
    path.rect(0, 0, w, h);
    return path;
  }

  override component(shape: RulerShape) {
    return <RulerComponent shape={shape} editor={this.editor} />;
  }

  override indicator(_shape: RulerShape) {
    return null;
  }
}
