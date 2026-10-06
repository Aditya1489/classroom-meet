import React, { useState, useRef, useMemo } from "react";
import { Tldraw, Editor, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { CompassShapeUtil } from "./shapes/CompassShapeUtil";
import { ProtractorShapeUtil } from "./shapes/ProtractorShapeUtil";
import { RulerShapeUtil } from "./shapes/RulerShapeUtil";
import { SetSquareShapeUtil } from "./shapes/SetSquareShapeUtil";
import {
  Ruler,
  Compass,
  X,
  Maximize2,
  Minimize2,
  Trash2,
  Sparkles,
  Triangle,
  CircleDot
} from "lucide-react";
import { toast } from "sonner";

const customShapeUtils = [
  CompassShapeUtil,
  ProtractorShapeUtil,
  RulerShapeUtil,
  SetSquareShapeUtil,
];

interface WhiteboardProps {
  onClose: () => void;
  isHost?: boolean;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ onClose, isHost = false }) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleMount = (ed: Editor) => {
    setEditor(ed);
    ed.zoomToFit();
  };

  const insertRuler = () => {
    if (!editor) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "ruler",
      x: pagePoint.x - 200,
      y: pagePoint.y - 35,
      props: { w: 420, h: 70, rotation: 0, color: "blue" },
    });
    toast.success("Geometry Ruler inserted on canvas");
  };

  const insertCompass = () => {
    if (!editor) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "compass",
      x: pagePoint.x - 100,
      y: pagePoint.y - 120,
      props: { w: 200, h: 240, angle: 45, rotation: 0, color: "blue" },
    });
    toast.success("Geometry Compass inserted on canvas");
  };

  const insertProtractor = () => {
    if (!editor) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "protractor",
      x: pagePoint.x - 150,
      y: pagePoint.y - 80,
      props: { w: 300, h: 160, rotation: 0, color: "blue" },
    });
    toast.success("180° Protractor inserted on canvas");
  };

  const insertSetSquare = () => {
    if (!editor) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "setsquare",
      x: pagePoint.x - 120,
      y: pagePoint.y - 120,
      props: { w: 240, h: 240, rotation: 0, color: "blue" },
    });
    toast.success("Set Square triangle inserted on canvas");
  };

  const clearCanvas = () => {
    if (!editor) return;
    const shapes = Array.from(editor.getCurrentPageShapeIds());
    if (shapes.length === 0) return;
    editor.deleteShapes(shapes);
    toast.info("Whiteboard canvas cleared");
  };

  return (
    <div
      className={`relative flex flex-col bg-[#1a1814] rounded-2xl border border-[#f3eee6]/10 shadow-2xl overflow-hidden transition-all duration-300 ${
        isExpanded ? "fixed inset-3 z-50" : "w-full h-full"
      }`}
    >
      {/* Top Header / Geometry Tool Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#16130f] border-b border-[#f3eee6]/[0.08] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">Mathsy Geometry Canvas</span>
          </div>
          <span className="hidden sm:inline text-xs text-[#a39e94]">
            Ruler, Compass & Protractor Instruments
          </span>
        </div>

        {/* Geometry Quick Tools */}
        <div className="flex items-center gap-1 bg-[#1a1814] p-1 rounded-xl border border-[#f3eee6]/10">
          <button
            onClick={insertRuler}
            title="Insert Geometry Ruler"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#f3eee6] hover:bg-[#221f1a] rounded-lg transition"
          >
            <Ruler className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span className="hidden md:inline font-mono text-[11px]">Ruler</span>
          </button>

          <button
            onClick={insertCompass}
            title="Insert Compass (Circle Drawer)"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#f3eee6] hover:bg-[#221f1a] rounded-lg transition"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline font-mono text-[11px]">Compass</span>
          </button>

          <button
            onClick={insertProtractor}
            title="Insert Protractor"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#f3eee6] hover:bg-[#221f1a] rounded-lg transition"
          >
            <CircleDot className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span className="hidden md:inline font-mono text-[11px]">Protractor</span>
          </button>

          <button
            onClick={insertSetSquare}
            title="Insert Set Square"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#f3eee6] hover:bg-[#221f1a] rounded-lg transition"
          >
            <Triangle className="w-3.5 h-3.5 text-amber-300" />
            <span className="hidden md:inline font-mono text-[11px]">Set Square</span>
          </button>

          <div className="h-4 w-px bg-[#f3eee6]/10 mx-1" />

          <button
            onClick={clearCanvas}
            title="Clear Canvas"
            className="p-1.5 text-[#a39e94] hover:text-red-400 hover:bg-[#221f1a] rounded-lg transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Maximize"}
            className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] hover:bg-white/5 rounded-lg transition"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            title="Close Whiteboard"
            className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] hover:bg-white/5 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TLDraw Interactive Surface */}
      <div className="flex-1 w-full h-full relative bg-[#0e0d0b]">
        <Tldraw
          shapeUtils={customShapeUtils}
          onMount={handleMount}
          autoFocus={false}
        />
      </div>
    </div>
  );
};
