import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "mathsy_meet_chat";

export interface MongoChatMessage {
  _id?: ObjectId;
  sessionId: string;
  roomCode: string;
  senderId: string;
  senderName: string;
  senderRole: "tutor" | "student";
  isHost: boolean;
  text: string;
  createdAt: Date;
  clientMessageId?: string;
  expireAt?: Date;
}

export interface MongoClassSession {
  _id?: ObjectId;
  sessionId: string;
  roomCode: string;
  tutorId: string;
  status: "active" | "ended";
  isChatLocked: boolean;
  pinnedMessage: {
    text: string;
    senderName: string;
    pinnedAt: Date;
  } | null;
  startedAt: Date;
  endedAt?: Date;
  lastActivityAt: Date;
  expireAt?: Date;
}

let client: MongoClient | null = null;
let db: Db | null = null;
let isConnecting = false;

/**
 * Connect to MongoDB and initialize collections & compound indexes
 */
export async function connectMongo(): Promise<Db | null> {
  if (db) return db;
  if (isConnecting) {
    while (isConnecting) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (db) return db;
  }

  isConnecting = true;
  try {
    const maskedUri = MONGODB_URI.replace(/:[^:@]+@/, ":****@");
    console.log(`[MongoDB] Connecting to temporary chat database at: ${maskedUri}`);

    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(MONGODB_DB_NAME);

    // 1. Compound index for chronological querying of a session:
    // { sessionId: 1, createdAt: 1, _id: 1 }
    await db.collection("chat_messages").createIndex(
      { sessionId: 1, createdAt: 1, _id: 1 },
      { name: "idx_session_chronological" }
    );

    // 2. Idempotency index for duplicate prevention on client retries:
    await db.collection("chat_messages").createIndex(
      { sessionId: 1, clientMessageId: 1 },
      { name: "idx_session_client_msg", sparse: true }
    );

    // 3. Fallback TTL index for abandoned sessions that never reach normal end-class (24h)
    await db.collection("chat_messages").createIndex(
      { expireAt: 1 },
      { name: "idx_abandoned_ttl", expireAfterSeconds: 0 }
    );

    // 4. Session collection indexes
    await db.collection("class_sessions").createIndex(
      { sessionId: 1 },
      { name: "idx_session_id_unique", unique: true }
    );
    await db.collection("class_sessions").createIndex(
      { roomCode: 1, status: 1 },
      { name: "idx_room_status" }
    );
    await db.collection("class_sessions").createIndex(
      { expireAt: 1 },
      { name: "idx_session_abandoned_ttl", expireAfterSeconds: 0 }
    );

    console.log("[MongoDB] Connected successfully. Collections and compound indexes verified.");
    return db;
  } catch (err: any) {
    console.warn("\n⚠️  [MongoDB Connection Warning]:", err.message);
    console.warn("   Make sure MongoDB is running on port 27017 or configure MONGODB_URI in your .env file.\n");
    return null;
  } finally {
    isConnecting = false;
  }
}

/**
 * Get MongoDB Database instance (returns null if disconnected)
 */
export function getMongoDb(): Db | null {
  return db;
}

/**
 * Access chat_messages collection
 */
export function getChatCollection(): Collection<MongoChatMessage> | null {
  if (!db) return null;
  return db.collection<MongoChatMessage>("chat_messages");
}

/**
 * Access class_sessions collection
 */
export function getSessionsCollection(): Collection<MongoClassSession> | null {
  if (!db) return null;
  return db.collection<MongoClassSession>("class_sessions");
}

/**
 * Graceful shutdown for MongoDB connection
 */
export async function closeMongo(): Promise<void> {
  if (client) {
    try {
      await client.close();
      client = null;
      db = null;
      console.log("[MongoDB] Connection closed gracefully.");
    } catch (err: any) {
      console.error("[MongoDB Close Error]:", err.message);
    }
  }
}
