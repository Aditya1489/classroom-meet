import { Box, Editor, TLShapeId } from "tldraw";
import { jsPDF } from "jspdf";

// Store the latest active editor instance or snapshot for post-class export
let currentActiveEditor: Editor | null = null;
let latestWhiteboardSnapshot: any = null;

export function registerWhiteboardEditor(editor: Editor | null) {
  currentActiveEditor = editor;
}

export function setLatestWhiteboardSnapshot(snapshot: any) {
  latestWhiteboardSnapshot = snapshot;
}

export function getLatestWhiteboardEditor(): Editor | null {
  return currentActiveEditor;
}

export function getLatestWhiteboardSnapshot(): any {
  return latestWhiteboardSnapshot;
}

export async function exportWhiteboardToPdf(
  editor?: Editor | null,
  fileName = `Mathsy_Whiteboard_Notes_${new Date().toISOString().split("T")[0]}.pdf`
): Promise<boolean> {
  try {
    const targetEditor = editor || currentActiveEditor;

    if (!targetEditor) {
      // Fallback: create a basic class summary PDF if no editor was mounted
      const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720] });
      doc.setFillColor(248, 246, 240);
      doc.rect(0, 0, 1280, 720, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(30, 30, 30);
      doc.text("Mathsy Classroom Notes", 50, 70);
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      doc.text(`Class session concluded at ${new Date().toLocaleString()}`, 50, 110);
      doc.text("Whiteboard session had no active shapes.", 50, 140);
      doc.save(fileName);
      return true;
    }

    const shapeIds = Array.from(targetEditor.getCurrentPageShapeIds());
    if (shapeIds.length === 0) {
      const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720] });
      doc.setFillColor(248, 246, 240);
      doc.rect(0, 0, 1280, 720, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(30, 30, 30);
      doc.text("Mathsy Classroom Notes", 50, 70);
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      doc.text(`Exported on ${new Date().toLocaleString()}`, 50, 110);
      doc.text("Canvas was blank during this session.", 50, 140);
      doc.save(fileName);
      return true;
    }

    const pdf = await renderWhiteboardPdf(targetEditor);
    if (pdf) pdf.save(fileName);
    return true;
  } catch (err: any) {
    console.error("[WhiteboardPDF] Export error:", err);
    throw err;
  }
}

// Pages of an imported PDF / slide deck on the whiteboard (page coordinates), set by the Whiteboard.
let currentSlides: { x: number; y: number; w: number; h: number }[] = [];
export function registerWhiteboardSlides(slides?: { bounds?: { x: number; y: number; w: number; h: number } }[] | null) {
  currentSlides = (slides || []).map((s) => s.bounds!).filter((b) => b && b.w > 0 && b.h > 0);
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG into image for PDF rendering"));
    };
    img.src = url;
  });
}

/** One PDF page per imported page/slide, with everything written on it (all pages as one image is too big to draw). */
async function renderSlidesPdf(editor: Editor, shapeIds: TLShapeId[]): Promise<jsPDF | null> {
  let pdf: jsPDF | null = null;
  for (const b of currentSlides) {
    const onSlide = shapeIds.filter((id) => {
      const sb = editor.getShapePageBounds(id);
      return !!sb && sb.maxX > b.x && sb.x < b.x + b.w && sb.maxY > b.y && sb.y < b.y + b.h;
    });
    if (onSlide.length === 0) continue;
    const svgResult = await editor.getSvgString(onSlide, {
      bounds: new Box(b.x, b.y, b.w, b.h),
      padding: 0,
      background: true,
      scale: Math.min(1, 1600 / b.w),
    });
    if (!svgResult?.svg) continue;
    const img = await loadSvgImage(svgResult.svg);
    const w = Math.max(1, Math.round(svgResult.width));
    const h = Math.max(1, Math.round(svgResult.height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const orientation = w >= h ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [w, h] });
    else pdf.addPage([w, h], orientation);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, w, h);
  }
  return pdf;
}

/** Draws the current whiteboard page into a PDF; null when the page is blank. */
async function renderWhiteboardPdf(editor: Editor): Promise<jsPDF | null> {
  const shapeIds = Array.from(editor.getCurrentPageShapeIds());
  if (shapeIds.length === 0) return null;
  if (currentSlides.length > 0) {
    const slidesPdf = await renderSlidesPdf(editor, shapeIds);
    if (slidesPdf) return slidesPdf;
  }
  const svgResult = await editor.getSvgString(shapeIds);
  if (!svgResult || !svgResult.svg) {
    throw new Error("Could not render whiteboard SVG content");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgResult.svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      try {
        const width = Math.max(svgResult.width || 1280, 800);
        const height = Math.max(svgResult.height || 720, 600);
        const canvas = document.createElement("canvas");
        const pad = 40;
        canvas.width = Math.round(width + pad * 2);
        canvas.height = Math.round(height + pad * 2);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Failed to acquire 2D canvas context");

        // Clean white page background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw exported drawing
        ctx.drawImage(img, pad, pad, width, height);

        // Footer
        ctx.fillStyle = "#888888";
        ctx.font = "13px sans-serif";
        ctx.fillText(`Mathsy Live Class Notes • Exported ${new Date().toLocaleString()}`, pad, canvas.height - 15);

        const imgData = canvas.toDataURL("image/png");
        const orientation = canvas.width > canvas.height ? "landscape" : "portrait";
        const pdf = new jsPDF({
          orientation,
          unit: "px",
          format: [canvas.width, canvas.height],
        });
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(pdf);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG into image for PDF rendering"));
    };

    img.src = url;
  });
}

// The host's whiteboard notes, made when they end the class and handed to the host site on leave.
let pendingClassNotes: { room: string; pdf: Blob } | null = null;

export async function prepareClassNotesForHandOff(room: string): Promise<void> {
  pendingClassNotes = null;
  if (!currentActiveEditor) return;
  const pdf = await renderWhiteboardPdf(currentActiveEditor);
  if (pdf) pendingClassNotes = { room, pdf: pdf.output("blob") };
}

export function takeClassNotesPdf(room: string): Blob | undefined {
  const notes = pendingClassNotes;
  pendingClassNotes = null;
  return notes && notes.room === room ? notes.pdf : undefined;
}
