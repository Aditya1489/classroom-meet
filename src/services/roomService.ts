export interface RoomRoleResponse {
  exists: boolean;
  isOwner: boolean;
}

const getServerUrl = (): string => {
  const url = import.meta.env.VITE_MEDIASOUP_SERVER_URL || "";
  return url.replace(/\/$/, "");
};

/**
 * Creates a new meeting room on the server.
 * Requires a verified Supabase session access token.
 */
export async function createRoom(accessToken: string): Promise<{ code: string }> {
  const serverUrl = getServerUrl();
  if (!serverUrl) {
    throw new Error("Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.");
  }

  const res = await fetch(`${serverUrl}/api/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken.trim()}`,
    },
  });

  if (!res.ok) {
    let errorMsg = `Failed to create meeting room (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errorMsg = data.error;
    } catch {}
    throw new Error(errorMsg);
  }

  return res.json();
}

/**
 * Queries the role for the caller in a given room.
 * Returns { exists, isOwner }.
 */
export async function getRoomRole(code: string, accessToken?: string): Promise<RoomRoleResponse> {
  const serverUrl = getServerUrl();
  if (!serverUrl) {
    return { exists: false, isOwner: false };
  }

  const headers: Record<string, string> = {};
  if (accessToken && accessToken.trim().length > 0) {
    headers["Authorization"] = `Bearer ${accessToken.trim()}`;
  }

  try {
    const res = await fetch(`${serverUrl}/api/rooms/${encodeURIComponent(code)}/role`, {
      headers,
    });

    if (!res.ok) {
      return { exists: false, isOwner: false };
    }

    return res.json();
  } catch {
    return { exists: false, isOwner: false };
  }
}
