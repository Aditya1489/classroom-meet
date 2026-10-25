import { Router, Request, Response } from "express";
import { query } from "../db";
import { requireAuth } from "./auth";
import { getChatCollection, getSessionsCollection, MongoChatMessage } from "../db/mongo";

export const chatRouter = Router();

// In-memory sliding window rate limiter: Max 5 messages per 3 seconds per user
const rateLimitMap = new Map<string, number[]>();

function isRateLimited(userId: string, limit = 5, windowMs = 3000): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    return true;
  }
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return false;
}

// Periodically prune stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of rateLimitMap.entries()) {
    const recent = timestamps.filter((t) => now - t < 5000);
    if (recent.length === 0) {
      rateLimitMap.delete(userId);
    } else {
      rateLimitMap.set(userId, recent);
    }
  }
}, 60000);

function sanitizeCode(code: any): string {
  return String(Array.isArray(code) ? code[0] : code || "").trim().toLowerCase();
}

/**
 * GET /api/rooms/:roomCode/chat
 * Retrieves complete active-session chat history from MongoDB.
 * Strictly requires authentication and an active meeting session.
 */
chatRouter.get("/:roomCode/chat", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);

    // 1. Verify that the room exists and is currently active in PostgreSQL
    const roomRes = await query(
      "SELECT id, room_code, tutor_id, is_active, metadata FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    if (!room.is_active) {
      return res.status(404).json({ error: "Class has ended", messages: [], isEnded: true });
    }

    // 2. Derive authoritative session ID
    const sessionId = String(room.metadata?.session_id || room.id);

    // 3. Fetch session lock & pin metadata from MongoDB
    const sessionsCol = getSessionsCollection();
    let isChatLocked = Boolean(room.metadata?.is_chat_locked);
    let pinnedMessage = room.metadata?.pinned_message || null;

    if (sessionsCol) {
      const sessionDoc = await sessionsCol.findOne({ sessionId });
      if (sessionDoc) {
        if (sessionDoc.isChatLocked !== undefined) isChatLocked = sessionDoc.isChatLocked;
        if (sessionDoc.pinnedMessage !== undefined) pinnedMessage = sessionDoc.pinnedMessage;
      }
    }

    // 4. Fetch complete history from MongoDB scoped strictly to this sessionId
    const chatCol = getChatCollection();
    let rawMessages: MongoChatMessage[] = [];

    if (chatCol) {
      rawMessages = await chatCol
        .find({ sessionId })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
    }

    // Map to client format
    const messages = rawMessages.map((m) => ({
      id: m._id ? m._id.toString() : (m.clientMessageId || `msg-${m.createdAt.getTime()}`),
      sessionId: m.sessionId,
      roomCode: m.roomCode,
      senderId: m.senderId,
      senderName: m.senderName,
      senderRole: m.senderRole,
      isHost: Boolean(m.isHost),
      message: m.text,
      text: m.text,
      timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      timestampMs: new Date(m.createdAt).getTime(),
      createdAt: m.createdAt,
    }));

    return res.json({
      sessionId,
      isChatLocked,
      pinnedMessage,
      messages,
      totalCount: messages.length,
    });
  } catch (err: any) {
    console.error("[Chat GET Error]:", err.message);
    return res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

/**
 * POST /api/rooms/:roomCode/chat
 * Persists a new temporary message to MongoDB.
 * Strictly requires authentication; derives sender identity and role server-side.
 */
chatRouter.post("/:roomCode/chat", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;

    // 1. Verify active room in PostgreSQL
    const roomRes = await query(
      "SELECT id, room_code, tutor_id, is_active, metadata FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomRes.rows[0];
    if (!room.is_active) {
      return res.status(404).json({ error: "Class has ended. Messages can no longer be sent." });
    }

    const sessionId = String(room.metadata?.session_id || room.id);

    // 2. Authoritative role & host check
    const isHost = Boolean(
      (room.tutor_id && String(room.tutor_id) === String(user.id)) ||
      (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(user.id)) ||
      user.role === "tutor"
    );
    const senderRole: "tutor" | "student" = isHost ? "tutor" : "student";

    // 3. Check Chat Lock
    const sessionsCol = getSessionsCollection();
    let isChatLocked = Boolean(room.metadata?.is_chat_locked);
    if (sessionsCol) {
      const sessionDoc = await sessionsCol.findOne({ sessionId });
      if (sessionDoc && sessionDoc.isChatLocked !== undefined) {
        isChatLocked = sessionDoc.isChatLocked;
      }
    }

    if (isChatLocked && !isHost) {
      return res.status(423).json({ error: "Chat is currently locked by the host" });
    }

    // 4. Validate Content
    const rawContent = req.body?.text ?? req.body?.content ?? req.body?.message;
    const content = typeof rawContent === "string" ? rawContent.trim() : "";

    if (!content || content.length === 0) {
      return res.status(400).json({ error: "Message content is required" });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: "Message exceeds maximum length of 2000 characters" });
    }

    // 5. Rate Limiting Check (Students max 5 per 3s, hosts exempt)
    if (!isHost && isRateLimited(user.id)) {
      return res.status(429).json({ error: "You are sending messages too quickly. Please wait a moment." });
    }

    const clientMessageId = req.body?.clientMessageId;
    const chatCol = getChatCollection();

    if (!chatCol) {
      return res.status(503).json({ error: "Chat service temporarily unavailable" });
    }

    // 6. Idempotency Check (Prevent duplicate insertion on network retry)
    if (clientMessageId && typeof clientMessageId === "string") {
      const existingMsg = await chatCol.findOne({ sessionId, clientMessageId });
      if (existingMsg) {
        return res.json({
          success: true,
          message: {
            id: existingMsg._id?.toString(),
            sessionId: existingMsg.sessionId,
            roomCode: existingMsg.roomCode,
            senderId: existingMsg.senderId,
            senderName: existingMsg.senderName,
            senderRole: existingMsg.senderRole,
            isHost: existingMsg.isHost,
            message: existingMsg.text,
            text: existingMsg.text,
            timestamp: new Date(existingMsg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            timestampMs: new Date(existingMsg.createdAt).getTime(),
            createdAt: existingMsg.createdAt,
          },
        });
      }
    }

    // 7. Insert Canonical Message Document in MongoDB
    const now = new Date();
    const doc: MongoChatMessage = {
      sessionId,
      roomCode: sanitizedCode,
      senderId: user.id,
      senderName: user.full_name || "Participant",
      senderRole,
      isHost,
      text: content,
      createdAt: now,
      clientMessageId: clientMessageId || undefined,
      expireAt: new Date(now.getTime() + 24 * 3600 * 1000), // 24h fallback TTL
    };

    const insertResult = await chatCol.insertOne(doc);
    const canonicalId = insertResult.insertedId.toString();

    // 8. Update session lastActivityAt
    if (sessionsCol) {
      await sessionsCol.updateOne(
        { sessionId },
        { $set: { lastActivityAt: now } }
      );
    }

    return res.json({
      success: true,
      message: {
        id: canonicalId,
        sessionId,
        roomCode: sanitizedCode,
        senderId: user.id,
        senderName: user.full_name || "Participant",
        senderRole,
        isHost,
        message: content,
        text: content,
        timestamp: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        timestampMs: now.getTime(),
        createdAt: now,
      },
    });
  } catch (err: any) {
    console.error("[Chat POST Error]:", err.message);
    return res.status(500).json({ error: "Failed to save message" });
  }
});

/**
 * POST /api/rooms/:roomCode/chat/lock
 * Authoritative host lock/unlock toggle.
 */
chatRouter.post("/:roomCode/chat/lock", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;
    const { locked } = req.body;

    const roomRes = await query(
      "SELECT id, tutor_id, is_active, metadata FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({ error: "Active class not found" });
    }

    const room = roomRes.rows[0];
    const isOwner = Boolean(
      (room.tutor_id && String(room.tutor_id) === String(user.id)) ||
      (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(user.id))
    );

    if (!isOwner) {
      return res.status(403).json({ error: "Only the host can lock or unlock chat" });
    }

    const sessionId = String(room.metadata?.session_id || room.id);
    const lockState = Boolean(locked);

    // Update PostgreSQL metadata
    const updatedMeta = { ...(room.metadata || {}), is_chat_locked: lockState };
    await query("UPDATE live_classes SET metadata = $1 WHERE room_code = $2", [
      JSON.stringify(updatedMeta),
      sanitizedCode,
    ]);

    // Update MongoDB session state
    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      await sessionsCol.updateOne(
        { sessionId },
        { $set: { isChatLocked: lockState, lastActivityAt: new Date() } },
        { upsert: true }
      );
    }

    return res.json({ success: true, isChatLocked: lockState });
  } catch (err: any) {
    console.error("[Chat Lock Error]:", err.message);
    return res.status(500).json({ error: "Failed to update chat lock state" });
  }
});

/**
 * POST /api/rooms/:roomCode/chat/pin
 * Authoritative host notice pin/unpin handler.
 */
chatRouter.post("/:roomCode/chat/pin", requireAuth, async (req: Request, res: Response) => {
  try {
    const { roomCode } = req.params;
    const sanitizedCode = sanitizeCode(roomCode);
    const user = (req as any).user;
    const { text } = req.body;

    const roomRes = await query(
      "SELECT id, tutor_id, is_active, metadata FROM live_classes WHERE room_code = $1",
      [sanitizedCode]
    );

    if (roomRes.rows.length === 0 || !roomRes.rows[0].is_active) {
      return res.status(404).json({ error: "Active class not found" });
    }

    const room = roomRes.rows[0];
    const isOwner = Boolean(
      (room.tutor_id && String(room.tutor_id) === String(user.id)) ||
      (room.metadata?.tutor_id && String(room.metadata?.tutor_id) === String(user.id))
    );

    if (!isOwner) {
      return res.status(403).json({ error: "Only the host can pin messages" });
    }

    const sessionId = String(room.metadata?.session_id || room.id);
    let pinnedObj: { text: string; senderName: string; pinnedAt: Date } | null = null;

    if (text && typeof text === "string" && text.trim().length > 0) {
      pinnedObj = {
        text: text.trim().slice(0, 500),
        senderName: user.full_name || "Host",
        pinnedAt: new Date(),
      };
    }

    // Update PostgreSQL metadata
    const updatedMeta = { ...(room.metadata || {}), pinned_message: pinnedObj };
    await query("UPDATE live_classes SET metadata = $1 WHERE room_code = $2", [
      JSON.stringify(updatedMeta),
      sanitizedCode,
    ]);

    // Update MongoDB session state
    const sessionsCol = getSessionsCollection();
    if (sessionsCol) {
      await sessionsCol.updateOne(
        { sessionId },
        { $set: { pinnedMessage: pinnedObj, lastActivityAt: new Date() } },
        { upsert: true }
      );
    }

    return res.json({ success: true, pinnedMessage: pinnedObj });
  } catch (err: any) {
    console.error("[Chat Pin Error]:", err.message);
    return res.status(500).json({ error: "Failed to update pinned message" });
  }
});
