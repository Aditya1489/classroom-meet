/**
 * Local meeting recording (saved to the user's computer).
 *
 * Video: the meeting tab (or a screen/window the user picks) via getDisplayMedia.
 * Audio: a Web Audio mix of everyone in the call. Remote participants' microphones and screen-share
 * audio are mixed straight from their WebRTC tracks, plus the local microphone (which is never played
 * back in the tab, so tab audio alone would miss the recorder's own voice). If the captured surface
 * already carries audio (the user ticked "share tab audio"), that audio is used instead of the remote
 * tracks so remote voices aren't recorded twice.
 */

export const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

/** Picks the first container/codec the browser's MediaRecorder supports, or "" for the browser default. */
export function chooseRecordingMimeType(isTypeSupported: (mime: string) => boolean): string {
  for (const mime of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Some browsers throw for unknown types; try the next one.
    }
  }
  return "";
}

/** "mathsy-meet-abc-defg-hij-2026-11-18_03-45-12.webm" (filesystem-safe on every OS). */
export function buildRecordingFileName(meetingCode: string, mimeType: string, at: Date = new Date()): string {
  const safeCode = (meetingCode || "meeting").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "meeting";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  return `mathsy-meet-${safeCode}-${stamp}.${ext}`;
}

/**
 * Which audio tracks to feed into the recording mix. Tracks are de-duplicated by id and ended tracks are
 * dropped. When the captured surface has its own audio, remote tracks are skipped (already audible in it).
 */
export function selectRecordingAudioTracks(input: {
  displayAudio: MediaStreamTrack[];
  localMic: MediaStreamTrack | null;
  remote: Array<MediaStreamTrack | null | undefined>;
}): MediaStreamTrack[] {
  const live = (t: MediaStreamTrack | null | undefined): t is MediaStreamTrack => Boolean(t) && t!.readyState === "live";
  const picked = new Map<string, MediaStreamTrack>();
  const displayHasAudio = input.displayAudio.some(live);
  for (const t of input.displayAudio) if (live(t)) picked.set(t.id, t);
  if (live(input.localMic)) picked.set(input.localMic.id, input.localMic);
  if (!displayHasAudio) for (const t of input.remote) if (live(t)) picked.set(t.id, t);
  return Array.from(picked.values());
}

export interface LocalRecorderCallbacks {
  /** The capture ended without stop() being called (e.g. the browser's "Stop sharing" button). */
  onCaptureEnded?: () => void;
  onError?: (message: string) => void;
}

export class LocalMeetingRecorder {
  private displayStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mixDestination: MediaStreamAudioDestinationNode | null = null;
  private connectedSources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "";
  private meetingCode: string;
  private callbacks: LocalRecorderCallbacks;
  private stopping: Promise<Blob | null> | null = null;
  private latestAudio: { localMic: MediaStreamTrack | null; remote: Array<MediaStreamTrack | null | undefined> } = {
    localMic: null,
    remote: [],
  };

  constructor(meetingCode: string, callbacks: LocalRecorderCallbacks = {}) {
    this.meetingCode = meetingCode;
    this.callbacks = callbacks;
  }

  get isRecording(): boolean {
    return Boolean(this.recorder && this.recorder.state !== "inactive");
  }

  /**
   * Starts recording. Must be called directly from a click handler (getDisplayMedia needs the user gesture).
   * Resolves false if the user cancelled the picker or recording isn't supported.
   */
  async start(audio: { localMic: MediaStreamTrack | null; remote: Array<MediaStreamTrack | null | undefined> }): Promise<boolean> {
    if (this.isRecording) return true;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      this.callbacks.onError?.("Recording isn't supported in this browser. Please use desktop Chrome, Edge or Firefox.");
      return false;
    }

    this.latestAudio = audio;
    try {
      this.displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
        // Offer "this tab" first, the way Google Meet records the meeting.
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
        systemAudio: "include",
      } as any);
    } catch (err: any) {
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        this.callbacks.onError?.(err?.message || "Could not start screen capture for recording.");
      }
      this.cleanup();
      return false;
    }

    const videoTrack = this.displayStream.getVideoTracks()[0];
    if (!videoTrack) {
      this.callbacks.onError?.("No video was captured for the recording.");
      this.cleanup();
      return false;
    }
    videoTrack.addEventListener("ended", () => {
      if (this.isRecording && !this.stopping) this.callbacks.onCaptureEnded?.();
    });

    // Audio mix
    const AudioCtx: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
    const outputTracks: MediaStreamTrack[] = [videoTrack];
    if (AudioCtx) {
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume().catch(() => {});
      }
      this.mixDestination = this.audioContext.createMediaStreamDestination();
      this.syncAudioSources();
      const mixed = this.mixDestination.stream.getAudioTracks()[0];
      if (mixed) outputTracks.push(mixed);
    } else {
      // No Web Audio: fall back to whatever audio the capture itself has.
      outputTracks.push(...this.displayStream.getAudioTracks());
    }

    this.mimeType = chooseRecordingMimeType((m) => MediaRecorder.isTypeSupported(m));
    try {
      this.recorder = new MediaRecorder(new MediaStream(outputTracks), {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      });
    } catch (err: any) {
      this.callbacks.onError?.(err?.message || "The browser could not start the recorder.");
      this.cleanup();
      return false;
    }
    this.mimeType = this.recorder.mimeType || this.mimeType || "video/webm";
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    // 1s timeslice: a crash or closed tab loses at most the last second, and memory stays chunked.
    this.recorder.start(1000);
    return true;
  }

  /** Keeps the audio mix in step with who is in the call and whether the local mic is on. */
  updateAudio(audio: { localMic: MediaStreamTrack | null; remote: Array<MediaStreamTrack | null | undefined> }) {
    this.latestAudio = audio;
    if (this.isRecording) this.syncAudioSources();
  }

  private syncAudioSources() {
    if (!this.audioContext || !this.mixDestination) return;
    const wanted = selectRecordingAudioTracks({
      displayAudio: this.displayStream?.getAudioTracks() || [],
      localMic: this.latestAudio.localMic,
      remote: this.latestAudio.remote,
    });
    const wantedIds = new Set(wanted.map((t) => t.id));
    for (const [id, node] of this.connectedSources) {
      if (!wantedIds.has(id)) {
        try {
          node.disconnect();
        } catch {}
        this.connectedSources.delete(id);
      }
    }
    for (const track of wanted) {
      if (this.connectedSources.has(track.id)) continue;
      try {
        const node = this.audioContext.createMediaStreamSource(new MediaStream([track]));
        node.connect(this.mixDestination);
        this.connectedSources.set(track.id, node);
      } catch (err) {
        console.warn("[LocalRecorder] Could not add audio source to recording:", err);
      }
    }
  }

  /** Stops recording and returns the finished file (null if nothing was recorded). Safe to call twice. */
  stop(): Promise<Blob | null> {
    if (this.stopping) return this.stopping;
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.cleanup();
      return Promise.resolve(null);
    }
    this.stopping = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = this.chunks.length ? new Blob(this.chunks, { type: this.mimeType || "video/webm" }) : null;
        this.cleanup();
        resolve(blob);
      };
      try {
        recorder.requestData();
      } catch {}
      recorder.stop();
    });
    return this.stopping;
  }

  /** Stops and downloads the recording. Returns the file name, or null if there was nothing to save. */
  /** Stops and returns the file without downloading, so the caller can upload or download it. */
  async stopAndGetFile(): Promise<{ blob: Blob; fileName: string } | null> {
    const mime = this.mimeType;
    const blob = await this.stop();
    if (!blob || blob.size === 0) return null;
    return { blob, fileName: buildRecordingFileName(this.meetingCode, mime || blob.type) };
  }

  async stopAndDownload(): Promise<string | null> {
    const mime = this.mimeType;
    const blob = await this.stop();
    if (!blob || blob.size === 0) return null;
    const fileName = buildRecordingFileName(this.meetingCode, mime || blob.type);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return fileName;
  }

  private cleanup() {
    for (const node of this.connectedSources.values()) {
      try {
        node.disconnect();
      } catch {}
    }
    this.connectedSources.clear();
    this.displayStream?.getTracks().forEach((t) => t.stop());
    this.displayStream = null;
    this.mixDestination = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.recorder = null;
    this.chunks = [];
    this.stopping = null;
  }
}

/** Saves a recording to the user's Downloads. */
export function downloadRecording(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
