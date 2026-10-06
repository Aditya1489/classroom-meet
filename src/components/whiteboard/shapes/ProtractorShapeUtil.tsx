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

// ── Module augmentation: register 'protractor' in tldraw's global shape type map
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    protractor: { w: number; h: number; angle: number; rotation: number; color?: string };
  }
}

export type ProtractorShape = TLBaseShape<
  "protractor",
  { w: number; h: number; angle: number; rotation: number; color?: string }
>;

// Available Protractor Line Colors
const PROTRACTOR_COLORS: Record<
  string,
  { hex: string; bg: string; border: string; name: string; fillHex: string }
> = {
  green: { hex: "#16a34a", bg: "bg-emerald-600", border: "border-emerald-400", name: "Green", fillHex: "#22c55e" },
  blue: { hex: "#2563eb", bg: "bg-blue-600", border: "border-blue-400", name: "Blue", fillHex: "#3b82f6" },
  red: { hex: "#dc2626", bg: "bg-red-600", border: "border-red-400", name: "Red", fillHex: "#ef4444" },
  orange: { hex: "#ea580c", bg: "bg-orange-600", border: "border-orange-400", name: "Orange", fillHex: "#f97316" },
  purple: { hex: "#9333ea", bg: "bg-purple-600", border: "border-purple-400", name: "Purple", fillHex: "#a855f7" },
  black: { hex: "#0f172a", bg: "bg-slate-800", border: "border-slate-500", name: "Black", fillHex: "#334155" },
};

// ── Protractor Renderer Component ─────────────────────────────────────────────
const ProtractorComponent = ({
  shape,
  editor,
}: {
  shape: ProtractorShape;
  editor: any;
}) => {
  const { w = 360, h = 220, angle = 70, rotation = 0 } = shape.props;
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Resolve active color from shape props OR active Tldraw toolbar color
  const activeColorKey =
    shape.props.color ||
    (editor ? editor.getSharedStyles().getAsKnownValue(DefaultColorStyle) : "green");

  const colorConfig = PROTRACTOR_COLORS[activeColorKey] || PROTRACTOR_COLORS["green"];

  const radius = w / 2 - 20;
  const centerX = w / 2;
  const centerY = h - 25;

  const pivotRef = useRef<HTMLDivElement>(null);

  // Calculate coordinates of measuring ray tip
  const rayRad = (angle * Math.PI) / 180;
  const rayTipX = centerX - radius * Math.cos(rayRad);
  const rayTipY = centerY - radius * Math.sin(rayRad);

  // Sector fill arc path
  const sectorPath = `M ${centerX} ${centerY} L ${centerX - radius * 0.4} ${centerY} A ${radius * 0.4} ${radius * 0.4} 0 0 1 ${centerX - radius * 0.4 * Math.cos(rayRad)} ${centerY - radius * 0.4 * Math.sin(rayRad)} Z`;

  // Quick Action: Commit angle lines to whiteboard
  const handleCommitAngle = () => {
    if (!editor) return;

    const rotRad = (rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    const relCenterX = centerX - w / 2;
    const relCenterY = centerY - h / 2;
    const worldCenterX = shape.x + w / 2 + (relCenterX * cosR - relCenterY * sinR);
    const worldCenterY = shape.y + h / 2 + (relCenterX * sinR + relCenterY * cosR);

    // Create baseline arrow & ray arrow in chosen color
    const baseLineId = createShapeId(`line-base-${Date.now()}`);
    const rayLineId = createShapeId(`line-ray-${Date.now()}`);

    const tldrawColor = activeColorKey in PROTRACTOR_COLORS ? activeColorKey : "green";

    editor.createShapes([
      {
        id: baseLineId,
        type: "arrow",
        x: worldCenterX,
        y: worldCenterY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: radius, y: 0 },
          color: tldrawColor as any,
          size: "m",
        },
      },
      {
        id: rayLineId,
        type: "arrow",
        x: worldCenterX,
        y: worldCenterY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: -radius * Math.cos(rayRad), y: -radius * Math.sin(rayRad) },
          color: tldrawColor as any,
          size: "m",
        },
      },
    ]);
  };

  // Select color & close picker
  const handleSelectColor = (colorKey: string) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "protractor",
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
        type: "protractor",
        props: { ...shape.props, rotation: targetDeg },
      },
    ]);
  };

  // ── Global Window Pointer Drag Handler (With True 1:1 Angle Tracking) ─────────
  const handlePointerDown = (
    e: React.PointerEvent,
    mode: "ray" | "rotate" | "move" | "scale"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    isDraggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = Date.now();
    let hasMoved = false;

    const startRotation = rotation;
    const startW = w;
    const startXPos = shape.x;
    const startYPos = shape.y;

    const pivotRect = pivotRef.current?.getBoundingClientRect();
    const centerScreenX = pivotRect ? pivotRect.left + pivotRect.width / 2 : startX;
    const centerScreenY = pivotRect ? pivotRect.top + pivotRect.height / 2 : startY;

    // Initial mouse angle relative to center pivot
    const startMouseRad = Math.atan2(startY - centerScreenY, startX - centerScreenX);
    const startRotationRad = (startRotation * Math.PI) / 180;

    const onPointerMove = (moveEv: PointerEvent) => {
      moveEv.stopPropagation();
      moveEv.preventDefault();

      const moveDx = moveEv.clientX - startX;
      const moveDy = moveEv.clientY - startY;

      if (Math.hypot(moveDx, moveDy) > 4) {
        hasMoved = true;
      }

      if (mode === "ray") {
        const mouseDx = moveEv.clientX - centerScreenX;
        const mouseDy = centerScreenY - moveEv.clientY;

        let deg = Math.atan2(mouseDy, -mouseDx) * (180 / Math.PI);
        if (deg < 0) deg += 360;
        deg = Math.max(0, Math.min(180, Math.round(deg * 10) / 10));

        editor.updateShapes([
          {
            id: shape.id,
            type: "protractor",
            props: { ...shape.props, angle: deg },
          },
        ]);
      } else if (mode === "rotate") {
        // True 1:1 angular cursor tracking around center pivot
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
            type: "protractor",
            props: { ...shape.props, rotation: newRotation },
          },
        ]);
      } else if (mode === "move") {
        editor.updateShapes([
          {
            id: shape.id,
            type: "protractor",
            x: startXPos + moveDx,
            y: startYPos + moveDy,
          },
        ]);
      } else if (mode === "scale") {
        const newW = Math.max(260, Math.min(600, startW + moveDx));
        const newH = newW * 0.58;
        editor.updateShapes([
          {
            id: shape.id,
            type: "protractor",
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

      // Single Click / Tap on Ray Dot ➔ Open Color Palette
      if (mode === "ray" && !hasMoved && Date.now() - startTime < 280) {
        setShowColorPicker((prev) => !prev);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Generate ticks for 180° scale
  const renderTicks = () => {
    const ticks = [];
    for (let deg = 0; deg <= 180; deg++) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 10 === 0;
      const isMedium = deg % 5 === 0 && !isMajor;
      const tickLen = isMajor ? 14 : isMedium ? 9 : 5;

      const outerX = centerX - radius * Math.cos(rad);
      const outerY = centerY - radius * Math.sin(rad);
      const innerX = centerX - (radius - tickLen) * Math.cos(rad);
      const innerY = centerY - (radius - tickLen) * Math.sin(rad);

      ticks.push(
        <line
          key={`t-${deg}`}
          x1={outerX}
          y1={outerY}
          x2={innerX}
          y2={innerY}
          stroke="#475569"
          strokeWidth={isMajor ? 1.5 : 1}
        />
      );

      if (isMajor) {
        const textDistOuter = radius - 24;
        const textDistInner = radius - 38;

        const labelOuterX = centerX - textDistOuter * Math.cos(rad);
        const labelOuterY = centerY - textDistOuter * Math.sin(rad);

        const labelInnerX = centerX - textDistInner * Math.cos(rad);
        const labelInnerY = centerY - textDistInner * Math.sin(rad);

        ticks.push(
          <text
            key={`txt-out-${deg}`}
            x={labelOuterX}
            y={labelOuterY + 4}
            fontSize="9"
            fontWeight="bold"
            fill="#1e293b"
            textAnchor="middle"
          >
            {deg}
          </text>
        );

        ticks.push(
          <text
            key={`txt-in-${deg}`}
            x={labelInnerX}
            y={labelInnerY + 3}
            fontSize="8"
            fill="#64748b"
            textAnchor="middle"
          >
            {180 - deg}
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
          transformOrigin: `${centerX}px ${centerY}px`,
          transition: isDraggingRef.current ? "none" : "transform 0.05s ease-out",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Pivot Ref Anchor Element */}
        <div
          ref={pivotRef}
          className="absolute w-1 h-1 pointer-events-none"
          style={{ left: centerX, top: centerY }}
        />
        {/* ── Protractor Controls (Move, Delete, Rotate, Scale) ───────────── */}
        {/* Delete Handle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            editor?.deleteShapes([shape.id]);
          }}
          className="absolute z-50 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-pointer active:scale-95 transition-transform"
          style={{ left: centerX - 14, top: centerY - 60 }}
          title="Delete Protractor"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Move Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "move")}
          className="absolute z-50 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-move active:scale-95 transition-transform"
          style={{ left: centerX - 16, top: centerY - 16 }}
          title="Drag to Position Protractor"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>

        {/* Rotate Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "rotate")}
          className="absolute z-50 w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-grab active:cursor-grabbing active:scale-95 transition-transform"
          style={{ left: 10, top: centerY + 10 }}
          title="Rotate Protractor Body"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>

        {/* Scale Handle */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "scale")}
          className="absolute z-50 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg border border-white/20 cursor-nwse-resize active:scale-95 transition-transform"
          style={{ left: w - 30, top: centerY + 10 }}
          title="Resize Protractor"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>

        {/* ── Ray Dot Handle ── */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "ray")}
          className="absolute z-50 w-8 h-8 rounded-full text-white flex items-center justify-center shadow-xl border-2 border-white cursor-pointer active:scale-110 transition-transform"
          style={{
            left: rayTipX - 16,
            top: rayTipY - 16,
            backgroundColor: colorConfig.fillHex,
          }}
          title="Click once for Color Menu, or Hold & Drag to measure angle"
        />

        {/* ── Color Palette Popup ── */}
        {showColorPicker && (
          <div
            className="absolute z-50 flex items-center gap-1.5 bg-zinc-900/95 border border-white/20 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            style={{
              left: rayTipX - 110,
              top: rayTipY - 50,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] font-bold text-zinc-400 mr-1 select-none">Color:</span>
            {Object.entries(PROTRACTOR_COLORS).map(([key, cfg]) => (
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

        {/* ── SVG Protractor Body & Scale Marks ── */}
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="overflow-visible select-none"
        >
          <defs>
            <linearGradient id="glassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.75" />
            </linearGradient>
          </defs>

          {/* Semi-circular Glass Body */}
          <path
            d={`M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 0 1 ${centerX + radius} ${centerY} Z`}
            fill="url(#glassGrad)"
            stroke="#94a3b8"
            strokeWidth="2"
          />

          {/* Inner Semi-circle Cutout Window */}
          <path
            d={`M ${centerX - radius * 0.45} ${centerY} A ${radius * 0.45} ${radius * 0.45} 0 0 1 ${centerX + radius * 0.45} ${centerY} Z`}
            fill="#ffffff"
            fillOpacity="0.6"
            stroke="#cbd5e1"
            strokeWidth="1.5"
          />

          {/* Colored Shaded Sector Arc */}
          <path d={sectorPath} fill={colorConfig.fillHex} fillOpacity="0.22" />

          {/* Scale Ticks & Numbers */}
          {renderTicks()}

          {/* Dotted Red Baseline (0° line) */}
          <line
            x1={centerX - radius}
            y1={centerY}
            x2={centerX + radius}
            y2={centerY}
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="4 3"
          />

          {/* Center Origin Crosshair */}
          <line x1={centerX - 10} y1={centerY} x2={centerX + 10} y2={centerY} stroke="#1e293b" strokeWidth="1.5" />
          <line x1={centerX} y1={centerY - 10} x2={centerX} y2={centerY + 5} stroke="#1e293b" strokeWidth="1.5" />
          <circle cx={centerX} cy={centerY} r="3" fill="#1e293b" />

          {/* Colored Interactive Measuring Ray Line */}
          <line
            x1={centerX}
            y1={centerY}
            x2={rayTipX}
            y2={rayTipY}
            stroke={colorConfig.hex}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>

        {/* ── Angle Readout & Commit Button Badge ── */}
        <div
          className="absolute z-50 flex items-center gap-1.5 bg-zinc-900/90 border border-white/15 px-3 py-1 rounded-full shadow-xl backdrop-blur-md"
          style={{
            left: centerX + (radius * 0.28) * Math.cos(rayRad * 0.5) - 35,
            top: centerY - (radius * 0.28) * Math.sin(rayRad * 0.5) - 15,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className={`flex items-center gap-1 ${colorConfig.bg} text-white px-2.5 py-0.5 rounded-full text-[12px] font-extrabold font-mono tracking-tight shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer`}
            onClick={(e) => {
              e.stopPropagation();
              handleCommitAngle();
            }}
            title="Commit Angle to Whiteboard"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
            <span>{angle}°</span>
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
};

// ── Shape Util Class ──────────────────────────────────────────────────────────
export class ProtractorShapeUtil extends ShapeUtil<ProtractorShape> {
  static override type = "protractor" as const;

  override getDefaultProps(): ProtractorShape["props"] {
    return { w: 360, h: 220, angle: 70, rotation: 0, color: "green" };
  }

  override canEdit = () => false;
  override isAspectRatioLocked = () => false;
  override canResize = () => true;
  override canBind = () => false;

  override getGeometry(shape: ProtractorShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override onResize(
    shape: ProtractorShape,
    info: TLResizeInfo<ProtractorShape>
  ): Omit<TLShapePartial<ProtractorShape>, "id" | "type"> | void {
    const { initialShape, scaleX } = info;
    const newW = Math.max(260, Math.min(600, Math.abs(initialShape.props.w * scaleX)));
    const newH = newW * 0.58;
    return {
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: { ...shape.props, w: newW, h: newH },
    };
  }

  override getIndicatorPath(shape: ProtractorShape): TLIndicatorPath | undefined {
    const { w, h } = shape.props;
    const path = new Path2D();
    path.rect(0, 0, w, h);
    return path;
  }

  override component(shape: ProtractorShape) {
    return <ProtractorComponent shape={shape} editor={this.editor} />;
  }

  override indicator(_shape: ProtractorShape) {
    return null;
  }
}
