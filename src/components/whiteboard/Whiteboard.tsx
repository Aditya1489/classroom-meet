import React, { useState, useRef, useEffect } from "react";
import { Tldraw, Editor, createShapeId, getSnapshot, loadSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { CompassShapeUtil } from "./shapes/CompassShapeUtil";
import { ProtractorShapeUtil } from "./shapes/ProtractorShapeUtil";
import { RulerShapeUtil } from "./shapes/RulerShapeUtil";
import { SetSquareShapeUtil } from "./shapes/SetSquareShapeUtil";
import { MathsyMediasoupEngine } from "../../engine/mediasoupClient";
import { dbClient } from "../../lib/dbClient";
import {
  Ruler,
  Compass,
  X,
  Maximize2,
  Minimize2,
  Trash2,
  Sparkles,
  Triangle,
  CircleDot,
  Users,
  Lock,
  Unlock,
  Download,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  registerWhiteboardEditor,
  setLatestWhiteboardSnapshot,
  exportWhiteboardToPdf,
} from "../../utils/whiteboardPdf";

const customShapeUtils = [
  CompassShapeUtil,
  ProtractorShapeUtil,
  RulerShapeUtil,
  SetSquareShapeUtil,
];

interface WhiteboardProps {
  onClose: () => void;
  isHost?: boolean;
  roomCode?: string;
  engine?: MathsyMediasoupEngine | null;
  myUserId?: string;
  onBroadcast?: (data: any) => void;
  initialSnapshot?: any;
  letStudentsDraw?: boolean;
  onToggleStudentDrawing?: (allowed: boolean) => void;
  remoteSnapshot?: any;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({
  onClose,
  isHost = false,
  roomCode,
  engine,
  myUserId,
  onBroadcast,
  initialSnapshot,
  letStudentsDraw = false,
  onToggleStudentDrawing,
  remoteSnapshot,
}) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const snapshotTimerRef = useRef<NodeJS.Timeout | null>(null);
  const throttleTimerRef = useRef<any>(null);

  const canDraw = Boolean(isHost || letStudentsDraw);

  const handleMount = (ed: Editor) => {
    setEditor(ed);
    registerWhiteboardEditor(ed);

    if (initialSnapshot) {
      try {
        loadSnapshot(ed.store, initialSnapshot);
      } catch (err) {
        console.warn("[Whiteboard] Failed to load initial snapshot:", err);
      }
    }
    ed.zoomToFit();

    // Late Join / Fresh Mount: Load snapshot from PostgreSQL if available
    if (roomCode) {
      dbClient.getWhiteboardSnapshot(roomCode).then((snapshot) => {
        if (snapshot && ed) {
          try {
            ed.loadSnapshot(snapshot);
            console.log("[Whiteboard] Authoritative snapshot loaded for room:", roomCode);
          } catch (err) {
            console.warn("[Whiteboard] Error restoring snapshot:", err);
          }
        }
      });
    }

    // Listen to user modifications and throttle broadcast to peers
    const unlisten = ed.store.listen(
      (entry) => {
        if (entry.source === "user") {
          if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = setTimeout(() => {
            try {
              const snapshot = getSnapshot(ed.store);
              setLatestWhiteboardSnapshot(snapshot);
              onBroadcast?.({ snapshot });
            } catch (err) {
              console.warn("[Whiteboard] Failed to capture store snapshot:", err);
            }
          }, 60);
        }
      },
      { scope: "document", source: "user" }
    );

    return () => {
      unlisten();
      registerWhiteboardEditor(null);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  };

  // Sync incoming remote board updates
  useEffect(() => {
    if (editor && remoteSnapshot) {
      try {
        loadSnapshot(editor.store, remoteSnapshot);
      } catch (err) {
        console.warn("[Whiteboard] Failed applying remote snapshot:", err);
      }
    }
  }, [editor, remoteSnapshot]);

  // Keep editor instance readonly state synced
  useEffect(() => {
    if (editor) {
      editor.updateInstanceState({ isReadonly: !canDraw });
    }
  }, [editor, canDraw]);

  const handleExportPdf = async () => {
    if (!editor) return;
    try {
      setIsExporting(true);
      await exportWhiteboardToPdf(editor);
      toast.success("Whiteboard exported as PDF!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to export whiteboard PDF");
    } finally {
      setIsExporting(false);
    }
  };

  // Real-time synchronization of drawing, shapes, and erasures
  useEffect(() => {
    if (!editor) return;

    // 1. Listen for local user changes (document scope only)
    const unlisten = editor.store.listen(
      (entry) => {
        // Strictly filter to local user actions to prevent echo loops
        if (entry.source !== "user") return;

        const { added, updated, removed } = entry.changes;
        const hasChanges =
          Object.keys(added).length > 0 ||
          Object.keys(updated).length > 0 ||
          Object.keys(removed).length > 0;

        if (!hasChanges) return;

        // Transmit incremental diff to room participants
        if (engine && roomCode) {
          engine.broadcastWhiteboard({
            type: "diff",
            roomCode,
            senderId: myUserId || "local",
            changes: { added, updated, removed },
            timestamp: Date.now(),
          });
        }

        // Debounced snapshot persistence to PostgreSQL (Host authoritative)
        if (isHost && roomCode) {
          if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = setTimeout(async () => {
            try {
              const snapshot = editor.getSnapshot();
              await dbClient.saveWhiteboardSnapshot(roomCode, snapshot);
            } catch (err) {
              console.warn("[Whiteboard] Error saving snapshot:", err);
            }
          }, 2000);
        }
      },
      { source: "user", scope: "document" }
    );

    // 2. Process incoming remote drawing diffs from room peers
    const handleRemoteWhiteboardData = (data: any) => {
      if (!data || typeof data !== "object") return;

      // Ensure room isolation
      if (data.roomCode && roomCode && data.roomCode !== roomCode) return;

      // Ignore own echoed events
      if (data.senderId && myUserId && data.senderId === myUserId) return;

      if (data.type === "diff" && data.changes) {
        try {
          editor.store.mergeRemoteChanges(() => {
            editor.store.applyDiff(data.changes);
          });
        } catch (err) {
          console.warn("[Whiteboard] Error applying remote diff:", err);
        }
      } else if (data.type === "snapshot" && data.snapshot) {
        try {
          editor.loadSnapshot(data.snapshot);
        } catch (err) {
          console.warn("[Whiteboard] Error applying remote snapshot:", err);
        }
      }
    };

    if (engine) {
      engine.onWhiteboardData = handleRemoteWhiteboardData;
    }

    return () => {
      unlisten();
      if (engine && engine.onWhiteboardData === handleRemoteWhiteboardData) {
        engine.onWhiteboardData = undefined;
      }
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
      }
    };
  }, [editor, engine, roomCode, isHost, myUserId]);

  const insertRuler = () => {
    if (!editor || !canDraw) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "ruler",
      x: pagePoint.x - 200,
      y: pagePoint.y - 35,
      props: { w: 420, h: 70, rotation: 0, color: "blue" },
    });
  };

  const insertCompass = () => {
    if (!editor || !canDraw) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "compass",
      x: pagePoint.x - 100,
      y: pagePoint.y - 120,
      props: { w: 200, h: 240, angle: 45, rotation: 0, color: "blue" },
    });
  };

  const insertProtractor = () => {
    if (!editor || !canDraw) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "protractor",
      x: pagePoint.x - 150,
      y: pagePoint.y - 80,
      props: { w: 300, h: 160, rotation: 0, color: "blue" },
    });
  };

  const insertSetSquare = () => {
    if (!editor || !canDraw) return;
    const center = editor.getViewportScreenCenter();
    const pagePoint = editor.screenToPage(center);
    editor.createShape({
      id: createShapeId(),
      type: "setsquare",
      x: pagePoint.x - 120,
      y: pagePoint.y - 120,
      props: { w: 240, h: 240, rotation: 0, color: "blue" },
    });
  };

  const clearCanvas = () => {
    if (!editor || !canDraw) return;
    const shapes = Array.from(editor.getCurrentPageShapeIds());
    if (shapes.length === 0) return;
    editor.deleteShapes(shapes);
    toast.info("Whiteboard canvas cleared", { id: "clear-canvas" });
  };

  return (
    <div
      className={`relative flex flex-col bg-[#1a1814] rounded-2xl border border-[#f3eee6]/10 shadow-2xl overflow-hidden transition-all duration-300 ${
        isExpanded ? "fixed inset-3 z-50" : "w-full h-full"
      }`}
    >
      {/* Top Header / Geometry Tool Bar */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 bg-[#16130f] border-b border-[#f3eee6]/[0.08] shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">Mathsy Geometry Canvas</span>
          </div>
          {isHost ? (
            <span className="hidden sm:inline text-xs text-[#a39e94]">
              Ruler, Compass & Protractor Instruments
            </span>
          ) : !canDraw ? (
            <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full border border-zinc-700">
              <Eye className="w-3 h-3 text-amber-400" /> View-Only Mode
            </span>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-amber-400/90 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20 font-medium">
              <Users className="w-3 h-3" />
              <span>Live Shared Classroom Board</span>
            </div>
          )}
        </div>

        {/* Geometry Quick Tools (Only active if canDraw) */}
        {canDraw && (
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
        )}

        {/* Tutor drawing permissions toggle & PDF export & Window controls */}
        <div className="flex items-center gap-1.5">
          {/* Tutor toggle: Allow / Lock Student Drawing */}
          {isHost && (
            <button
              onClick={() => onToggleStudentDrawing?.(!letStudentsDraw)}
              title={letStudentsDraw ? "Click to lock drawing for students" : "Click to allow students to draw"}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${
                letStudentsDraw
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {letStudentsDraw ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              <span className="hidden lg:inline text-[11px]">
                {letStudentsDraw ? "Students Can Draw" : "Students Locked"}
              </span>
            </button>
          )}

          {/* Export PDF Button */}
          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            title="Download Whiteboard Notes as PDF"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#f3eee6] bg-[#221f1a] hover:bg-[#2a2721] border border-[#f3eee6]/15 rounded-lg transition"
          >
            <Download className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span className="hidden md:inline text-[11px]">{isExporting ? "Exporting..." : "PDF Notes"}</span>
          </button>

          <div className="h-4 w-px bg-[#f3eee6]/10 mx-0.5" />

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Maximize"}
            className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] hover:bg-white/5 rounded-lg transition"
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {isHost && (
            <button
              onClick={onClose}
              title="Close Whiteboard for Classroom"
              className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] hover:bg-white/5 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
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
