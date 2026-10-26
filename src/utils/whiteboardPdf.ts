import { Editor } from "tldraw";
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

    const svgResult = await targetEditor.getSvgString(shapeIds);
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
          pdf.save(fileName);
          URL.revokeObjectURL(url);
          resolve(true);
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
  } catch (err: any) {
    console.error("[WhiteboardPDF] Export error:", err);
    throw err;
  }
}
