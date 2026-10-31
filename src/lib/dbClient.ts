/**
 * PostgreSQL Database Client for Mathsy Meet
 * Communicates with the PostgreSQL backend API (http://localhost:5001/api).
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";

function getAuthHeaders(customToken?: string, roomCode?: string): HeadersInit {
  const token =
    customToken ||
    (typeof window !== "undefined" && roomCode && window.sessionStorage.getItem(`mathsy_token_${roomCode}`)) ||
    (typeof window !== "undefined" && window.sessionStorage.getItem("mathsy_meet_embed_token")) ||
    (typeof window !== "undefined" && window.localStorage.getItem("mathsy_meet_token")) ||
    "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Database Table Types & Schema Interfaces
 */

export interface DbLiveClass {
  id: string;
  room_code: string;
  title: string;
  tutor_id?: string;
  tutor_name?: string;
  is_active: boolean;
  is_live_streaming: boolean;
  created_at?: string;
  ended_at?: string;
  metadata?: Record<string, any>;
}

export interface DbParticipant {
  id?: string;
  room_code: string;
  user_id: string;
  display_name: string;
  role: "tutor" | "student";
  joined_at?: string;
  left_at?: string;
}

export interface DbChatMessage {
  id?: string;
  room_code: string;
  sender_id: string;
  sender_name: string;
  sender_role: "tutor" | "student";
  content: string;
  timestamp: number;
  created_at?: string;
}

export interface DbPoll {
  id?: string;
  room_code: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  created_by: string;
  is_active: boolean;
  created_at?: string;
}

export interface DbWhiteboardSnapshot {
  id?: string;
  room_code: string;
  snapshot_json: any;
  updated_at?: string;
}

/**
 * PostgreSQL Database Client Helper Functions
 */
export const dbClient = {
  /**
   * Base API URL
   */
  apiBase: API_BASE,

  /**
   * Live Classes / Rooms
   */
  async getRoom(roomCode: string): Promise<DbLiveClass | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}`, {
        headers: getAuthHeaders(undefined, roomCode),
      });
      if (!res.ok) {
        if (res.status === 404) {
          const data = await res.json().catch(() => ({}));
          return data?.room || null;
        }
        console.warn("[dbClient] Failed to fetch room, status:", res.status);
        return null;
      }
      const data = await res.json();
      return data?.room || null;
    } catch (err) {
      console.warn("[dbClient] Error fetching room from PostgreSQL API:", err);
      return null;
    }
  },

  async reactivateRoom(roomCode: string): Promise<DbLiveClass | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/reactivate`, {
        method: "POST",
        headers: getAuthHeaders(undefined, roomCode),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.room || null;
    } catch (err) {
      console.error("[dbClient] Error reactivating room:", err);
      return null;
    }
  },

  async upsertRoom(room: Partial<DbLiveClass> & { room_code: string }): Promise<DbLiveClass | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms`, {
        method: "POST",
        headers: getAuthHeaders(undefined, room.room_code),
        body: JSON.stringify({
          room_code: room.room_code,
          title: room.title || `Class ${room.room_code}`,
          tutor_id: room.tutor_id,
          tutor_name: room.tutor_name,
          is_active: room.is_active ?? true,
          is_live_streaming: room.is_live_streaming ?? false,
          metadata: room.metadata || {},
        }),
      });

      if (!res.ok) {
        console.warn("[dbClient] Failed to upsert room, status:", res.status);
        return null;
      }
      const data = await res.json();
      return data?.room || null;
    } catch (err) {
      console.error("[dbClient] Error upserting room to PostgreSQL API:", err);
      return null;
    }
  },

  /**
   * Participants
   */
  async recordParticipantJoin(participant: DbParticipant): Promise<{ participant?: DbParticipant; isHost?: boolean; sessionId?: string; tutorId?: string } | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(participant.room_code)}/participants`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          user_id: participant.user_id,
          display_name: participant.display_name,
          role: participant.role,
        }),
      });
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch (err) {
      console.warn("[dbClient] Participant join error:", err);
      return null;
    }
  },

  async getParticipants(roomCode: string): Promise<DbParticipant[]> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/participants`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data?.participants || [];
    } catch (err) {
      console.warn("[dbClient] Error fetching participants:", err);
      return [];
    }
  },

  async recordParticipantLeave(roomCode: string, userId?: string, displayName?: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/leave`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          user_id: userId,
          display_name: displayName,
        }),
      });
    } catch (err) {
      console.warn("[dbClient] Error recording participant leave:", err);
    }
  },

  /**
   * Temporary In-Class Chat Messages (MongoDB)
   */
  async saveChatMessage(
    roomCode: string,
    text: string,
    clientMessageId?: string
  ): Promise<{ success: boolean; message?: any; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/chat`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text,
          clientMessageId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data?.error || "Failed to send message" };
      }
      return { success: true, message: data.message };
    } catch (err: any) {
      console.warn("[dbClient] Error saving chat message:", err);
      return { success: false, error: "Network error saving message" };
    }
  },

  async getChatHistory(
    roomCode: string
  ): Promise<{ messages: any[]; isChatLocked: boolean; pinnedMessage: any | null; sessionId?: string }> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/chat`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        return { messages: [], isChatLocked: false, pinnedMessage: null };
      }
      const data = await res.json();
      return {
        messages: data?.messages || [],
        isChatLocked: Boolean(data?.isChatLocked),
        pinnedMessage: data?.pinnedMessage || null,
        sessionId: data?.sessionId,
      };
    } catch (err) {
      console.warn("[dbClient] Error fetching chat history:", err);
      return { messages: [], isChatLocked: false, pinnedMessage: null };
    }
  },

  async setChatLock(roomCode: string, locked: boolean): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/chat/lock`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ locked }),
      });
      return res.ok;
    } catch (err) {
      console.warn("[dbClient] Error toggling chat lock:", err);
      return false;
    }
  },

  async setPinnedMessage(roomCode: string, text: string | null): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/chat/pin`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.pinnedMessage || null;
    } catch (err) {
      console.warn("[dbClient] Error updating pinned message:", err);
      return null;
    }
  },

  async endMeeting(roomCode: string): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/end`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data?.error || "Failed to end meeting" };
      }
      return { success: true, deletedCount: data?.deletedCount };
    } catch (err: any) {
      console.warn("[dbClient] Error ending meeting:", err);
      return { success: false, error: "Network error ending meeting" };
    }
  },

  /**
   * Whiteboard State Persistence
   */
  async saveWhiteboardSnapshot(roomCode: string, snapshot: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/whiteboard`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ snapshot }),
      });
    } catch (err) {
      console.warn("[dbClient] Error persisting whiteboard to PostgreSQL:", err);
    }
  },

  async setWhiteboardState(roomCode: string, isOpen: boolean): Promise<void> {
    try {
      await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/whiteboard/state`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ isOpen }),
      });
    } catch (err) {
      console.warn("[dbClient] Error persisting whiteboard view state:", err);
    }
  },

  async getWhiteboardState(roomCode: string): Promise<{ snapshot: any | null; isOpen: boolean }> {
    try {
      const res = await fetch(
        `${API_BASE}/rooms/${encodeURIComponent(roomCode)}/whiteboard`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) return { snapshot: null, isOpen: false };
      const data = await res.json();
      return {
        snapshot: data?.snapshot || null,
        isOpen: Boolean(data?.isOpen),
      };
    } catch (err) {
      console.warn("[dbClient] Error loading whiteboard state:", err);
      return { snapshot: null, isOpen: false };
    }
  },

  async getWhiteboardSnapshot(roomCode: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${API_BASE}/rooms/${encodeURIComponent(roomCode)}/whiteboard`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data?.snapshot || null;
    } catch (err) {
      console.warn("[dbClient] Error loading whiteboard snapshot:", err);
      return null;
    }
  },

  /**
   * Polls
   */
  async getPolls(roomCode: string): Promise<any[]> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/polls`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data?.polls || [];
    } catch (err) {
      console.warn("[dbClient] Error fetching polls:", err);
      return [];
    }
  },

  async createPoll(roomCode: string, pollData: any): Promise<any | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomCode)}/polls`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(pollData),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.poll || null;
    } catch (err) {
      console.warn("[dbClient] Error creating poll:", err);
      return null;
    }
  },

  async votePoll(pollId: string, optionIndex: number, userId?: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/polls/${encodeURIComponent(pollId)}/vote`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ option_index: optionIndex, user_id: userId }),
      });
      return res.ok;
    } catch (err) {
      console.warn("[dbClient] Error voting on poll:", err);
      return false;
    }
  },
};

export default dbClient;
