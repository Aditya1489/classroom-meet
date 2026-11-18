/**
 * Uploads a class recording to the tutor's own Google Drive and returns a shareable view link.
 * Uses Google Identity Services with the narrow drive.file scope (only files this app creates).
 * Needs VITE_GOOGLE_CLIENT_ID, and the page origin listed in that OAuth client's JavaScript origins.
 */
const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoading = null;
        reject(new Error("Could not load Google sign-in. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/** Must be called from a click: Google's consent popup needs the user gesture. */
export async function getDriveAccessToken(): Promise<string> {
  const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google Drive is not configured (VITE_GOOGLE_CLIENT_ID is missing).");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: any) =>
        resp?.access_token ? resolve(resp.access_token) : reject(new Error(resp?.error_description || "Google Drive access was not granted.")),
      error_callback: (err: any) => reject(new Error(err?.message || "Google Drive sign-in was cancelled.")),
    });
    client.requestAccessToken();
  });
}

/** Resumable upload (handles large videos), then makes the file viewable by anyone with the link. */
export async function uploadRecordingToDrive(
  accessToken: string,
  blob: Blob,
  fileName: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "X-Upload-Content-Type": blob.type || "video/webm" },
    body: JSON.stringify({ name: fileName, mimeType: blob.type || "video/webm" }),
  });
  const uploadUrl = init.headers.get("Location");
  if (!init.ok || !uploadUrl) throw new Error(`Google Drive refused the upload (${init.status}).`);

  const file: { id: string; webViewLink?: string } = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Unexpected response from Google Drive."));
        }
      } else reject(new Error(`Upload to Google Drive failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading to Google Drive."));
    xhr.send(blob);
  });

  // Students open it from the class page, so anyone with the link may view (not edit).
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
}
