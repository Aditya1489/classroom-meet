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

// ── Module augmentation: register 'compass' in tldraw's global shape type map ─
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    compass: { w: number; h: number; angle: number; rotation: number; color?: string };
  }
}

export type CompassShape = TLBaseShape<
  "compass",
  { w: number; h: number; angle: number; rotation: number; color?: string }
>;

// Available Compass Lead & Circle Colors
const COMPASS_COLORS: Record<
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

// ── Compass Renderer Component ────────────────────────────────────────────────
const CompassComponent = ({
  shape,
  editor,
}: {
  shape: CompassShape;
  editor: any;
}) => {
  const { w = 260, h = 280, angle = 28, rotation = 0 } = shape.props;
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeArc, setActiveArc] = useState<{
    points: { x: number; y: number }[];
  } | null>(null);

  // Resolve active color from shape props OR active Tldraw toolbar color
  const activeColorKey =
    shape.props.color ||
    (editor ? editor.getSharedStyles().getAsKnownValue(DefaultColorStyle) : "green");

  const colorConfig = COMPASS_COLORS[activeColorKey] || COMPASS_COLORS["green"];

  const rad = (angle * Math.PI) / 180;
  const pivotX = w / 2;
  const pivotY = 50;
  const armLen = Math.max(120, h * 0.72);

  // Position of Needle tip (left leg) in unrotated container
  const needleX = pivotX - armLen * Math.sin(rad);
  const needleY = pivotY + armLen * Math.cos(rad);

  // Position of Pencil tip (right leg) in unrotated container
  const pencilX = pivotX + armLen * Math.sin(rad);
  const pencilY = pivotY + armLen * Math.cos(rad);

  // Radius of current circle in px and cm (~37.8px = 1cm)
  const radiusPx = Math.abs(pencilX - needleX);
  const radiusCm = (radiusPx / 37.8).toFixed(1);

  // World coordinates of Needle Tip Anchor
  const needleWorldX = shape.x + needleX;
  const needleWorldY = shape.y + needleY;

  const handleSelectColor = (colorKey: string) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "compass",
        props: { ...shape.props, color: colorKey },
      },
    ]);
    setShowColorPicker(false);
  };

  // Quick Action 1: Commit Full Circle to Whiteboard
  const handleCommitCircle = () => {
    if (!editor) return;
    const tldrawColor = activeColorKey in COMPASS_COLORS ? activeColorKey : "green";
    const circleId = createShapeId(`circle-btn-${Date.now()}`);

    editor.createShapes([
      {
        id: circleId,
        type: "geo",
        x: needleWorldX - radiusPx,
        y: needleWorldY - radiusPx,
        props: {
          geo: "ellipse",
          w: radiusPx * 2,
          h: radiusPx * 2,
          color: tldrawColor as any,
          dash: "draw",
          fill: "none",
          size: "m",
        },
      },
    ]);
  };

  // Quick Action 2: Commit Arc (e.g. 90°) starting from current rotation
  const handleCommitArc = (sweepDeg: number = 90) => {
    if (!editor) return;
    const tldrawColor = activeColorKey in COMPASS_COLORS ? activeColorKey : "green";
    const startRotRad = (rotation * Math.PI) / 180;
    const sweepRad = (sweepDeg * Math.PI) / 180;
    const numSteps = 32;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= numSteps; i++) {
      const currRad = startRotRad + (sweepRad * i) / numSteps;
      points.push({
        x: needleWorldX + radiusPx * Math.cos(currRad),
        y: needleWorldY + radiusPx * Math.sin(currRad),
      });
    }

    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const relativeSegments = points.map((p) => ({
      x: Number((p.x - minX).toFixed(1)),
      y: Number((p.y - minY).toFixed(1)),
    }));

    const pathStr =
      `M ${relativeSegments[0].x} ${relativeSegments[0].y} ` +
      relativeSegments.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");

    const arcId = createShapeId(`arc-btn-${Date.now()}`);
    editor.createShapes([
      {
        id: arcId,
        type: "draw",
        x: minX,
        y: minY,
        props: {
          color: tldrawColor as any,
          dash: "draw",
          size: "m",
          segments: [
            {
              type: "free",
              path: pathStr,
              points: relativeSegments.map((p) => ({ x: p.x, y: p.y, z: 0.5 })),
            },
          ],
        },
      },
    ]);
  };

  // Preset Snap Angle Handler
  const handleSnapAngle = (targetDeg: number) => {
    if (!editor) return;
    editor.updateShapes([
      {
        id: shape.id,
        type: "compass",
        props: { ...shape.props, rotation: targetDeg },
      },
    ]);
  };

  // ── Global Pointer Drag Handler ─────────────────────────────────────────────
  const handlePointerDown = (
    e: React.PointerEvent,
    mode: "draw-spin" | "orient" | "radius" | "move"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    isDraggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = Date.now();
    let hasMoved = false;

    const startAngle = angle;
    const startRotation = rotation;
    const startXPos = shape.x;
    const startYPos = shape.y;

    // Get exact needle anchor screen coordinates
    const needleRect = needleRef.current?.getBoundingClientRect();
    const needleScreenX = needleRect ? needleRect.left + needleRect.width / 2 : startX;
    const needleScreenY = needleRect ? needleRect.top + needleRect.height / 2 : startY;

    // Initial mouse angle relative to needle anchor
    const startMouseRad = Math.atan2(startY - needleScreenY, startX - needleScreenX);
    const startRotationRad = (startRotation * Math.PI) / 180;

    let arcPoints: { x: number; y: number }[] = [];
    let totalAngleSwept = 0;
    let lastMouseRad = startMouseRad;

    const onPointerMove = (moveEv: PointerEvent) => {
      moveEv.stopPropagation();
      moveEv.preventDefault();

      const moveDx = moveEv.clientX - startX;
      const moveDy = moveEv.clientY - startY;

      if (Math.hypot(moveDx, moveDy) > 4) {
        hasMoved = true;
      }

      if (mode === "draw-spin" || mode === "orient") {
        const currentMouseRad = Math.atan2(moveEv.clientY - needleScreenY, moveEv.clientX - needleScreenX);
        let diffRad = currentMouseRad - lastMouseRad;
        if (diffRad > Math.PI) diffRad -= 2 * Math.PI;
        if (diffRad < -Math.PI) diffRad += 2 * Math.PI;

        totalAngleSwept += Math.abs(diffRad);
        lastMouseRad = currentMouseRad;

        const totalDiffRad = currentMouseRad - startMouseRad;
        let newRotDeg = ((startRotationRad + totalDiffRad) * (180 / Math.PI) + 360) % 360;

        // Shift key 15° snap
        if (moveEv.shiftKey) {
          newRotDeg = Math.round(newRotDeg / 15) * 15;
        } else {
          newRotDeg = Math.round(newRotDeg);
        }

        if (mode === "draw-spin") {
          // Calculate pencil tip world position
          const currentRotRad = (newRotDeg * Math.PI) / 180;
          const pWorldX = needleWorldX + radiusPx * Math.cos(currentRotRad);
          const pWorldY = needleWorldY + radiusPx * Math.sin(currentRotRad);

          arcPoints.push({ x: pWorldX, y: pWorldY });
          setActiveArc({ points: [...arcPoints] });
        }

        editor.updateShapes([
          {
            id: shape.id,
            type: "compass",
            props: { ...shape.props, rotation: newRotDeg },
          },
        ]);
      } else if (mode === "radius") {
        const newAngle = Math.max(10, Math.min(65, Math.round(startAngle + moveDx * 0.3)));
        editor.updateShapes([
          {
            id: shape.id,
            type: "compass",
            props: { ...shape.props, angle: newAngle },
          },
        ]);
      } else if (mode === "move") {
        editor.updateShapes([
          {
            id: shape.id,
            type: "compass",
            x: startXPos + moveDx,
            y: startYPos + moveDy,
          },
        ]);
      }
    };

    const onPointerUp = (upEv: PointerEvent) => {
      upEv.stopPropagation();
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      // Single click on pencil tip opens color palette
      if (mode === "draw-spin" && !hasMoved && Date.now() - startTime < 280) {
        setShowColorPicker((prev) => !prev);
        setActiveArc(null);
        return;
      }

      if (mode === "draw-spin") {
        setActiveArc(null);
        if (editor) {
          const tldrawColor = activeColorKey in COMPASS_COLORS ? activeColorKey : "green";

          // If tutor swept > 300° (almost a full circle), commit a circle shape!
          if (totalAngleSwept >= (5 * Math.PI) / 3) {
            const circleId = createShapeId(`circle-drawn-${Date.now()}`);
            editor.createShapes([
              {
                id: circleId,
                type: "geo",
                x: needleWorldX - radiusPx,
                y: needleWorldY - radiusPx,
                props: {
                  geo: "ellipse",
                  w: radiusPx * 2,
                  h: radiusPx * 2,
                  color: tldrawColor as any,
                  dash: "draw",
                  fill: "none",
                  size: "m",
                },
              },
            ]);
          } else if (arcPoints.length > 2) {
            const drawId = createShapeId(`arc-${Date.now()}`);
            const minX = Math.min(...arcPoints.map((p) => p.x));
            const minY = Math.min(...arcPoints.map((p) => p.y));
            const relativeSegments = arcPoints.map((p) => ({
              x: Number((p.x - minX).toFixed(1)),
              y: Number((p.y - minY).toFixed(1)),
            }));

            const pathStr =
              `M ${relativeSegments[0].x} ${relativeSegments[0].y} ` +
              relativeSegments.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");

            editor.createShapes([
              {
                id: drawId,
                type: "draw",
                x: minX,
                y: minY,
                props: {
                  color: tldrawColor as any,
                  dash: "draw",
                  size: "m",
                  segments: [
                    {
                      type: "free",
                      path: pathStr,
                      points: relativeSegments.map((p) => ({ x: p.x, y: p.y, z: 0.5 })),
                    },
                  ],
                },
              },
            ]);
          }
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
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
          transformOrigin: `${needleX}px ${needleY}px`,
          transition: isDraggingRef.current ? "none" : "transform 0.05s ease-out",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Invisible Ref Anchor Element for Needle Point */}
        <div
          ref={needleRef}
          className="absolute w-1 h-1 pointer-events-none"
          style={{ left: needleX, top: needleY }}
        />

        {/* ── Top Hinge Controls Bar ───────────────────────────────────── */}
        <div
          className="absolute flex items-center gap-1.5 z-50 bg-zinc-900/90 border border-white/20 p-1 rounded-full shadow-2xl backdrop-blur-md"
          style={{ left: pivotX - 70, top: pivotY - 50 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Delete Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              editor?.deleteShapes([shape.id]);
            }}
            className="w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
            title="Delete Compass"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Move Position Handle */}
          <div
            onPointerDown={(e) => handlePointerDown(e, "move")}
            className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg cursor-move active:scale-95 transition-transform"
            title="Drag to Position Needle Anchor on Canvas"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </div>

          {/* Adjust Radius / Scale Handle */}
          <div
            onPointerDown={(e) => handlePointerDown(e, "radius")}
            className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg cursor-ew-resize active:scale-95 transition-transform"
            title="Drag to Adjust Radius / Opening"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7h8M8 17h8M7 12h10" />
            </svg>
          </div>

          {/* Orient (Rotate Without Drawing) Handle */}
          <div
            onPointerDown={(e) => handlePointerDown(e, "orient")}
            className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing active:scale-95 transition-transform"
            title="Rotate Compass Orientation (Hold Shift to snap 15°)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
        </div>

        {/* ── Top Hinge Knob (Spin & Draw Arc / Circle) ──────────────── */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "draw-spin")}
          className="absolute z-50 w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-white flex items-center justify-center shadow-2xl border-2 border-amber-200 cursor-grab active:cursor-grabbing active:scale-110 transition-all ring-2 ring-amber-500/50"
          style={{ left: pivotX - 18, top: pivotY - 18 }}
          title="Hold & Spin Top Knob to Draw Circle / Arc!"
        >
          <svg className="w-5 h-5 text-amber-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>

        {/* ── Interactive Dashed Circle Arc-Drawer Handle around Pencil Nib ── */}
        <div
          onPointerDown={(e) => handlePointerDown(e, "draw-spin")}
          className="absolute z-50 w-10 h-10 rounded-full border-2 border-dashed active:scale-110 transition-all flex items-center justify-center cursor-pointer shadow-lg"
          style={{
            left: pencilX - 20,
            top: pencilY + 2,
            borderColor: colorConfig.fillHex,
            backgroundColor: `${colorConfig.fillHex}25`,
          }}
          title="Click for Color Menu, or Hold & Spin Pencil Nib to Draw Arc!"
        />

        {/* ── Color Palette Popup (Opens above Pencil Tip on Single Click) ── */}
        {showColorPicker && (
          <div
            className="absolute z-50 flex items-center gap-1.5 bg-zinc-900/95 border border-white/20 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 select-none"
            style={{
              left: pencilX - 110,
              top: pencilY - 45,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] font-bold text-zinc-400 mr-1">Color:</span>
            {Object.entries(COMPASS_COLORS).map(([key, cfg]) => (
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

        {/* ── SVG Graphic Body of the Compass ───────────────────────────── */}
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="overflow-visible select-none"
        >
          <defs>
            <linearGradient id="metalLegGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="50%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
            <linearGradient id="pencilWoodGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>

          {/* Opening Radius Guideline (Dashed line from needle to pencil) */}
          <line
            x1={needleX}
            y1={needleY}
            x2={pencilX}
            y2={pencilY}
            stroke={colorConfig.hex}
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity="0.6"
          />

          {/* Left Leg (Metal Needle Leg) */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={needleX}
            y2={needleY}
            stroke="url(#metalLegGrad)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <line
            x1={pivotX}
            y1={pivotY}
            x2={needleX}
            y2={needleY}
            stroke="#475569"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Right Leg (Metal Pencil Leg) */}
          <line
            x1={pivotX}
            y1={pivotY}
            x2={pencilX}
            y2={pencilY}
            stroke="url(#metalLegGrad)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <line
            x1={pivotX}
            y1={pivotY}
            x2={pencilX}
            y2={pencilY}
            stroke="#475569"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Top Joint Hinge Disk */}
          <circle cx={pivotX} cy={pivotY} r="15" fill="#94a3b8" stroke="#334155" strokeWidth="2.5" />
          <circle cx={pivotX} cy={pivotY} r="8" fill="#e2e8f0" />

          {/* Sharp Metal Needle Tip (Left Anchor Pin) */}
          <polygon
            points={`${needleX - 3.5},${needleY - 6} ${needleX + 3.5},${needleY - 6} ${needleX},${needleY + 12}`}
            fill="#0f172a"
          />

          {/* Red Anchor Target Crosshair at Needle Tip */}
          <circle cx={needleX} cy={needleY} r="4" fill="#ef4444" fillOpacity="0.8" />
          <circle cx={needleX} cy={needleY} r="1.5" fill="#ffffff" />

          {/* Wood Pencil & Colored Lead Tip (Right) */}
          <g transform={`rotate(${angle}, ${pencilX}, ${pencilY})`}>
            {/* Pencil Shaft */}
            <rect
              x={pencilX - 5}
              y={pencilY - 2}
              width="10"
              height="22"
              rx="2"
              fill="url(#pencilWoodGrad)"
              stroke="#b45309"
              strokeWidth="1"
            />
            {/* Pencil Wood Tip */}
            <polygon
              points={`${pencilX - 5},${pencilY + 20} ${pencilX + 5},${pencilY + 20} ${pencilX},${pencilY + 30}`}
              fill="#fde68a"
              stroke="#d97706"
              strokeWidth="0.8"
            />
            {/* Colored Lead Tip */}
            <polygon
              points={`${pencilX - 2.5},${pencilY + 25} ${pencilX + 2.5},${pencilY + 25} ${pencilX},${pencilY + 30}`}
              fill={colorConfig.fillHex}
            />
          </g>

          {/* Live Arc Path Rendered While Tutor Drags Pencil / Top Knob */}
          {activeArc && activeArc.points.length > 1 && (
            <path
              d={`M ${activeArc.points[0].x - shape.x} ${activeArc.points[0].y - shape.y} ` +
                activeArc.points.map((p) => `L ${p.x - shape.x} ${p.y - shape.y}`).join(" ")}
              fill="none"
              stroke={colorConfig.fillHex}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* ── Dynamic Radius & One-Click Commit Action HUD ───────────── */}
        <div
          className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-zinc-900/95 border border-white/20 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md z-50 select-none"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-[11px] font-bold text-blue-400 font-mono">
            r = {radiusCm} cm
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            ({rotation}°)
          </span>

          <div className="h-3 w-px bg-white/20" />

          {/* One-Click Draw Full Circle */}
          <button
            onClick={handleCommitCircle}
            className={`flex items-center gap-1 ${colorConfig.bg} text-white px-2.5 py-0.5 rounded-full text-[11px] font-extrabold hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-md`}
            title="One-click commit a full circle to whiteboard"
          >
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
            <span>Draw Circle</span>
          </button>

          {/* One-Click Draw 90° Arc */}
          <button
            onClick={() => handleCommitArc(90)}
            className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 px-2 py-0.5 rounded-full text-[11px] font-bold active:scale-95 transition-all cursor-pointer"
            title="One-click commit a 90° arc starting from current angle"
          >
            <span>Draw 90° Arc</span>
          </button>

          <div className="h-3 w-px bg-white/20" />

          {/* Quick Preset Angles */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {[0, 45, 90, 180].map((deg) => (
              <button
                key={deg}
                onClick={() => handleSnapAngle(deg)}
                className={`px-1.5 py-0.5 rounded ${
                  rotation === deg
                    ? "bg-blue-600 text-white font-bold"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                }`}
                title={`Snap compass to ${deg}°`}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
};

// ── Shape Util Class ──────────────────────────────────────────────────────────
export class CompassShapeUtil extends ShapeUtil<CompassShape> {
  static override type = "compass" as const;

  override getDefaultProps(): CompassShape["props"] {
    return { w: 260, h: 280, angle: 28, rotation: 0, color: "green" };
  }

  override canEdit = () => false;
  override isAspectRatioLocked = () => false;
  override canResize = () => true;
  override canBind = () => false;

  override getGeometry(shape: CompassShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override onResize(
    shape: CompassShape,
    info: TLResizeInfo<CompassShape>
  ): Omit<TLShapePartial<CompassShape>, "id" | "type"> | void {
    const { initialShape, scaleX, scaleY } = info;
    const newW = Math.max(180, Math.abs(initialShape.props.w * scaleX));
    const newH = Math.max(200, Math.abs(initialShape.props.h * scaleY));
    return {
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: { ...shape.props, w: newW, h: newH },
    };
  }

  override getIndicatorPath(shape: CompassShape): TLIndicatorPath | undefined {
    const { w, h } = shape.props;
    const path = new Path2D();
    path.rect(0, 0, w, h);
    return path;
  }

  override component(shape: CompassShape) {
    return <CompassComponent shape={shape} editor={this.editor} />;
  }

  override indicator(_shape: CompassShape) {
    return null;
  }
}
