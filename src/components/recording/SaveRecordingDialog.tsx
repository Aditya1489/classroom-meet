import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { dbClient } from "../../lib/dbClient";
import { downloadRecording } from "../../services/localRecorder";
import { getDriveAccessToken, uploadRecordingToDrive } from "../../services/driveUpload";

interface Props {
  meetingCode: string;
  file: { blob: Blob; fileName: string };
  onClose: () => void;
}

/**
 * Shown when the tutor stops recording. The video can go straight to their Google Drive, or be
 * downloaded and uploaded anywhere, then shared by link. Either way the link is saved on the class
 * so enrolled students can watch it.
 */
export function SaveRecordingDialog({ meetingCode, file, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const sizeMb = (file.blob.size / (1024 * 1024)).toFixed(1);

  const publish = async (url: string, source: "drive" | "link") => {
    const ok = await dbClient.saveRecording(meetingCode, { url, source, title: file.fileName });
    if (ok) {
      setSavedUrl(url);
      toast.success("Recording shared with your students.", { id: "rec-share" });
    } else {
      toast.error("Saved, but could not link it to the class. Paste the link below to try again.", { id: "rec-share" });
      setLink(url);
    }
  };

  const uploadToDrive = async () => {
    try {
      setBusy("Connecting to Google Drive…");
      const token = await getDriveAccessToken(); // needs this click for Google's popup
      setBusy("Uploading 0%");
      const url = await uploadRecordingToDrive(token, file.blob, file.fileName, (p) => setBusy(`Uploading ${p}%`));
      await publish(url, "drive");
    } catch (err: any) {
      toast.error(err?.message || "Upload to Google Drive failed.", { id: "rec-drive" });
    } finally {
      setBusy(null);
    }
  };

  const saveLink = async () => {
    const url = link.trim();
    if (!/^https:\/\/\S+$/i.test(url)) {
      toast.error("Paste a full https:// link to the video.");
      return;
    }
    setBusy("Saving link…");
    await publish(url, "link");
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-5 text-white shadow-2xl">
        <h3 className="text-base font-semibold">Save class recording</h3>
        <p className="mt-1 text-xs text-zinc-400">
          {file.fileName} · {sizeMb} MB
        </p>

        {savedUrl ? (
          <p className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">
            Students can now watch this recording from the class page.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <Button disabled={!!busy} onClick={uploadToDrive}>
              {busy || "Upload to my Google Drive & share"}
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                downloadRecording(file.blob, file.fileName);
                setDownloaded(true);
              }}
            >
              {downloaded ? "Downloaded ✓ (download again)" : "Download to my computer"}
            </Button>
            <div className="mt-2 rounded-xl border border-white/10 p-3">
              <p className="text-xs text-zinc-400">
                Uploaded it yourself (Drive, YouTube…)? Paste the share link so students can watch it.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://drive.google.com/…"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-amber-500"
                />
                <Button size="sm" disabled={!!busy || !link.trim()} onClick={saveLink}>
                  Share
                </Button>
              </div>
            </div>
          </div>
        )}

        <Button
          variant="ghost"
          className="mt-3 w-full"
          disabled={!!busy}
          onClick={() => {
            if (!savedUrl && !downloaded && !window.confirm("Close without saving? The recording will be lost.")) return;
            onClose();
          }}
        >
          {savedUrl ? "Done" : "Close"}
        </Button>
      </div>
    </div>
  );
}
