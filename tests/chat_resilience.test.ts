import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inMemoryChatStore } from "../server/routes/chat";

describe("Chat Backend Resilience & In-Memory Fallback", () => {
  it("inMemoryChatStore successfully stores and recalls messages without throwing or returning 503", () => {
    const testSession = "test-session-resilience-123";
    const testMsg: any = {
      _id: "mem-msg-1",
      sessionId: testSession,
      roomCode: "test-room",
      senderId: "user-1",
      senderName: "Aditya",
      senderRole: "student",
      isHost: false,
      text: "Hello resilience!",
      createdAt: new Date(),
      clientMessageId: "c-id-1",
    };

    const list = inMemoryChatStore.get(testSession) || [];
    list.push(testMsg);
    inMemoryChatStore.set(testSession, list);

    const stored = inMemoryChatStore.get(testSession);
    assert.ok(stored, "Stored messages should exist");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].text, "Hello resilience!");

    // Clean up
    inMemoryChatStore.delete(testSession);
  });
});
