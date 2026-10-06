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

// ── Module augmentation: register 'setsquare' in tldraw's global shape type map
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    setsquare: { w: number; h: number; rotation: number; color?: string };
  }
}

export type SetSquareShape = TLBaseShape<
  "setsquare",
  { w: number; h: number; rotation: number; color?: string }
>;

// Available Set Square Colors
const SETSQUARE_COLORS: Record<
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

// ── Set Square Renderer Component ─────────────────────────────────────────────
const SetSquareComponent = ({
  shape,
  editor,
}: {
  shape: SetSquareShape;
  editor: any;
}) => {
  const { w = 240, h = 240, rotation = 0 } = shape.props;
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Resolve active color from shape props OR active Tldraw toolbar color
  const activeColorKey =
    shape.props.color ||
    (editor ? editor.getSharedStyles().getAsKnownValue(DefaultColorStyle) : "blue");

  const colorConfig = SETSQUARE_COLORS[activeColorKey] || SETSQUARE_COLORS["blue"];

  // Coordinates of 90° right-triangle vertices
  const p1 = { x: 20, y: 20 };       // Top vertex (90° corner)
  const p2 = { x: 20, y: h - 20 };    // Bottom-left vertex
  const p3 = { x: w - 20, y: h - 20 }; // Bottom-right vertex

  const legH = Math.max(10, (h - 40) / 37.8).toFixed(1);
  const legW = Math.max(10, (w - 40) / 37.8).toFixed(1);

  const pivotRef = useRef<HTMLDivElement>(null);

  // Quick Action: Commit 90° right angle lines to whiteboard
  const handleCommitRightAngle = () => {
    if (!editor) return;

    const rotRad = (rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    const relP2X = p2.x - w / 2;
    const relP2Y = p2.y - h / 2;
    const worldP2X = shape.x + w / 2 + (relP2X * cosR - relP2Y * sinR);
    const worldP2Y = shape.y + h / 2 + (relP2X * sinR + relP2Y * cosR);

    const relP1X = p1.x - w / 2;
    const relP1Y = p1.y - h / 2;
    const worldP1X = shape.x + w / 2 + (relP1X * cosR - relP1Y * sinR);
    const worldP1Y = shape.y + h / 2 + (relP1X * sinR + relP1Y * cosR);

    const relP3X = p3.x - w / 2;
    const relP3Y = p3.y - h / 2;
    const worldP3X = shape.x + w / 2 + (relP3X * cosR - relP3Y * sinR);
    const worldP3Y = shape.y + h / 2 + (relP3X * sinR + relP3Y * cosR);

    const vertId = createShapeId(`set-vert-${Date.now()}`);
    const horizId = createShapeId(`set-horiz-${Date.now()}`);
    const tldrawColor = activeColorKey in SETSQUARE_COLORS ? activeColorKey : "blue";

    editor.createShapes([
      {
        id: vertId,
        type: "arrow",
        x: worldP2X,
        y: worldP2Y,
        props: {
          start: { x: 0, y: 0 },
          end: { x: worldP1X - worldP2X, y: worldP1Y - worldP2Y },
          color: tldrawColor as any,
          size: "m",
        },
      },
      {
        id: horizId,
        type: "arrow",
        x: worldP2X,
        y: worldP2Y,
        props: {
          start: { x: 0, y: 0 },
          end: { x: worldP3X - worldP2X, y: worldP3Y - worldP2Y },
          color: tldrawColor as any,
          size: "m",
        },
      },
    ]);
  };

  const handleSelectColor = (colorKey: string) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "setsquare",
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
        type: "setsquare",
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
            type: "setsquare",
            x: startXPos + deltaX,
            y: startYPos + deltaY,
          },
        ]);
      } else if (mode === "rotate") {
        const currentMouseRad = Math.atan2(moveEv.clientY - centerScreenY, moveEv.clientX - centerScreenX);
        const totalDiffRad = currentMouseRad - startMouseRad;
        let newRotDeg = ((startRotationRad + totalDiffRad) * (180 / Math.PI) + 360) % 360;

        if (moveEv.shiftKey) {
          newRotDeg = Math.round(newRotDeg / 15) * 15;
        } else {
          newRotDeg = Math.round(newRotDeg);
        }

        editor.updateShapes([
          {
            id: shape.id,
            type: "setsquare",
            props: { ...shape.props, rotation: newRotDeg },
          },
        ]);
      } else if (mode === "scale") {
        const newW = Math.max(180, Math.min(600, startW + deltaX));
        const newH = newW;
        editor.updateShapes([
          {
            id: shape.id,
            type: "setsquare",
            props: { ...shape.props, w: newW, h: newH },
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

  // Scale Ticks for Vertical & Horizontal Legs
  const renderScaleTicks = () => {
    const ticks = [];

    // Vertical Leg Ticks (along x = 20)
    const vertLength = h - 40;
    const totalVertMm = Math.floor(vertLength / 3.78);
    for (let mm = 0; mm <= totalVertMm; mm++) {
      const y = h - 20 - mm * 3.78;
      if (y < 20) break;
      const isCm = mm % 10 === 0;
      const isHalfCm = mm % 5 === 0 && !isCm;
      const tickLen = isCm ? 14 : isHalfCm ? 9 : 5;

      ticks.push(
        <line
          key={`vmm-${mm}`}
          x1={20}
          y1={y}
          x2={20 + tickLen}
          y2={y}
          stroke="#1e293b"
          strokeWidth={isCm ? 1.5 : 1}
        />
      );

      if (isCm && mm > 0) {
        ticks.push(
          <text
            key={`vcm-lbl-${mm}`}
            x={42}
            y={y + 3}
            fontSize="9"
            fontWeight="bold"
            fill="#0f172a"
            textAnchor="start"
          >
            {mm / 10}
          </text>
        );
      }
    }

    // Horizontal Leg Ticks (along y = h - 20)
    const horizLength = w - 40;
    const totalHorizMm = Math.floor(horizLength / 3.78);
    for (let mm = 0; mm <= totalHorizMm; mm++) {
      const x = 20 + mm * 3.78;
      if (x > w - 20) break;
      const isCm = mm % 10 === 0;
      const isHalfCm = mm % 5 === 0 && !isCm;
      const tickLen = isCm ? 14 : isHalfCm ? 9 : 5;

      ticks.push(
        <line
          key={`hmm-${mm}`}
          x1={x}
          y1={h - 20}
          x2={x}
          y2={h - 20 - tickLen}
          stroke="#1e293b"
          strokeWidth={isCm ? 1.5 : 1}
        />
      );

      if (isCm && mm > 0) {
        ticks.push(
          <text
            key={`hcm-lbl-${mm}`}
            x={x}
            y={h - 38}
            fontSize="9"
            fontWeight="bold"
            fill="#0f172a"
            textAnchor="middle"
          >
            {mm / 10}
          </text>
        );
      }
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
          className="absolute -top-10 left-2 z-50 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-pointer active:scale-95 transition-transform"
          title="Delete Set Square"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Move Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "move")}
          className="absolute -top-10 left-11 z-50 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-move active:scale-95 transition-transform"
          title="Drag to Position Set Square"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>

        {/* Rotate Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "rotate")}
          className="absolute -top-10 left-20 z-50 w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-grab active:cursor-grabbing active:scale-95 transition-transform"
          title="Rotate Set Square"
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
          className="absolute -top-10 left-29 z-50 w-7 h-7 rounded-full border border-white/30 shadow-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          style={{ backgroundColor: colorConfig.fillHex }}
          title="Change Set Square Line Color"
        />

        {/* Commit Right-Angle Lines Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCommitRightAngle();
          }}
          className={`absolute -top-10 right-10 z-50 flex items-center gap-1 ${colorConfig.bg} text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer`}
          title="Draw 90° Right Angle Lines on Whiteboard"
        >
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
          <span>Draw 90° Corner</span>
        </button>

        {/* Scale Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "scale")}
          className="absolute -top-10 right-1 z-50 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-nwse-resize active:scale-95 transition-transform"
          title="Resize Set Square"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>

        {/* Color Palette Popup */}
        {showColorPicker && (
          <div
            className="absolute -top-20 left-10 z-50 flex items-center gap-1.5 bg-zinc-900/95 border border-white/20 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] font-bold text-zinc-400 mr-1 select-none">Color:</span>
            {Object.entries(SETSQUARE_COLORS).map(([key, cfg]) => (
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

        {/* ── Set Square SVG Graphic Body ── */}
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="overflow-visible select-none"
        >
          <defs>
            <linearGradient id="setSquareGlassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* Outer Triangular Acrylic Glass Body */}
          <polygon
            points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
            fill="url(#setSquareGlassGrad)"
            stroke="#94a3b8"
            strokeWidth="2.5"
          />

          {/* Inner Triangular Window Cutout */}
          <polygon
            points={`${p1.x + 40},${p1.y + 60} ${p2.x + 40},${p2.y - 40} ${p3.x - 70},${p3.y - 40}`}
            fill="#ffffff"
            fillOpacity="0.6"
            stroke="#cbd5e1"
            strokeWidth="1.5"
          />

          {/* Colored Right-Angle Perpendicular Edge Highlight */}
          <line
            x1={p2.x}
            y1={p2.y}
            x2={p1.x}
            y2={p1.y}
            stroke={colorConfig.hex}
            strokeWidth="3.5"
          />
          <line
            x1={p2.x}
            y1={p2.y}
            x2={p3.x}
            y2={p3.y}
            stroke={colorConfig.hex}
            strokeWidth="3.5"
          />

          {/* Right Angle 90° Square Box Indicator at p2 */}
          <rect
            x={p2.x}
            y={p2.y - 14}
            width="14"
            height="14"
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.5"
          />

          {/* Scale Markings */}
          {renderScaleTicks()}
        </svg>

        {/* 90° Badge HUD */}
        <div className="absolute bottom-6 left-8 text-[10px] font-mono font-extrabold text-red-500 pointer-events-none select-none">
          90°
        </div>
      </div>
    </HTMLContainer>
  );
};

// ── Shape Util Class ──────────────────────────────────────────────────────────
export class SetSquareShapeUtil extends ShapeUtil<SetSquareShape> {
  static override type = "setsquare" as const;

  override getDefaultProps(): SetSquareShape["props"] {
    return { w: 240, h: 240, rotation: 0, color: "blue" };
  }

  override canEdit = () => false;
  override isAspectRatioLocked = () => true;
  override canResize = () => true;
  override canBind = () => false;

  override getGeometry(shape: SetSquareShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override onResize(
    shape: SetSquareShape,
    info: TLResizeInfo<SetSquareShape>
  ): Omit<TLShapePartial<SetSquareShape>, "id" | "type"> | void {
    const { initialShape, scaleX } = info;
    const newW = Math.max(180, Math.min(600, Math.abs(initialShape.props.w * scaleX)));
    const newH = newW;
    return {
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: { ...shape.props, w: newW, h: newH },
    };
  }

  override getIndicatorPath(shape: SetSquareShape): TLIndicatorPath | undefined {
    const { w, h } = shape.props;
    const path = new Path2D();
    path.rect(0, 0, w, h);
    return path;
  }

  override component(shape: SetSquareShape) {
    return <SetSquareComponent shape={shape} editor={this.editor} />;
  }

  override indicator(_shape: SetSquareShape) {
    return null;
  }
}
