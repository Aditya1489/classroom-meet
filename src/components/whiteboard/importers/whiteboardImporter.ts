import { Editor, AssetRecordType, createShapeId, TLAsset, TLShapePartial, TLShapeId } from "tldraw";

// Lazy-loaded PDF.js runtime to prevent bundler pollution and ensure compatibility with older WebViews
async function getLazyPdfJs() {
  if (typeof (globalThis as any).Iterator === "undefined") {
    (globalThis as any).Iterator = class Iterator {};
  }
  const pdfjsLib = await import("pdfjs-dist");
  try {
    const pdfWorkerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    const pdfWorker: string = typeof pdfWorkerModule === "string" ? pdfWorkerModule : (pdfWorkerModule as any).default || String(pdfWorkerModule);
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
  } catch (e) {
    console.warn("[WhiteboardImporter] Failed to set local workerSrc, using fallback", e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

export interface ImportItem {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
}

export interface PresentationSlide {
  index: number;
  pageNumber: number;
  totalCount: number;
  title: string;
  shapeId: TLShapeId;
  assetId: string;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface ImportResult {
  success: boolean;
  type: "image" | "pdf" | "pptx" | "unknown";
  count: number;
  shapeIds: TLShapeId[];
  slides?: PresentationSlide[];
  error?: string;
}

/**
 * Optimizes and extracts dimensions for an image file (.png, .jpg, .webp, .svg)
 */
async function parseImageFile(file: File): Promise<ImportItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to decode image data"));
      img.onload = () => {
        const naturalW = img.naturalWidth || 800;
        const naturalH = img.naturalHeight || 600;

        // Downscale oversized images (> 1600px) to conserve canvas memory and websocket payload
        const maxDimension = 1600;
        if (naturalW > maxDimension || naturalH > maxDimension) {
          const ratio = Math.min(maxDimension / naturalW, maxDimension / naturalH);
          const targetW = Math.round(naturalW * ratio);
          const targetH = Math.round(naturalH * ratio);

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, targetW, targetH);
            const optimizedDataUrl = canvas.toDataURL(file.type.includes("png") ? "image/png" : "image/jpeg", 0.88);
            resolve({
              dataUrl: optimizedDataUrl,
              width: targetW,
              height: targetH,
              title: file.name,
            });
            return;
          }
        }

        resolve({
          dataUrl: reader.result as string,
          width: naturalW,
          height: naturalH,
          title: file.name,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Parses and renders PDF pages into high-res canvas images
 */
async function parsePdfFile(
  file: File,
  onProgress?: (progress: number, msg: string) => void
): Promise<ImportItem[]> {
  const pdfjsLib = await getLazyPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  onProgress?.(0.1, "Opening PDF document...");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  if (numPages === 0) throw new Error("The PDF file contains no pages.");

  // Cap at 40 pages to prevent browser memory exhaustion in a single import
  const maxPages = Math.min(numPages, 40);
  const items: ImportItem[] = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const progressPct = 0.1 + (pageNum / maxPages) * 0.85;
    onProgress?.(progressPct, `Rendering page ${pageNum} of ${maxPages}...`);

    const page = await pdf.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });

    // Target ~1280px width for crystal-clear readability on zoomable whiteboard
    const targetWidth = 1280;
    const scale = targetWidth / Math.max(unscaledViewport.width, 1);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create 2D canvas context");

    await page.render({
      canvasContext: context,
      canvas,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    items.push({
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      title: `${file.name.replace(/\.[^/.]+$/, "")} - Page ${pageNum}`,
    });
  }

  return items;
}

/**
 * Parses and renders PPTX presentation slides into high-res canvas images
 */
async function parsePptxFile(
  file: File,
  onProgress?: (progress: number, msg: string) => void
): Promise<ImportItem[]> {
  const isLegacyPpt = file.name.toLowerCase().endsWith(".ppt");
  if (isLegacyPpt) {
    throw new Error(
      "Legacy PowerPoint (.ppt) detected. Please save your file as modern .pptx or export to .pdf, then import."
    );
  }

  const { PptxRenderer } = await import("pptx-browser");
  const renderer = new PptxRenderer();
  try {
    onProgress?.(0.1, "Decompressing presentation deck...");
    const buffer = await file.arrayBuffer();

    await renderer.load(buffer, (p, msg) => {
      onProgress?.(0.1 + p * 0.3, msg || "Parsing slide templates...");
    });

    const slideCount = renderer.slideCount;
    if (!slideCount || slideCount === 0) {
      throw new Error("No slides found in presentation.");
    }

    const maxSlides = Math.min(slideCount, 40);
    const items: ImportItem[] = [];

    const aspect = (renderer.slideSize?.cy || 5143500) / (renderer.slideSize?.cx || 9144000);
    const slideW = 1280;
    const slideH = Math.round(slideW * aspect);

    for (let i = 0; i < maxSlides; i++) {
      const progressPct = 0.4 + ((i + 1) / maxSlides) * 0.55;
      onProgress?.(progressPct, `Rendering slide ${i + 1} of ${maxSlides}...`);

      const dataUrl = await renderer.toDataURL(i, slideW, "image/jpeg", 0.88);
      items.push({
        dataUrl,
        width: slideW,
        height: slideH,
        title: `${file.name.replace(/\.[^/.]+$/, "")} - Slide ${i + 1}`,
      });
    }

    return items;
  } finally {
    renderer.destroy();
  }
}

/**
 * Main importer: Parses PNG, PDF, or PPT/PPTX and positions slides onto tldraw whiteboard
 */
export async function importFileToWhiteboard(
  file: File,
  editor: Editor,
  onProgress?: (progress: number, msg: string) => void
): Promise<ImportResult> {
  const fileName = file.name.toLowerCase();
  let type: "image" | "pdf" | "pptx" | "unknown" = "unknown";
  let items: ImportItem[] = [];

  try {
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg|gif)$/i.test(fileName)) {
      type = "image";
      onProgress?.(0.5, "Processing image...");
      const item = await parseImageFile(file);
      items = [item];
    } else if (file.type === "application/pdf" || /\.pdf$/i.test(fileName)) {
      type = "pdf";
      items = await parsePdfFile(file, onProgress);
    } else if (
      /\.(pptx|ppt)$/i.test(fileName) ||
      file.type.includes("presentation") ||
      file.type.includes("powerpoint")
    ) {
      type = "pptx";
      items = await parsePptxFile(file, onProgress);
    } else {
      throw new Error(`Unsupported file type: ${file.name}. Please select a PDF, PPTX, or Image file.`);
    }

    if (items.length === 0) {
      throw new Error("No importable visual content was found in this file.");
    }

    onProgress?.(0.95, "Placing slides on whiteboard canvas...");

    // Determine layout geometry relative to current viewport
    const viewportBounds = editor.getViewportPageBounds();
    const center = viewportBounds.center;

    const baseDisplayWidth = 840; // Default readable slide width on tldraw
    const gap = 50; // Spacing between slides

    const assetsToCreate: TLAsset[] = [];
    const shapesToCreate: TLShapePartial[] = [];
    const shapeIds: TLShapeId[] = [];
    const slides: PresentationSlide[] = [];

    // Full-screen presentation slide dimensions:
    // High-definition 1600px width ensures crystal-clear mathematical text and formulas
    const slideW = 1600;
    const slideGap = 1200; // Wide gap prevents adjacent slides from entering viewport when zoomed

    if (items.length === 1) {
      // Single slide / image: Center directly in current viewport
      const item = items[0];
      const displayW = Math.min(slideW, item.width > 800 ? item.width : 1200);
      const displayH = Math.round(displayW * (item.height / Math.max(item.width, 1)));
      const posX = center.x - displayW / 2;
      const posY = center.y - displayH / 2;

      const assetId = AssetRecordType.createId();
      const shapeId = createShapeId();
      shapeIds.push(shapeId);

      assetsToCreate.push({
        id: assetId,
        typeName: "asset",
        type: "image",
        props: {
          name: item.title,
          src: item.dataUrl,
          w: item.width,
          h: item.height,
          mimeType: "image/jpeg",
          isAnimated: false,
        },
        meta: {},
      });

      shapesToCreate.push({
        id: shapeId,
        type: "image",
        x: posX,
        y: posY,
        isLocked: true, // Lock background image so tutor & students can draw on top without dragging slide
        props: {
          assetId,
          w: displayW,
          h: displayH,
          playing: true,
          url: "",
          crop: null,
          flipX: false,
          flipY: false,
          altText: item.title,
        },
      });

      slides.push({
        index: 0,
        pageNumber: 1,
        totalCount: 1,
        title: item.title,
        shapeId,
        assetId: String(assetId),
        bounds: { x: posX, y: posY, w: displayW, h: displayH },
      });
    } else {
      // Multi-page document / presentation:
      // Arrange along a linear presentation track for 1-slide-at-a-time presentation mode
      items.forEach((item, index) => {
        const currentDisplayH = Math.round(slideW * (item.height / Math.max(item.width, 1)));
        const posX = center.x + index * (slideW + slideGap);
        const posY = center.y - currentDisplayH / 2;

        const assetId = AssetRecordType.createId();
        const shapeId = createShapeId();
        shapeIds.push(shapeId);

        assetsToCreate.push({
          id: assetId,
          typeName: "asset",
          type: "image",
          props: {
            name: item.title,
            src: item.dataUrl,
            w: item.width,
            h: item.height,
            mimeType: "image/jpeg",
            isAnimated: false,
          },
          meta: {},
        });

        shapesToCreate.push({
          id: shapeId,
          type: "image",
          x: posX,
          y: posY,
          isLocked: true, // Lock slide so annotations can be drawn directly on it
          props: {
            assetId,
            w: slideW,
            h: currentDisplayH,
            playing: true,
            url: "",
            crop: null,
            flipX: false,
            flipY: false,
            altText: item.title,
          },
        });

        slides.push({
          index,
          pageNumber: index + 1,
          totalCount: items.length,
          title: item.title,
          shapeId,
          assetId: String(assetId),
          bounds: { x: posX, y: posY, w: slideW, h: currentDisplayH },
        });
      });
    }

    // Atomically create assets & shapes in tldraw editor
    editor.createAssets(assetsToCreate);
    editor.createShapes(shapesToCreate);

    // Zoom directly onto Slide 1 edge-to-edge for full-bleed presentation
    try {
      if (slides.length > 0) {
        editor.zoomToBounds(slides[0].bounds, { inset: 0, animation: { duration: 300 }, force: true });
      }
    } catch {
      editor.setSelectedShapes(shapeIds);
      try {
        editor.zoomToFit({ animation: { duration: 300 } });
      } catch {}
    }

    return {
      success: true,
      type,
      count: items.length,
      shapeIds,
      slides,
    };
  } catch (err: any) {
    console.error("[WhiteboardImporter] Import error:", err);
    return {
      success: false,
      type,
      count: 0,
      shapeIds: [],
      error: err?.message || "Failed to import file onto whiteboard",
    };
  }
}
