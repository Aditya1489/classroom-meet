/**
 * PostgreSQL Database Client for Mathsy Meet
 * Communicates with the PostgreSQL backend API (http://localhost:5001/api).
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("mathsy_meet_token");
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
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 404) return null;
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

  async upsertRoom(room: Partial<DbLiveClass> & { room_code: string }): Promise<DbLiveClass | null> {
    try {
      const res = await fetch(`${API_BASE}/rooms`, {
        method: "POST",
        headers: getAuthHeaders(),
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
  async recordParticipantJoin(participant: DbParticipant): Promise<void> {
    try {
      await fetch(`${API_BASE}/rooms/${encodeURIComponent(participant.room_code)}/participants`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          user_id: participant.user_id,
          display_name: participant.display_name,
          role: participant.role,
        }),
      });
    } catch (err) {
      console.warn("[dbClient] Participant join error:", err);
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

  /**
   * Chat Messages
   */
  async saveChatMessage(msg: DbChatMessage): Promise<void> {
    try {
      await fetch(`${API_BASE}/rooms/${encodeURIComponent(msg.room_code)}/chat`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sender_id: msg.sender_id,
          sender_name: msg.sender_name,
          sender_role: msg.sender_role,
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
        }),
      });
    } catch (err) {
      console.warn("[dbClient] Error saving chat message to PostgreSQL:", err);
    }
  },

  async getChatHistory(roomCode: string, limit = 100): Promise<DbChatMessage[]> {
    try {
      const res = await fetch(
        `${API_BASE}/rooms/${encodeURIComponent(roomCode)}/chat?limit=${limit}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data?.messages || [];
    } catch (err) {
      console.warn("[dbClient] Error fetching chat history from PostgreSQL:", err);
      return [];
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
