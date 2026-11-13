/// <reference types="vite/client" />

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}

interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  window: Window | null;
  onenter: ((this: DocumentPictureInPicture, ev: Event) => any) | null;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
  CaptureController?: {
    new (): {
      setFocusBehavior(behavior: "focus-captured-surface" | "no-focus-change"): void;
    };
  };
}

declare module 'pptx-browser' {
  export class PptxRenderer {
    slideCount: number;
    slideSize: { cx: number; cy: number };
    load(source: File | Blob | ArrayBuffer | Uint8Array, onProgress?: (progress: number, msg: string) => void): Promise<void>;
    renderSlide(slideIndex: number, canvas: HTMLCanvasElement | any, width?: number): Promise<void>;
    toDataURL(slideIndex: number, width?: number, format?: string, quality?: number): Promise<string>;
    destroy(): void;
  }
}
