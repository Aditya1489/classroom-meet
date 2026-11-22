import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Tldraw,
  Editor,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  DefaultColorStyle,
  DefaultSizeStyle,
  track,
  useEditor,
} from "tldraw";
import "tldraw/tldraw.css";
import { AddSlideDialog } from "./slides/AddSlideDialog";
import { clearSlideInk, deleteSlide, duplicateSlide, readSlidesFromBoard, removeAllSlides, reshapeBlankSlides, insertBlankSlide, moveSlide, recolorSlide, resolveInsertIndex, type SlidePosition } from "./slides/slideOps";
import { SlideStrip, type SlideAction } from "./slides/SlideStrip";
import { CompassShapeUtil } from "./shapes/CompassShapeUtil";
import { ProtractorShapeUtil } from "./shapes/ProtractorShapeUtil";
import { RulerShapeUtil } from "./shapes/RulerShapeUtil";
import { SetSquareShapeUtil } from "./shapes/SetSquareShapeUtil";
import { MathsyMediasoupEngine } from "../../engine/mediasoupClient";
import { dbClient } from "../../lib/dbClient";
import { emptyDiff, isEmptyDiff, mergeDiff } from "../../utils/whiteboardDiffBatch";
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
  EyeOff,
  RotateCw,
  ZoomIn,
  FileUp,
  Loader2,
  Menu,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  MousePointer,
  Hand,
  Pencil,
  Eraser,
  ArrowUpRight,
  Type,
  StickyNote,
  Square,
  Image as ImageIcon,
  Palette,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { importFileToWhiteboard, PresentationSlide } from "./importers/whiteboardImporter";
import {
  registerWhiteboardEditor,
  registerWhiteboardSlides,
  setLatestWhiteboardSnapshot,
  exportWhiteboardToPdf,
} from "../../utils/whiteboardPdf";

/** How often the full whiteboard snapshot is re-sent to peers; live strokes go out immediately as diffs. */
// Peers ignore it (they draw from live diffs); the media server keeps it for people who join late.
const SNAPSHOT_SYNC_INTERVAL_MS = 5000;
/** Live stroke changes are merged and sent this often (~25 per second), instead of once per frame. */
const DIFF_BATCH_INTERVAL_MS = 40;

const customShapeUtils = [
  CompassShapeUtil,
  ProtractorShapeUtil,
  RulerShapeUtil,
  SetSquareShapeUtil,
];

/** The whiteboard is a fixed 16:9 slide in page coordinates (not an infinite canvas). */
const WHITEBOARD_SLIDE_BOUNDS = { x: 0, y: 0, w: 1600, h: 900 };

export const PEN_COLORS = [
  { id: "black", label: "Black", hex: "#1e1e1e" },
  { id: "grey", label: "Grey", hex: "#757575" },
  { id: "blue", label: "Blue", hex: "#2f80ed" },
  { id: "light-blue", label: "Light Blue", hex: "#56ccf2" },
  { id: "green", label: "Green", hex: "#27ae60" },
  { id: "light-green", label: "Light Green", hex: "#6fcf97" },
  { id: "yellow", label: "Yellow", hex: "#f2c94c" },
  { id: "orange", label: "Orange", hex: "#f2994a" },
  { id: "red", label: "Red", hex: "#eb5757" },
  { id: "light-red", label: "Light Red", hex: "#ff8080" },
  { id: "violet", label: "Violet", hex: "#9b51e0" },
  { id: "white", label: "White", hex: "#ffffff" },
];

export const PEN_SIZES: { id: "s" | "m" | "l" | "xl"; label: string; strokePx: number }[] = [
  { id: "s", label: "Fine", strokePx: 2 },
  { id: "m", label: "Normal", strokePx: 3.5 },
  { id: "l", label: "Bold", strokePx: 5.5 },
  { id: "xl", label: "Marker", strokePx: 8 },
];

interface WhiteboardProps {
  onClose: () => void;
  isHost?: boolean;
  roomCode?: string;
  engine?: MathsyMediasoupEngine | null;
  myUserId?: string;
  onBroadcast?: (data: any) => void;
  initialSnapshot?: any;
  initialSlides?: PresentationSlide[];
  initialSlideIndex?: number;
  onStateChange?: (snapshot: any, slides?: PresentationSlide[], slideIndex?: number) => void;
  letStudentsDraw?: boolean;
  onToggleStudentDrawing?: (allowed: boolean) => void;
  remoteSnapshot?: any;
  onToggleVirtualLandscape?: () => void;
  isVirtualLandscape?: boolean;
  onToggleFocusMode?: () => void;
  isFocusMode?: boolean;
  isMobile?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  hideTopBar?: boolean;
  onRegisterActions?: (actions: { zoomToFit: () => void; exportPdf: () => void; importFile?: () => void }) => void;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({
  onClose,
  isHost = false,
  roomCode,
  engine,
  myUserId,
  onBroadcast,
  initialSnapshot,
  initialSlides,
  initialSlideIndex,
  onStateChange,
  letStudentsDraw = false,
  onToggleStudentDrawing,
  remoteSnapshot,
  onToggleVirtualLandscape,
  isVirtualLandscape = false,
  onToggleFocusMode,
  isFocusMode = false,
  isMobile = false,
  onToggleFullscreen,
  isFullscreen = false,
  hideTopBar = false,
  onRegisterActions,
}) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const snapshotTimerRef = useRef<NodeJS.Timeout | null>(null);
  const throttleTimerRef = useRef<any>(null);

  // Options Hamburger Dropdown State
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);

  // Single-Slide Presentation Mode State (Restores from initialSlides or localStorage cache until host ends meeting)
  const [presentationSlides, setPresentationSlides] = useState<PresentationSlide[]>(() => {
    if (initialSlides && initialSlides.length > 0) return initialSlides;
    try {
      if (typeof window !== "undefined" && roomCode) {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${roomCode}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed?.slides) && parsed.slides.length > 0) return parsed.slides;
        }
      }
    } catch {}
    return [];
  });
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(() => {
    if (typeof initialSlideIndex === "number") return initialSlideIndex;
    try {
      if (typeof window !== "undefined" && roomCode) {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${roomCode}`);
        if (cached && typeof JSON.parse(cached)?.slideIndex === "number") {
          return JSON.parse(cached).slideIndex;
        }
      }
    } catch {}
    return 0;
  });
  const slidesRef = useRef<PresentationSlide[]>(presentationSlides);
  slidesRef.current = presentationSlides;
  // The class-notes PDF exports an imported PDF / deck page by page, so it needs the page positions.
  useEffect(() => {
    registerWhiteboardSlides(presentationSlides);
  }, [presentationSlides]);

  // Host Viewport Synchronization State (Ensures participants on any device see full host view)
  const lastHostViewportRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastBroadcastBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hostViewportBounds, setHostViewportBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const viewportTimerRef = useRef<any>(null);

  // File Importer State (PDF, PPT/PPTX, PNG/JPG)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Active Annotation Tool State (syncs with TLDraw)
  const [activeTool, setActiveTool] = useState<string>("select");

  const selectTool = (toolId: string) => {
    if (!editor) return;
    try {
      editor.setCurrentTool(toolId);
      setActiveTool(toolId);
    } catch (e) {
      console.warn("[Whiteboard] Error setting tool:", e);
    }
  };

  // Active Pen Color and Size States
  const [activeColor, setActiveColor] = useState<string>("blue");
  const [activeSize, setActiveSize] = useState<"s" | "m" | "l" | "xl">("m");
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);

  const selectColor = (colorId: string) => {
    if (!editor) return;
    try {
      editor.setStyleForNextShapes(DefaultColorStyle, colorId as any);
      if (editor.getSelectedShapes().length > 0) {
        editor.setStyleForSelectedShapes(DefaultColorStyle, colorId as any);
      }
      setActiveColor(colorId);
      if (activeTool !== "draw") {
        selectTool("draw");
      }
    } catch (e) {
      console.warn("[Whiteboard] Error setting color:", e);
    }
  };

  const selectSize = (sizeId: "s" | "m" | "l" | "xl") => {
    if (!editor) return;
    try {
      editor.setStyleForNextShapes(DefaultSizeStyle, sizeId);
      if (editor.getSelectedShapes().length > 0) {
        editor.setStyleForSelectedShapes(DefaultSizeStyle, sizeId);
      }
      setActiveSize(sizeId);
    } catch (e) {
      console.warn("[Whiteboard] Error setting size:", e);
    }
  };

  const activeColorHex = PEN_COLORS.find((c) => c.id === activeColor)?.hex || "#2f80ed";

  // Zen / Zero-UI Presentation Mode State
  const [isZenMode, setIsZenMode] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetControlsTimeout = useCallback(() => {
    setIsControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (isZenMode) {
      idleTimerRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 2500);
    }
  }, [isZenMode]);

  useEffect(() => {
    if (isZenMode) {
      resetControlsTimeout();
    } else {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setIsControlsVisible(true);
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isZenMode, resetControlsTimeout]);

  // Global Keybindings for Presentation & Zen Mode (Z: Toggle Zen, Esc: Exit Zen, Left/Right: Navigate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.getAttribute("contenteditable") === "true")
      ) {
        return;
      }

      if (e.key === "z" || e.key === "Z") {
        setIsZenMode((prev) => !prev);
      } else if (e.key === "Escape" && isZenMode) {
        setIsZenMode(false);
      } else if (presentationSlides.length > 0) {
        if (e.key === "ArrowRight" || e.key === "PageDown") {
          goToSlide(currentSlideIndex + 1);
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
          goToSlide(currentSlideIndex - 1);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isZenMode, presentationSlides.length, currentSlideIndex]);

  const canDraw = Boolean(isHost || letStudentsDraw);

  const goToSlide = (index: number) => {
    if (!editor || slidesRef.current.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, slidesRef.current.length - 1));
    setCurrentSlideIndex(clampedIndex);
    const targetSlide = slidesRef.current[clampedIndex];
    if (!targetSlide) return;

    try {
      const shape = editor.getShape(targetSlide.shapeId);
      const bounds = shape ? editor.getShapePageBounds(targetSlide.shapeId) : targetSlide.bounds;
      if (bounds) {
        editor.zoomToBounds(bounds, { inset: 0, animation: { duration: 300 } });
      }
    } catch (e) {
      console.warn("[Whiteboard] Error zooming to slide:", e);
    }

    if (editor) {
      try {
        const snap = getSnapshot(editor.store);
        onStateChange?.(snap, slidesRef.current, clampedIndex);
        if (roomCode && typeof window !== "undefined") {
          localStorage.setItem(
            `mathsy_room_whiteboard_${roomCode}`,
            JSON.stringify({
              snapshot: snap,
              slides: slidesRef.current,
              slideIndex: clampedIndex,
              updatedAt: Date.now(),
            })
          );
        }
      } catch {}
    }

    if (isHost && engine && roomCode) {
      engine.broadcastWhiteboard({
        type: "slide-change",
        roomCode,
        senderId: myUserId || "local",
        slideIndex: clampedIndex,
        slideShapeId: targetSlide.shapeId,
        timestamp: Date.now(),
      });
    }
  };

  // Tutor adds a blank slide (position + colour); students get it through the normal board sync.
  const [isAddSlideOpen, setIsAddSlideOpen] = useState(false);
  const handleAddSlide = (position: SlidePosition, color: string) => {
    if (!editor || !isHost) return;
    try {
      const at = resolveInsertIndex(position, currentSlideIndex, slidesRef.current.length);
      const result = insertBlankSlide(editor, slidesRef.current, at, color);
      publishSlides(result.slides, result.index);
    } catch (err) {
      console.error("[Whiteboard] Could not add slide:", err);
      toast.error("Could not add the slide. Please try again.");
    }
  };

  /** Saves the new slide list, sends it to students and shows slide `index`. */
  const publishSlides = (slides: PresentationSlide[], index: number) => {
    setPresentationSlides(slides);
    slidesRef.current = slides;
    const at = Math.max(0, Math.min(index, slides.length - 1));
    if (engine && roomCode) {
      engine.broadcastWhiteboard({
        type: "presentation-init",
        roomCode,
        senderId: myUserId || "local",
        slides,
        slideIndex: at,
        timestamp: Date.now(),
      });
    }
    if (slides.length) goToSlide(at);
    else setCurrentSlideIndex(0);
  };

  // When the tutor's board changes shape (chat panel, window size, rotation, zen mode), "+ Slide" slides take the
  // new shape once resizing stops. Students get the new slide sizes through the board sync, then the updated list.
  const reshapeSlidesRef = useRef<() => void>(() => {});
  reshapeSlidesRef.current = () => {
    if (!editor || !isHost || slidesRef.current.length === 0) return;
    const view = editor.getViewportScreenBounds();
    if (view.w < 50 || view.h < 50) return;
    if (!reshapeBlankSlides(editor, view.h / view.w)) return;
    const slides = readSlidesFromBoard(editor);
    const index = Math.min(currentSlideIndex, slides.length - 1);
    setPresentationSlides(slides);
    slidesRef.current = slides;
    // Wait for the shape changes to reach students before telling them to refit.
    window.setTimeout(() => {
      if (!engine || !roomCode) return;
      engine.broadcastWhiteboard({
        type: "presentation-init",
        roomCode,
        senderId: myUserId || "local",
        slides,
        slideIndex: index,
        timestamp: Date.now(),
      });
    }, 300);
  };
  useEffect(() => {
    if (!editor || !isHost || typeof ResizeObserver === "undefined") return;
    const container = editor.getContainer();
    if (!container) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          reshapeSlidesRef.current();
        } catch (err) {
          console.warn("[Whiteboard] Could not reshape slides:", err);
        }
      }, 700);
    });
    observer.observe(container);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [editor, isHost]);

  // Tutor's slide strip (jump, reorder, duplicate, delete, recolour).
  const [isSlideStripOpen, setIsSlideStripOpen] = useState(false);
  const handleSlideAction = (a: SlideAction) => {
    if (!editor || !isHost) return;
    const slides = slidesRef.current;
    try {
      switch (a.type) {
        case "go":
          return goToSlide(a.index);
        case "add-after":
          setCurrentSlideIndex(a.index);
          return setIsAddSlideOpen(true);
        case "move":
          return publishSlides(moveSlide(editor, slides, a.from, a.to), a.to);
        case "duplicate": {
          const r = duplicateSlide(editor, slides, a.index);
          return publishSlides(r.slides, r.index);
        }
        case "delete":
          return publishSlides(deleteSlide(editor, slides, a.index), Math.min(a.index, slides.length - 2));
        case "color":
          if (!recolorSlide(editor, slides[a.index], a.color)) toast.error("Only added slides can change colour.");
          return;
      }
    } catch (err) {
      console.error("[Whiteboard] Slide action failed:", err);
      toast.error("Could not change the slides. Please try again.");
    }
  };

  const processFileImport = async (file: File) => {
    if (!editor) {
      toast.error("Whiteboard is not ready yet");
      return;
    }
    if (!isHost) {
      toast.error("Only the tutor can import documents into the whiteboard");
      return;
    }

    setIsImporting(true);
    setImportStatus(`Loading ${file.name}...`);
    const toastId = toast.loading(`Importing ${file.name}...`);

    try {
      const result = await importFileToWhiteboard(file, editor, (_progress, msg) => {
        setImportStatus(msg);
      });

      if (result.success) {
        toast.success(
          `Imported ${result.count} ${result.type === "pdf" ? "PDF page(s)" : result.type === "pptx" ? "presentation slide(s)" : "image"} onto the whiteboard`,
          { id: toastId }
        );

        if (result.slides && result.slides.length > 0) {
          setPresentationSlides(result.slides);
          setCurrentSlideIndex(0);
          slidesRef.current = result.slides;
          setIsZenMode(false);
        }

        // Authoritative broadcast of imported slide shapes to all classroom peers
        try {
          const snapshot = getSnapshot(editor.store);
          setLatestWhiteboardSnapshot(snapshot);
          onBroadcast?.({ snapshot, slides: result.slides, slideIndex: 0 });
          onStateChange?.(snapshot, result.slides, 0);

          if (roomCode && typeof window !== "undefined") {
            try {
              localStorage.setItem(
                `mathsy_room_whiteboard_${roomCode}`,
                JSON.stringify({
                  snapshot,
                  slides: result.slides,
                  slideIndex: 0,
                  updatedAt: Date.now(),
                })
              );
            } catch {}
          }

          if (engine && roomCode && result.slides && result.slides.length > 0) {
            engine.broadcastWhiteboard({
              type: "presentation-init",
              roomCode,
              senderId: myUserId || "local",
              slides: result.slides,
              slideIndex: 0,
              timestamp: Date.now(),
            });
          }
          if (roomCode) {
            dbClient.saveWhiteboardSnapshot(roomCode, snapshot);
          }
        } catch (e) {
          console.warn("[Whiteboard] Error broadcasting imported snapshot:", e);
        }
      } else {
        toast.error(result.error || "Failed to import file", { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to process file import", { id: toastId });
    } finally {
      setIsImporting(false);
      setImportStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFileImport(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isHost) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isHost) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isHost) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFileImport(file);
    }
  };

  const broadcastViewport = useCallback(
    (force = false) => {
      const ed = editorRef.current || editor;
      if (!isHost || !ed || !engine || !roomCode) return;
      try {
        // Share a frame that is independent of the host's window size: same top-left corner and
        // zoom as the host, but a fixed 16:9 reference size. Resizing the host's window (class feed,
        // fullscreen, side panels) therefore no longer re-zooms every student's board.
        const visible = ed.getViewportPageBounds();
        if (!visible || visible.w <= 0 || visible.h <= 0) return;
        const zoom = ed.getZoomLevel() || 1;
        const REF_W = 1600;
        const REF_H = 900;
        const bounds = { x: visible.x, y: visible.y, w: REF_W / zoom, h: REF_H / zoom };

        const last = lastBroadcastBoundsRef.current;
        if (
          !force &&
          last &&
          Math.abs(last.x - bounds.x) < 5 &&
          Math.abs(last.y - bounds.y) < 5 &&
          Math.abs(last.w - bounds.w) < 5 &&
          Math.abs(last.h - bounds.h) < 5
        ) {
          return;
        }

        lastBroadcastBoundsRef.current = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        setHostViewportBounds({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });

        engine.broadcastWhiteboard({
          type: "viewport",
          roomCode,
          senderId: myUserId || "local",
          bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn("[Whiteboard] Error broadcasting viewport:", err);
      }
    },
    [isHost, editor, engine, roomCode, myUserId]
  );

  // Host Periodic Viewport Heartbeat (keeps late joiners and mobile viewers seamlessly locked to host area)
  useEffect(() => {
    if (!isHost || !editor) return;
    const interval = setInterval(() => {
      broadcastViewport(false);
    }, 2500);
    return () => clearInterval(interval);
  }, [isHost, editor, broadcastViewport]);

  // ── Fixed slide (no infinite canvas) ──
  // The board is a fixed 16:9 slide (or, with an imported PDF/PPT, the current page). The camera is
  // constrained to it: it scales to fit any screen size, users may zoom in for detail, but cannot pan or
  // zoom out past the slide.
  const getActiveSlideBounds = useCallback(
    (ed: Editor) => {
      const slide = slidesRef.current[currentSlideIndex] || presentationSlides[currentSlideIndex];
      if (slide) {
        try {
          const live = ed.getShape(slide.shapeId) ? ed.getShapePageBounds(slide.shapeId) : null;
          if (live && live.w > 0 && live.h > 0) return { x: live.x, y: live.y, w: live.w, h: live.h };
        } catch {}
        if (slide.bounds?.w > 0 && slide.bounds?.h > 0) return slide.bounds;
      }
      return WHITEBOARD_SLIDE_BOUNDS;
    },
    [currentSlideIndex, presentationSlides]
  );

  const fitActiveSlide = useCallback(
    (ed: Editor, animate = true) => {
      const bounds = getActiveSlideBounds(ed);
      ed.setCameraOptions({
        constraints: {
          bounds,
          padding: { x: isMobile ? 4 : 12, y: isMobile ? 4 : 12 },
          origin: { x: 0.5, y: 0.5 },
          initialZoom: "fit-max",
          baseZoom: "fit-max",
          behavior: "contain",
        },
        // Relative to the fitted (base) zoom: 1 = whole slide visible, up to 8x zoom-in.
        zoomSteps: [1, 1.5, 2, 3, 4, 6, 8],
      });
      ed.zoomToBounds(bounds, { inset: 0, ...(animate ? { animation: { duration: 200 } } : {}) });
    },
    [getActiveSlideBounds, isMobile]
  );

  useEffect(() => {
    if (!editor) return;
    try {
      fitActiveSlide(editor, false);
    } catch (err) {
      console.warn("[Whiteboard] Could not apply slide camera:", err);
    }
  }, [editor, fitActiveSlide]);

  // Keep the slide fitted when the board's container changes size (window resize, rotation, side panel),
  // unless the user has deliberately zoomed in.
  useEffect(() => {
    if (!editor || typeof ResizeObserver === "undefined") return;
    const container = editor.getContainer();
    if (!container) return;
    let wasAtFit = true;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          // Make tldraw pick up the new container size first; otherwise the fit is computed for the old
          // size and the slide ends up off-center.
          editor.updateViewportScreenBounds(container);
          if (wasAtFit) {
            fitActiveSlide(editor, false);
          } else if (!isHost && lastHostViewportRef.current) {
            // Students who follow the tutor's zoomed view keep following it after a resize.
            editor.zoomToBounds(lastHostViewportRef.current, { inset: 0 });
          }
        } catch {}
      });
    });
    const unlisten = editor.store.listen(
      () => {
        try {
          // The fitted view sits a few percent above tldraw's base zoom (padding), so allow 10%.
          wasAtFit = editor.getZoomLevel() <= editor.getBaseZoom() * 1.1;
        } catch {}
      },
      { scope: "session" }
    );
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unlisten();
    };
  }, [editor, fitActiveSlide, isHost]);

  const handleZoomToFit = () => {
    if (!editor) return;
    try {
      // 1. If viewing presentation slides, fit the current slide
      if (presentationSlides.length > 0 && presentationSlides[currentSlideIndex]) {
        const targetSlide = presentationSlides[currentSlideIndex];
        const shape = editor.getShape(targetSlide.shapeId);
        const bounds = shape ? editor.getShapePageBounds(targetSlide.shapeId) : targetSlide.bounds;
        if (bounds) {
          editor.zoomToBounds(bounds, {
            inset: isMobile ? 4 : 12,
            animation: { duration: 250 },
          });
          toast.info("Slide centered to fit screen", { id: "zoom-fit" });
          return;
        }
      }

      // 2. If student has received host viewport bounds, prioritize aligning with host's exact view
      if (!isHost && lastHostViewportRef.current) {
        editor.zoomToBounds(lastHostViewportRef.current, {
          inset: isMobile ? 8 : 16,
          animation: { duration: 250 },
        });
        toast.info("Whiteboard aligned to host view", { id: "zoom-fit" });
        return;
      }

      // 3. Fit the whole whiteboard slide
      fitActiveSlide(editor, true);
      toast.info("Whiteboard slide fitted to screen", { id: "zoom-fit" });
    } catch (err) {
      console.warn("[Whiteboard] zoomToFit error:", err);
    }
  };

  const handleMount = (ed: Editor) => {
    editorRef.current = ed;
    setEditor(ed);
    registerWhiteboardEditor(ed);
    onRegisterActions?.({
      zoomToFit: handleZoomToFit,
      exportPdf: handleExportPdf,
      importFile: () => fileInputRef.current?.click(),
    });

    let effectiveSnapshot = initialSnapshot;
    if (!effectiveSnapshot && roomCode && typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${roomCode}`);
        if (cached) {
          effectiveSnapshot = JSON.parse(cached)?.snapshot;
        }
      } catch {}
    }

    if (effectiveSnapshot) {
      try {
        loadSnapshot(ed.store, effectiveSnapshot);
        setTimeout(() => {
          try {
            const shapes = ed.getCurrentPageShapes();
            const slideShapes = shapes.filter((s) => s.type === "image" && s.isLocked).sort((a, b) => a.x - b.x);
            if (slideShapes.length >= 1 && slidesRef.current.length === 0) {
              const reconstructed: PresentationSlide[] = slideShapes.map((s, idx) => ({
                index: idx,
                pageNumber: idx + 1,
                totalCount: slideShapes.length,
                title: (s.props as any)?.altText || `Slide ${idx + 1}`,
                shapeId: s.id,
                assetId: (s.props as any)?.assetId || "",
                bounds: {
                  x: s.x,
                  y: s.y,
                  w: (s.props as any)?.w || 1600,
                  h: (s.props as any)?.h || 900,
                },
              }));
              setPresentationSlides(reconstructed);
              slidesRef.current = reconstructed;
              const targetIdx = initialSlideIndex !== undefined && initialSlideIndex < reconstructed.length ? initialSlideIndex : 0;
              setCurrentSlideIndex(targetIdx);
              ed.zoomToBounds(reconstructed[targetIdx].bounds, { inset: 0, animation: { duration: 250 } });
            } else if (slidesRef.current.length > 0) {
              const targetIdx = initialSlideIndex !== undefined && initialSlideIndex < slidesRef.current.length ? initialSlideIndex : currentSlideIndex;
              if (slidesRef.current[targetIdx]) {
                ed.zoomToBounds(slidesRef.current[targetIdx].bounds, { inset: 0, animation: { duration: 250 } });
              }
            } else {
              ed.zoomToBounds(WHITEBOARD_SLIDE_BOUNDS, { inset: 0 });
            }
          } catch {}
        }, 150);
      } catch (err) {
        console.warn("[Whiteboard] Failed to load initial snapshot:", err);
      }
    } else {
      setTimeout(() => {
        try {
          ed.zoomToBounds(WHITEBOARD_SLIDE_BOUNDS, { inset: 0 });
        } catch {}
      }, 150);
    }

    // Late Join / Fresh Mount: Load snapshot from PostgreSQL if available
    if (roomCode) {
      dbClient.getWhiteboardSnapshot(roomCode).then((snapshot) => {
        if (snapshot && ed) {
          try {
            ed.loadSnapshot(snapshot);
            console.log("[Whiteboard] Authoritative snapshot loaded for room:", roomCode);
            setTimeout(() => {
              try {
                const shapes = ed.getCurrentPageShapes();
                const slideShapes = shapes.filter((s) => s.type === "image" && s.isLocked).sort((a, b) => a.x - b.x);
                if (slideShapes.length >= 1 && slidesRef.current.length === 0) {
                  const reconstructed: PresentationSlide[] = slideShapes.map((s, idx) => ({
                    index: idx,
                    pageNumber: idx + 1,
                    totalCount: slideShapes.length,
                    title: (s.props as any)?.altText || `Slide ${idx + 1}`,
                    shapeId: s.id,
                    assetId: (s.props as any)?.assetId || "",
                    bounds: {
                      x: s.x,
                      y: s.y,
                      w: (s.props as any)?.w || 1600,
                      h: (s.props as any)?.h || 900,
                    },
                  }));
                  setPresentationSlides(reconstructed);
                  slidesRef.current = reconstructed;
                  const targetIdx = initialSlideIndex !== undefined && initialSlideIndex < reconstructed.length ? initialSlideIndex : 0;
                  setCurrentSlideIndex(targetIdx);
                  onStateChange?.(snapshot, reconstructed, targetIdx);
                  ed.zoomToBounds(reconstructed[targetIdx].bounds, { inset: 0, animation: { duration: 250 } });
                } else {
                  ed.zoomToBounds(WHITEBOARD_SLIDE_BOUNDS, { inset: 0 });
                }
              } catch {}
            }, 150);
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
          // Live strokes reach peers as small diffs (see the sync effect below). This full snapshot only keeps
          // peers reconciled, and with imported PDF/slide images it can be megabytes, so sending it on every
          // stroke queued the diffs behind it on the same connection. Send it at most once per interval.
          if (throttleTimerRef.current) return;
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            try {
              const snapshot = getSnapshot(ed.store);
              setLatestWhiteboardSnapshot(snapshot);
              onBroadcast?.({ snapshot });
              onStateChange?.(snapshot, slidesRef.current, currentSlideIndex);
              if (roomCode && typeof window !== "undefined") {
                try {
                  localStorage.setItem(
                    `mathsy_room_whiteboard_${roomCode}`,
                    JSON.stringify({
                      snapshot,
                      slides: slidesRef.current,
                      slideIndex: currentSlideIndex,
                      updatedAt: Date.now(),
                    })
                  );
                } catch {}
              }
              // Saving to the database is done by the sync effect's debounced save, not on every snapshot.
            } catch (err) {
              console.warn("[Whiteboard] Failed to capture store snapshot:", err);
            }
          }, SNAPSHOT_SYNC_INTERVAL_MS);
        }
      },
      { scope: "document", source: "user" }
    );

    // Active Tool and Style Sync Listener
    try {
      ed.setStyleForNextShapes(DefaultColorStyle, "blue");
      ed.setStyleForNextShapes(DefaultSizeStyle, "m");
    } catch {}

    const updateActiveToolAndStyles = () => {
      try {
        const tool = ed.getCurrentToolId();
        if (tool) setActiveTool(tool);
        const styles = ed.getSharedStyles();
        const colorStyle: any = styles.get(DefaultColorStyle);
        if (colorStyle?.type === "shared" && typeof colorStyle.value === "string") {
          setActiveColor(colorStyle.value);
        }
        const sizeStyle: any = styles.get(DefaultSizeStyle);
        if (sizeStyle?.type === "shared" && typeof sizeStyle.value === "string") {
          setActiveSize(sizeStyle.value);
        }
      } catch {}
    };
    updateActiveToolAndStyles();
    const unlistenTool = ed.store.listen(() => {
      updateActiveToolAndStyles();
    });

    // Listen to camera movements to broadcast host viewport to participants
    const unlistenCamera = ed.store.listen(
      (entry) => {
        if (!isHost) return;
        const hasCameraChange =
          Object.keys(entry.changes.added).some((k) => k.startsWith("camera:")) ||
          Object.keys(entry.changes.updated).some((k) => k.startsWith("camera:"));
        if (hasCameraChange) {
          if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
          viewportTimerRef.current = setTimeout(() => {
            broadcastViewport(false);
          }, 150);
        }
      },
      { scope: "all" }
    );

    // Initial viewport sync: Host broadcasts initial viewport; Participant asks host for current viewport
    if (isHost) {
      setTimeout(() => broadcastViewport(true), 400);
    } else if (engine && roomCode) {
      setTimeout(() => {
        engine.broadcastWhiteboard({
          type: "request-viewport",
          roomCode,
          senderId: myUserId || "local",
          timestamp: Date.now(),
        });
      }, 300);
    }

    return () => {
      unlisten();
      unlistenTool();
      unlistenCamera();
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
      editorRef.current = null;
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

  // Expose action callbacks (ZoomToFit, ExportPdf) to parent container (e.g., Mobile Landscape Sidebar)
  useEffect(() => {
    if (editor && onRegisterActions) {
      onRegisterActions({
        zoomToFit: handleZoomToFit,
        exportPdf: handleExportPdf,
      });
    }
  }, [editor, onRegisterActions]);

  // Real-time synchronization of drawing, shapes, and erasures
  useEffect(() => {
    if (!editor) return;

    // 1. Listen for local user changes (document scope only). Changes are merged and sent every
    //    DIFF_BATCH_INTERVAL_MS, each batch with an id so peers can drop copies that arrive twice.
    let pendingDiff = emptyDiff();
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let batchSeq = 0;
    const flushDiff = () => {
      batchTimer = null;
      if (isEmptyDiff(pendingDiff) || !engine || !roomCode) return;
      const changes = pendingDiff;
      pendingDiff = emptyDiff();
      batchSeq += 1;
      engine.broadcastWhiteboard({
        type: "diff",
        wbId: `${myUserId || "local"}:${Date.now().toString(36)}:${batchSeq}`,
        roomCode,
        senderId: myUserId || "local",
        changes,
        timestamp: Date.now(),
      });
    };
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

        // Queue the change; the batch goes out within DIFF_BATCH_INTERVAL_MS
        if (engine && roomCode) {
          mergeDiff(pendingDiff, { added, updated, removed } as any);
          if (!batchTimer) batchTimer = setTimeout(flushDiff, DIFF_BATCH_INTERVAL_MS);
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
      } else if (data.type === "viewport" && data.bounds) {
        lastHostViewportRef.current = data.bounds;
        setHostViewportBounds(data.bounds);
        if (!isHost && editor) {
          try {
            editor.zoomToBounds(data.bounds, {
              inset: isMobile ? 8 : 16,
              animation: { duration: 250 },
            });
          } catch (err) {
            console.warn("[Whiteboard] Error aligning to host viewport:", err);
          }
        }
      } else if (data.type === "request-viewport") {
        if (isHost && (editorRef.current || editor)) {
          broadcastViewport(true);
        }
      } else if (data.type === "snapshot" && data.snapshot) {
        try {
          editor.loadSnapshot(data.snapshot);
          setTimeout(() => {
            try {
              // Reconstruct presentation slides if document contains slides (single or multi-page)
              const shapes = editor.getCurrentPageShapes();
              const slideShapes = shapes.filter((s) => s.type === "image" && s.isLocked).sort((a, b) => a.x - b.x);
              if (slideShapes.length >= 1 && slidesRef.current.length === 0) {
                const reconstructed: PresentationSlide[] = slideShapes.map((s, idx) => ({
                  index: idx,
                  pageNumber: idx + 1,
                  totalCount: slideShapes.length,
                  title: (s.props as any)?.altText || `Slide ${idx + 1}`,
                  shapeId: s.id,
                  assetId: (s.props as any)?.assetId || "",
                  bounds: {
                    x: s.x,
                    y: s.y,
                    w: (s.props as any)?.w || 1600,
                    h: (s.props as any)?.h || 900,
                  },
                }));
                setPresentationSlides(reconstructed);
                slidesRef.current = reconstructed;
                onStateChange?.(data.snapshot, reconstructed, 0);
                editor.zoomToBounds(reconstructed[0].bounds, { inset: 0, animation: { duration: 250 } });
              } else {
                editor.zoomToFit({ animation: { duration: 200 } });
              }
            } catch {}
          }, 150);
        } catch (err) {
          console.warn("[Whiteboard] Error applying remote snapshot:", err);
        }
      } else if (data.type === "presentation-init" && Array.isArray(data.slides)) {
        setPresentationSlides(data.slides);
        slidesRef.current = data.slides;
        setCurrentSlideIndex(data.slideIndex || 0);
        try {
          const snap = getSnapshot(editor.store);
          onStateChange?.(snap, data.slides, data.slideIndex || 0);
          if (roomCode && typeof window !== "undefined") {
            localStorage.setItem(
              `mathsy_room_whiteboard_${roomCode}`,
              JSON.stringify({
                snapshot: snap,
                slides: data.slides,
                slideIndex: data.slideIndex || 0,
                updatedAt: Date.now(),
              })
            );
          }
        } catch {}
        const targetSlide = data.slides[data.slideIndex || 0];
        if (targetSlide) {
          setTimeout(() => {
            try {
              editor.zoomToBounds(targetSlide.bounds, { inset: 0, animation: { duration: 300 } });
            } catch {}
          }, 150);
        }
      } else if (data.type === "slide-change" && typeof data.slideIndex === "number") {
        setCurrentSlideIndex(data.slideIndex);
        try {
          const snap = getSnapshot(editor.store);
          onStateChange?.(snap, slidesRef.current, data.slideIndex);
          if (roomCode && typeof window !== "undefined") {
            localStorage.setItem(
              `mathsy_room_whiteboard_${roomCode}`,
              JSON.stringify({
                snapshot: snap,
                slides: slidesRef.current,
                slideIndex: data.slideIndex,
                updatedAt: Date.now(),
              })
            );
          }
        } catch {}
        const targetSlide = slidesRef.current[data.slideIndex];
        if (targetSlide) {
          try {
            editor.zoomToBounds(targetSlide.bounds, { inset: 0, animation: { duration: 250 } });
          } catch {}
        }
      }
    };

    if (engine) {
      engine.onWhiteboardData = handleRemoteWhiteboardData;
    }

    return () => {
      unlisten();
      if (batchTimer) {
        clearTimeout(batchTimer);
        flushDiff(); // send the last strokes rather than dropping them
      }
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

  // Tutor only. With slides open it clears just the current slide's writing; otherwise the whole board. Asks first.
  const clearCanvas = () => {
    if (!editor || !isHost) return;
    const slides = slidesRef.current;
    if (slides.length > 0) {
      const n = currentSlideIndex + 1;
      if (!window.confirm(`Clear the writing on slide ${n}? The slide itself stays.`)) return;
      const removed = clearSlideInk(editor, slides, currentSlideIndex);
      toast.info(removed ? `Slide ${n} cleared` : `Nothing written on slide ${n}`, { id: "clear-canvas" });
      return;
    }
    const shapes = editor.getCurrentPageShapes();
    if (shapes.length === 0) return;
    if (!window.confirm("Clear the whole board for everyone?")) return;
    editor.deleteShapes(shapes.map((s) => s.id));
    toast.info("Whiteboard canvas cleared", { id: "clear-canvas" });
  };

  const WhiteboardCanvasBoundary = track(() => {
    let ed: Editor | null = null;
    try {
      ed = useEditor();
    } catch {}

    // If presentation slides (PDF/PPT/images) are loaded, the slides define the presentation bounds
    if (presentationSlides.length > 0) return null;

    // tldraw's OnTheCanvas layer already moves and scales with the camera, so the frame is positioned in
    // page coordinates. (Converting to viewport coordinates here applied the camera twice, drawing the
    // frame in the wrong place and at the wrong size whenever the zoom wasn't 100%.)
    const bounds = WHITEBOARD_SLIDE_BOUNDS;
    let zoom = 1;
    try {
      zoom = ed?.getZoomLevel() || 1;
    } catch {}
    // Keep the label and corner brackets the same on-screen size at any zoom.
    const inv = 1 / zoom;

    return (
      <div
        data-testid="whiteboard-screen-boundary"
        style={{
          position: "absolute",
          left: bounds.x,
          top: bounds.y,
          width: bounds.w,
          height: bounds.h,
          pointerEvents: "none",
          outline: `${2 * inv}px solid rgba(245, 158, 11, 0.6)`,
          // Dim everything outside the slide so the drawable page is obvious.
          boxShadow: `0 0 0 ${100000}px rgba(14, 13, 11, 0.55)`,
        }}
        className="select-none"
      >
        <div
          style={{ transform: `scale(${inv})`, transformOrigin: "top left" }}
          className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-[#16130f]/90 border border-amber-500/40 text-[#f59e0b] font-mono text-[10px] font-bold flex items-center gap-1.5 shadow-lg pointer-events-none whitespace-nowrap"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{isHost ? "Whiteboard Slide (16:9)" : "Tutor Whiteboard"}</span>
        </div>
      </div>
    );
  });

  const customComponents = useMemo(
    () => ({
      Toolbar: null,
      NavigationPanel: null,
      PageMenu: null,
      MainMenu: null,
      StylePanel: null,
      QuickActions: null,
      OnTheCanvas: WhiteboardCanvasBoundary,
    }),
    [presentationSlides.length, isHost, hostViewportBounds]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col bg-[#16130f] rounded-2xl border-2 border-zinc-700/80 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/10 ${
        isDraggingOver ? "border-[#f59e0b] ring-2 ring-[#f59e0b]/40" : ""
      } overflow-hidden transition-all duration-300 ${
        isExpanded ? "fixed inset-3 z-50" : "w-full h-full"
      }`}
    >
      {/* Hidden File Picker for Tutor Import (PDF, PPT, PNG) */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.svg"
        className="hidden"
      />

      {/* Drag & Drop Visual Target Overlay */}
      {isDraggingOver && isHost && (
        <div className="absolute inset-0 z-50 bg-[#16130f]/90 backdrop-blur-sm border-2 border-dashed border-[#f59e0b] flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
          <div className="w-16 h-16 rounded-2xl bg-[#f59e0b]/20 border border-[#f59e0b]/40 flex items-center justify-center text-[#f59e0b] mb-3 shadow-xl animate-bounce">
            <FileUp className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">Drop to Import into Whiteboard</h3>
          <p className="text-xs text-zinc-400">PDF documents, PowerPoint (.pptx / .ppt), and PNG / JPG images</p>
        </div>
      )}

      {/* In-Progress Importing Badge */}
      {isImporting && (
        <div className="absolute top-12 sm:top-14 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-[#16130f]/95 border border-[#f59e0b]/50 text-white shadow-2xl flex items-center gap-2 backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-3.5 h-3.5 text-[#f59e0b] animate-spin" />
          <span className="text-[11px] font-semibold text-zinc-200">{importStatus || "Importing content..."}</span>
        </div>
      )}

      {/* Top Header / Geometry Tool Bar (Auto-hides in Zen Presentation Mode when idle) */}
      {!hideTopBar && (!isZenMode || isControlsVisible) && (
        <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 bg-[#16130f] border-b border-[#f3eee6]/[0.08] shrink-0 gap-2 relative z-50 overflow-visible">
          {/* Left: Options Hamburger + Math Canvas */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-visible">
            {/* Whiteboard Options Hamburger Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsOptionsMenuOpen(!isOptionsMenuOpen)}
                title="Whiteboard Options & Tools"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[#f3eee6] bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/15 hover:border-[#f59e0b]/40 rounded-lg transition shrink-0 cursor-pointer shadow-sm active:scale-95"
              >
                <Menu className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span className="font-mono text-[11px] hidden sm:inline">Options</span>
                <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isOptionsMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Popover Menu */}
              {isOptionsMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-[240] bg-black/40 backdrop-blur-[1px] transition-opacity"
                    onClick={() => setIsOptionsMenuOpen(false)}
                  />
                  <div
                    style={{ backgroundColor: "#16130f", color: "#f3eee6" }}
                    className="absolute left-0 top-full mt-[50px] z-[250] w-72 p-2.5 rounded-2xl bg-[#16130f] border border-[#f59e0b]/30 shadow-[0_20px_50px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-top-1 flex flex-col gap-2 divide-y divide-[#f3eee6]/10"
                  >
                    
                    {/* SECTION 1: STEM GEOMETRY INSTRUMENTS */}
                    {canDraw && (
                      <div className="flex flex-col gap-1.5 pt-0.5">
                        <div className="px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-[#f59e0b] font-bold flex items-center justify-between">
                          <span>📐 Geometry Tools</span>
                          <span className="text-[10px] text-zinc-400 font-normal">STEM</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 px-0.5">
                          <button
                            onClick={() => {
                              insertRuler();
                              setIsOptionsMenuOpen(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                          >
                            <Ruler className="w-3.5 h-3.5 text-[#f59e0b]" />
                            <span>Ruler</span>
                          </button>

                          <button
                            onClick={() => {
                              insertCompass();
                              setIsOptionsMenuOpen(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-emerald-400/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                          >
                            <Compass className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Compass</span>
                          </button>

                          <button
                            onClick={() => {
                              insertProtractor();
                              setIsOptionsMenuOpen(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                          >
                            <CircleDot className="w-3.5 h-3.5 text-[#f59e0b]" />
                            <span>Protractor</span>
                          </button>

                          <button
                            onClick={() => {
                              insertSetSquare();
                              setIsOptionsMenuOpen(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-amber-300/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                          >
                            <Triangle className="w-3.5 h-3.5 text-amber-300" />
                            <span>Set Square</span>
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            clearCanvas();
                            setIsOptionsMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl transition cursor-pointer active:scale-95 mt-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Clear Whiteboard Canvas</span>
                        </button>
                      </div>
                    )}

                    {/* SECTION 2: DOCUMENTS & PRESENTATION */}
                    <div className="flex flex-col gap-1.5 pt-2">
                      <div className="px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-[#f59e0b] font-bold">
                        📄 Documents & Notes
                      </div>

                      {/* Tutor Import Button (PDF, PPT, PNG) */}
                      {isHost && (
                        <button
                          onClick={() => {
                            fileInputRef.current?.click();
                            setIsOptionsMenuOpen(false);
                          }}
                          disabled={isImporting}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer disabled:opacity-50 active:scale-95 shadow-sm"
                        >
                          <span className="flex items-center gap-2">
                            {isImporting ? (
                              <Loader2 className="w-3.5 h-3.5 text-[#f59e0b] animate-spin" />
                            ) : (
                              <FileUp className="w-3.5 h-3.5 text-[#f59e0b]" />
                            )}
                            <span className="font-bold text-white">Import Slides / Doc</span>
                          </span>
                          <span className="text-[10px] text-zinc-300 font-mono bg-[#16130f] px-1.5 py-0.5 rounded border border-[#f3eee6]/10">
                            PDF • PPT • PNG
                          </span>
                        </button>
                      )}

                      {/* Notes PDF Export */}
                      <button
                        onClick={() => {
                          handleExportPdf();
                          setIsOptionsMenuOpen(false);
                        }}
                        disabled={isExporting}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer disabled:opacity-50 active:scale-95 shadow-sm"
                      >
                        <span className="flex items-center gap-2">
                          <Download className="w-3.5 h-3.5 text-[#f59e0b]" />
                          <span>Export Notes PDF</span>
                        </span>
                        <span className="text-[10px] text-zinc-300 font-mono bg-[#16130f] px-1.5 py-0.5 rounded border border-[#f3eee6]/10">
                          {isExporting ? "Exporting..." : "Download"}
                        </span>
                      </button>

                      {/* Close Document & Clear Canvas (if active) */}
                      {isHost && presentationSlides.length > 0 && (
                        <button
                          onClick={() => {
                            if (!window.confirm("Close the document? Its pages and the writing on them will be removed for everyone.")) return;
                            // Slides are locked, so they are removed with the lock overridden; students are told the list is empty.
                            if (editor) removeAllSlides(editor);
                            publishSlides([], 0);
                            setIsOptionsMenuOpen(false);
                            setIsZenMode(false);
                            if (editor) {
                              editor.zoomToFit({ animation: { duration: 250 } });
                              const snap = getSnapshot(editor.store);
                              onStateChange?.(snap, [], 0);
                              if (roomCode && typeof window !== "undefined") {
                                localStorage.setItem(
                                  `mathsy_room_whiteboard_${roomCode}`,
                                  JSON.stringify({
                                    snapshot: snap,
                                    slides: [],
                                    slideIndex: 0,
                                    updatedAt: Date.now(),
                                  })
                                );
                              }
                            }
                            toast.info("Document closed. Whiteboard reset to blank canvas.");
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl transition cursor-pointer active:scale-95"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Close Document & Free Canvas</span>
                        </button>
                      )}
                    </div>

                    {/* SECTION 3: CLASSROOM CONTROLS */}
                    <div className="flex flex-col gap-1.5 pt-2">
                      <div className="px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-[#f59e0b] font-bold">
                        👑 Classroom Controls
                      </div>

                      {/* Zen Presentation Mode Toggle */}
                      <button
                        onClick={() => {
                          setIsZenMode(!isZenMode);
                          setIsOptionsMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                      >
                        <span className="flex items-center gap-2">
                          {isZenMode ? (
                            <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 text-[#f59e0b]" />
                          )}
                          <span>Zen Presentation</span>
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            isZenMode
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                          }`}
                        >
                          {isZenMode ? "Clean (Active)" : "Off (Press Z)"}
                        </span>
                      </button>

                      {/* Student Drawing Lock Toggle (Host Only) */}
                      {isHost && (
                        <button
                          onClick={() => {
                            onToggleStudentDrawing?.(!letStudentsDraw);
                            setIsOptionsMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                        >
                          <span className="flex items-center gap-2">
                            {letStudentsDraw ? (
                              <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-amber-400" />
                            )}
                            <span>Student Drawing</span>
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              letStudentsDraw
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                            }`}
                          >
                            {letStudentsDraw ? "Allowed" : "Locked"}
                          </span>
                        </button>
                      )}

                      {/* Focus Mode Toggle */}
                      {onToggleFocusMode && (
                        <button
                          onClick={() => {
                            onToggleFocusMode();
                            setIsOptionsMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#f3eee6] hover:text-white bg-[#221f1a] hover:bg-[#2c2822] border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 rounded-xl transition cursor-pointer active:scale-95 shadow-sm"
                        >
                          <span className="flex items-center gap-2">
                            <Maximize2 className="w-3.5 h-3.5 text-[#f59e0b]" />
                            <span>Focus Mode</span>
                          </span>
                          <span className="text-[10px] text-zinc-300 font-mono bg-[#16130f] px-1.5 py-0.5 rounded border border-[#f3eee6]/10">
                            {isFocusMode ? "Normal" : "Full Immersion"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Math Canvas Brand Badge */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-semibold shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="font-mono text-[11px] whitespace-nowrap">Math Canvas</span>
            </div>
          </div>

          {/* Center Cluster: Slide Controls + Annotation Tools Bar (Directly between Math Canvas & Fit, off the whiteboard screen) */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 overflow-x-auto no-scrollbar max-w-[65vw]">
            {isHost && editor && (
              <button
                type="button"
                onClick={() => setIsAddSlideOpen(true)}
                title="Add a slide"
                className="min-h-8 shrink-0 rounded-xl border border-[#f59e0b]/40 bg-[#1a1814] px-2.5 text-xs font-bold text-[#f59e0b] hover:bg-white/10"
              >
                + Slide
              </button>
            )}
            {isHost && editor && presentationSlides.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSlideStripOpen((v) => !v)}
                title="All slides"
                className={`min-h-8 shrink-0 rounded-xl border border-[#f59e0b]/40 px-2.5 text-xs font-bold hover:bg-white/10 ${isSlideStripOpen ? "bg-[#f59e0b] text-black" : "bg-[#1a1814] text-[#f59e0b]"}`}
              >
                Slides
              </button>
            )}
            <AddSlideDialog
              open={isAddSlideOpen}
              onOpenChange={setIsAddSlideOpen}
              slideCount={presentationSlides.length}
              currentIndex={currentSlideIndex}
              onAdd={handleAddSlide}
            />
            {/* Slide Presentation Controls (When Slides are Active) */}
            {presentationSlides.length > 0 && (
              <div
                data-testid="header-slide-controls"
                title={isHost ? "Host Controls Slides" : "Controlled by Tutor"}
                className="flex items-center gap-1 bg-[#1a1814] px-2 py-1 rounded-xl border border-[#f59e0b]/40 shadow-inner shrink-0"
              >
                {isHost ? (
                  <>
                    <button
                      type="button"
                      onClick={() => goToSlide(currentSlideIndex - 1)}
                      disabled={currentSlideIndex <= 0}
                      title="Previous Slide (← Arrow)"
                      className="p-1 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer active:scale-90"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-center gap-1 font-mono text-xs font-bold text-zinc-100 select-none px-1">
                      <span className="text-[#f59e0b]">{currentSlideIndex + 1}</span>
                      <span className="text-zinc-500">/</span>
                      <span>{presentationSlides.length}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => goToSlide(currentSlideIndex + 1)}
                      disabled={currentSlideIndex >= presentationSlides.length - 1}
                      title="Next Slide (→ Arrow)"
                      className="p-1 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer active:scale-90"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <div className="h-3.5 w-px bg-[#f3eee6]/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setIsZenMode(!isZenMode)}
                      title={isZenMode ? "Show Tools & Annotate (Z)" : "Zen View (Z)"}
                      aria-label="Zen View (Z)"
                      className={`p-1 rounded-lg transition cursor-pointer select-none active:scale-90 ${
                        isZenMode
                          ? "bg-amber-400/20 text-amber-300 border border-amber-400/30"
                          : "text-amber-400 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {isZenMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1 font-mono text-xs font-bold text-zinc-100 select-none px-1.5">
                      <span className="text-[#f59e0b]">{currentSlideIndex + 1}</span>
                      <span className="text-zinc-500">/</span>
                      <span>{presentationSlides.length}</span>
                    </div>
                    <div className="h-3.5 w-px bg-[#f3eee6]/15 mx-0.5" />
                    <span
                      title="Controlled by Tutor"
                      aria-label="Controlled by Tutor"
                      className="p-1 text-amber-400/80"
                    >
                      <Lock className="w-3 h-3" />
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Annotation Tools Bar (Directly between Math Canvas & Fit, off the whiteboard screen) */}
            {canDraw && (
              <div
                data-testid="header-annotation-toolbar"
                className="flex items-center gap-0.5 sm:gap-1 bg-[#1a1814] px-1 sm:px-1.5 py-1 rounded-xl border border-[#f3eee6]/15 shrink-0 shadow-inner"
              >
                <button
                  type="button"
                  onClick={() => selectTool("select")}
                  title="Select (V)"
                  aria-label="Select Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "select"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <MousePointer className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("hand")}
                  title="Hand / Pan (H)"
                  aria-label="Hand Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "hand"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Hand className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("draw")}
                  title="Pen (P)"
                  aria-label="Draw Tool"
                  className={`relative p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "draw"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span
                    className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full border border-black/40 shadow-xs"
                    style={{ backgroundColor: activeColorHex }}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("eraser")}
                  title="Eraser (E)"
                  aria-label="Eraser Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "eraser"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {/* Quick Pen Color Swatches & More Colors / Sizes Menu */}
                <div
                  data-testid="header-pen-color-picker"
                  className="flex items-center gap-1 px-1 bg-[#16130f] py-0.5 rounded-lg border border-[#f3eee6]/10 mx-0.5"
                >
                  {/* 4 Quick One-Click Colors (Black, Blue, Red, Green) */}
                  {[
                    { id: "black", hex: "#1e1e1e", label: "Black" },
                    { id: "blue", hex: "#2f80ed", label: "Blue" },
                    { id: "red", hex: "#eb5757", label: "Red" },
                    { id: "green", hex: "#27ae60", label: "Green" },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectColor(c.id)}
                      title={`Pen Color: ${c.label}`}
                      aria-label={`Select ${c.label} Color`}
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all cursor-pointer border flex items-center justify-center active:scale-90 ${
                        activeColor === c.id
                          ? "ring-2 ring-[#f59e0b] scale-110 border-white shadow-sm"
                          : "border-white/20 hover:scale-105 hover:border-white/60"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    >
                      {activeColor === c.id && (
                        <span className="w-1 h-1 rounded-full bg-white shadow-xs" />
                      )}
                    </button>
                  ))}

                  {/* More Colors & Stroke Width Popover Trigger */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsColorMenuOpen(!isColorMenuOpen)}
                      title="More Colors & Stroke Thickness"
                      aria-label="Pen Colors and Stroke Sizes"
                      className={`p-1 rounded-md transition-colors cursor-pointer flex items-center justify-center ${
                        isColorMenuOpen ? "bg-[#f59e0b]/20 text-[#f59e0b]" : "text-zinc-400 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <Palette className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>

                    {/* High-Contrast Obsidian Style & Color Dropdown Popover */}
                    {isColorMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-[200]"
                          onClick={() => setIsColorMenuOpen(false)}
                        />
                        <div
                          style={{ backgroundColor: "#16130f", color: "#f3eee6" }}
                          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-[#16130f] border border-[#f59e0b]/30 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] z-[250] flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
                        >
                          {/* Popover Header */}
                          <div className="flex items-center justify-between border-b border-[#f3eee6]/10 pb-1.5">
                            <span className="text-[11px] font-mono uppercase tracking-wider text-[#f59e0b] font-bold flex items-center gap-1.5">
                              <Palette className="w-3 h-3 text-[#f59e0b]" />
                              Pen Color & Thickness
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsColorMenuOpen(false)}
                              className="p-1 text-zinc-400 hover:text-white rounded-md transition cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Section 1: All 12 Pen Colors */}
                          <div>
                            <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                              Colors
                            </div>
                            <div className="grid grid-cols-6 gap-2">
                              {PEN_COLORS.map((col) => (
                                <button
                                  key={col.id}
                                  type="button"
                                  onClick={() => {
                                    selectColor(col.id);
                                    setIsColorMenuOpen(false);
                                  }}
                                  title={col.label}
                                  className={`w-7 h-7 rounded-full border transition cursor-pointer flex items-center justify-center relative active:scale-95 ${
                                    activeColor === col.id
                                      ? "ring-2 ring-[#f59e0b] ring-offset-2 ring-offset-[#16130f] border-white scale-110 shadow-md"
                                      : "border-white/20 hover:scale-105 hover:border-white/60"
                                  }`}
                                  style={{ backgroundColor: col.hex }}
                                >
                                  {activeColor === col.id && (
                                    <Check className={`w-3.5 h-3.5 ${col.id === "white" || col.id === "yellow" ? "text-black" : "text-white"}`} />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Section 2: Stroke Thickness (S, M, L, XL) */}
                          <div>
                            <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                              Stroke Thickness
                            </div>
                            <div className="grid grid-cols-4 gap-1.5 bg-[#221f1a] p-1 rounded-xl border border-[#f3eee6]/10">
                              {PEN_SIZES.map((sz) => (
                                <button
                                  key={sz.id}
                                  type="button"
                                  onClick={() => {
                                    selectSize(sz.id);
                                    setIsColorMenuOpen(false);
                                  }}
                                  title={`${sz.label} stroke`}
                                  className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 ${
                                    activeSize === sz.id
                                      ? "bg-[#f59e0b] text-[#16130f] font-bold shadow-sm"
                                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                                  }`}
                                >
                                  <span
                                    className="rounded-full mb-1"
                                    style={{
                                      width: `${sz.strokePx * 2}px`,
                                      height: `${sz.strokePx}px`,
                                      backgroundColor: activeSize === sz.id ? "#16130f" : activeColorHex,
                                    }}
                                  />
                                  <span className="text-[10px] uppercase font-mono">{sz.id}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="h-4 w-px bg-[#f3eee6]/15 mx-0.5" />

                <button
                  type="button"
                  onClick={() => selectTool("arrow")}
                  title="Arrow (A)"
                  aria-label="Arrow Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "arrow"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("text")}
                  title="Text (T)"
                  aria-label="Text Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "text"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Type className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("note")}
                  title="Sticky Note (N)"
                  aria-label="Sticky Note Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "note"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <StickyNote className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Import Image, PDF or PPT slide"
                  aria-label="Import Image or Slide"
                  className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer flex items-center justify-center active:scale-95"
                >
                  <ImageIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => selectTool("geo")}
                  title="Shape (R)"
                  aria-label="Shape Tool"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                    activeTool === "geo"
                      ? "bg-[#2f80ed] text-white shadow-sm font-bold scale-105"
                      : "text-zinc-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Right: Quick Action Pills ([Fit] [Full]) + Close */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Quick Action Pill 1: Fit */}
            <button
              onClick={handleZoomToFit}
              title="Fit drawings to screen"
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#f3eee6] bg-[#221f1a] hover:bg-[#2a2721] border border-[#f3eee6]/15 hover:border-amber-400/40 rounded-lg transition shrink-0 cursor-pointer active:scale-95"
            >
              <ZoomIn className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span className="font-mono text-[11px]">Fit</span>
            </button>

            {/* Quick Action Pill 2: Full (Fullscreen Toggle) */}
            <button
              onClick={() => {
                if (onToggleFullscreen) {
                  onToggleFullscreen();
                } else {
                  setIsExpanded(!isExpanded);
                }
              }}
              title={isFullscreen || isExpanded ? "Exit Fullscreen" : "Maximize (Full Screen)"}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#f3eee6] bg-[#221f1a] hover:bg-[#2a2721] border border-[#f3eee6]/15 hover:border-amber-400/40 rounded-lg transition shrink-0 cursor-pointer active:scale-95"
            >
              {isFullscreen || isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5 text-[#f59e0b]" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-[#f59e0b]" />
              )}
              <span className="font-mono text-[11px] hidden sm:inline">Full</span>
            </button>

            {/* Close Button (Host only) */}
            {isHost && (
              <>
                <div className="h-4 w-px bg-[#f3eee6]/10 mx-0.5" />
                <button
                  onClick={onClose}
                  title="Close Whiteboard for Classroom"
                  className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] hover:bg-white/5 rounded-lg transition shrink-0 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* TLDraw Interactive Surface */}
      <div
        className={`flex-1 min-h-0 w-full relative bg-[#0e0d0b] overflow-hidden ${
          // With slides open, the space around the fitted slide is dark (letterbox), so a slide that doesn't
          // match the screen's shape still looks like one clean slide on any screen size.
          presentationSlides.length > 0 ? "[&_.tl-background]:bg-[#0e0d0b]" : ""
        }`}
        onMouseMove={resetControlsTimeout}
      >
        {/* Tutor slide strip: sits at the top of the board, over the canvas */}
        {isHost && editor && isSlideStripOpen && presentationSlides.length > 0 && (
          <SlideStrip
            editor={editor}
            slides={presentationSlides}
            currentIndex={currentSlideIndex}
            onAction={handleSlideAction}
            onClose={() => setIsSlideStripOpen(false)}
          />
        )}
        {/* Zen Mode Exit Indicator */}
        {isZenMode && (
          <button
            onClick={() => setIsZenMode(false)}
            title="Exit Zen Mode (Press Z or Esc)"
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#16130f]/95 border border-[#f59e0b]/40 text-xs font-semibold text-zinc-200 hover:text-white shadow-2xl backdrop-blur-md transition-all duration-300 ${
              isControlsVisible ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"
            }`}
          >
            <EyeOff className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span>Exit Zen Mode (Z)</span>
          </button>
        )}

        <Tldraw
          shapeUtils={customShapeUtils}
          onMount={handleMount}
          autoFocus={false}
          hideUi={!canDraw || isZenMode} /* hideUi={!canDraw} */
          components={customComponents}
        />
      </div>

      {/* Bottom Whiteboard Screen Frame / Boundary Bar */}
      {!hideTopBar && (!isZenMode || isControlsVisible) && (
        <div className="h-7 px-3 bg-[#16130f] border-t border-[#f3eee6]/10 flex items-center justify-between text-[10px] font-mono text-zinc-400 shrink-0 select-none z-20">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-zinc-300 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Whiteboard
            </span>
            <span className="text-zinc-600">•</span>
            <span className="text-zinc-400 truncate max-w-[140px] sm:max-w-none">
              {presentationSlides.length > 0
                ? `Slide ${currentSlideIndex + 1} of ${presentationSlides.length}`
                : isHost
                ? "16:9 Canvas Active"
                : "Host Whiteboard View"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleZoomToFit}
              title="Align canvas to whiteboard screen boundary"
              className="text-[#f59e0b] hover:text-amber-400 font-semibold flex items-center gap-1 cursor-pointer transition active:scale-95"
            >
              <Maximize2 className="w-3 h-3 text-[#f59e0b]" />
              <span>Fit Screen</span>
            </button>
            {onToggleFullscreen && isMobile && (
              <>
                <span className="text-zinc-700">|</span>
                <button
                  onClick={onToggleFullscreen}
                  title="Expand whiteboard to full screen"
                  className="text-zinc-300 hover:text-white font-semibold flex items-center gap-1 cursor-pointer transition active:scale-95"
                >
                  <Minimize2 className="w-3 h-3 text-zinc-400" />
                  <span>{isFullscreen ? "Exit Full" : "Full View"}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
