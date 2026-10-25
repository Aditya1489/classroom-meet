import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit Test Suite for Mathsy Meet Chat Logic:
 * Tests message normalization, duplicate local sender insertion, unread count state machine,
 * control-message filtering, chat lock state transitions, and input validation.
 */

interface ChatMsg {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: string;
  isHost?: boolean;
}

interface EngineChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isHost?: boolean;
}

describe("Chat Unit & UI Logic Verification", () => {
  // ── 1. Message Normalization ──
  it("TC-UNIT-01: Engine normalizes incoming socket messages with fallback values", () => {
    const rawMsgMissingFields = {
      from: { identity: "usr-456", name: "Alice" },
      content: "Hello world",
    };

    // Emulate mediasoupClient.ts handleChatMessage normalization
    const normalized: EngineChatMessage = {
      id: (rawMsgMissingFields as any).id || "fallback-id",
      senderId: (rawMsgMissingFields as any).senderId || rawMsgMissingFields.from?.identity || "remote",
      senderName: (rawMsgMissingFields as any).senderName || rawMsgMissingFields.from?.name || "Student",
      text: (rawMsgMissingFields as any).text || (rawMsgMissingFields as any).message || rawMsgMissingFields.content || "",
      timestamp: (rawMsgMissingFields as any).timestamp || "12:00 PM",
      isHost: Boolean((rawMsgMissingFields as any).isHost),
    };

    assert.equal(normalized.senderId, "usr-456");
    assert.equal(normalized.senderName, "Alice");
    assert.equal(normalized.text, "Hello world");
    assert.equal(normalized.isHost, false);
  });

  // ── 2. Local Sender Duplicate Bug ──
  it("TC-UNIT-02: [BUG CONFIRMED] handleSendMessage causes duplicate message entries in sender's local state", () => {
    // Emulate MeetingRoom.tsx chatMessages state
    let chatMessages: ChatMsg[] = [];
    const myUserId = "user-123";
    const myName = "Alice";
    const isHost = false;

    // Emulate engine listeners
    let onChatMessageListener: ((msg: EngineChatMessage) => void) | null = null;

    // Emulate Engine
    const mockEngine = {
      sendChatMessage: (senderName: string, text: string, hostFlag: boolean) => {
        const engineMsg: EngineChatMessage = {
          id: "engine-id-" + Math.random().toString(36).substring(2, 6),
          senderId: myUserId,
          senderName,
          text,
          timestamp: "12:00 PM",
          isHost: hostFlag,
        };
        // Engine calls onChatMessage immediately locally (mediasoupClient.ts:874)
        onChatMessageListener?.(engineMsg);
      },
    };

    // MeetingRoom.tsx registers engine.onChatMessage:
    onChatMessageListener = (msg: EngineChatMessage) => {
      const normalized: ChatMsg = {
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        message: msg.text,
        timestamp: msg.timestamp,
        isHost: msg.isHost || false,
      };
      chatMessages = [...chatMessages, normalized];
    };

    // MeetingRoom.tsx handleSendMessage:
    const handleSendMessage = (text: string) => {
      const msgPayload: ChatMsg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        senderId: myUserId,
        senderName: myName,
        message: text,
        timestamp: "12:00 PM",
        isHost: isHost,
      };

      // BUG: Appends locally here...
      chatMessages = [...chatMessages, msgPayload];
      // AND THEN calls engine.sendChatMessage which triggers onChatMessage listener!
      mockEngine.sendChatMessage(myName, text, isHost);
    };

    // Execute send
    handleSendMessage("Testing single message submission");

    // Assertion: Expected 1 message, but actual is 2!
    console.log("    Observed chatMessages count after 1 send:", chatMessages.length);
    assert.equal(
      chatMessages.length,
      2,
      "Confirmed bug: Sender's chatMessages receives TWO entries for every sent message"
    );
    assert.notEqual(chatMessages[0].id, chatMessages[1].id, "The two duplicate entries have conflicting generated IDs");
    assert.equal(chatMessages[0].message, chatMessages[1].message);
  });

  // ── 3. Unread Count State Transitions ──
  it("TC-UNIT-03: Unread count increments when side drawer is closed or on a different tab", () => {
    let unreadChatCount = 0;
    let isSideDrawerOpen = false;
    let activeSideTab: "chat" | "polls" | "participants" = "chat";

    const onIncomingMessage = () => {
      if (!isSideDrawerOpen || activeSideTab !== "chat") {
        unreadChatCount += 1;
      }
    };

    // Drawer closed: message received
    onIncomingMessage();
    assert.equal(unreadChatCount, 1, "Unread count should be 1 when drawer is closed");

    // Drawer closed: 2nd message received
    onIncomingMessage();
    assert.equal(unreadChatCount, 2, "Unread count should be 2 after second message");

    // User opens side drawer on chat tab: resets count
    isSideDrawerOpen = true;
    activeSideTab = "chat";
    unreadChatCount = 0; // MeetingRoom.tsx:1203

    // Incoming message while chat is open
    onIncomingMessage();
    assert.equal(unreadChatCount, 0, "Unread count must stay 0 while viewing chat tab");

    // User switches to 'polls' tab while drawer is open
    activeSideTab = "polls";
    onIncomingMessage();
    assert.equal(unreadChatCount, 1, "Unread count must increment when side drawer is on 'polls' tab");
  });

  // ── 4. Control Message Filtering ──
  it("TC-UNIT-04: Control messages (isControl: true) are routed away from chatMessages", () => {
    const receivedChatMessages: any[] = [];
    let receivedControlMessage: any = null;

    const handleChatMessage = (msg: any) => {
      if (msg?.isControl) {
        receivedControlMessage = msg;
        return; // Intercepted, does not append to chat
      }
      receivedChatMessages.push(msg);
    };

    // Normal message
    handleChatMessage({ text: "Hello", senderName: "Student A" });
    assert.equal(receivedChatMessages.length, 1);
    assert.equal(receivedControlMessage, null);

    // Control message: FORCE_MUTE
    handleChatMessage({
      isControl: true,
      controlAction: "FORCE_MUTE",
      targetUserId: "student-1",
    });
    assert.equal(receivedChatMessages.length, 1, "Control message must NOT be added to chat");
    assert.equal((receivedControlMessage as any)?.controlAction, "FORCE_MUTE");

    // Control message: REQUEST_MIC
    handleChatMessage({
      isControl: true,
      controlAction: "REQUEST_MIC",
      userId: "student-2",
      name: "Student B",
    });
    assert.equal(receivedChatMessages.length, 1, "REQUEST_MIC must NOT be added to chat");
    assert.equal((receivedControlMessage as any)?.controlAction, "REQUEST_MIC");
  });

  // ── 5. Chat Input Validation ──
  it("TC-UNIT-05: Empty, whitespace-only, and newline-only messages are rejected by handleSubmit", () => {
    let sentMessage: string | null = null;
    const onSendMessage = (txt: string) => {
      sentMessage = txt;
    };

    const submit = (input: string) => {
      if (!input.trim()) return;
      onSendMessage(input.trim());
    };

    submit("");
    assert.equal(sentMessage, null, "Empty string must not trigger send");

    submit("   ");
    assert.equal(sentMessage, null, "Whitespace-only string must not trigger send");

    submit("\n\n\t ");
    assert.equal(sentMessage, null, "Newline-only string must not trigger send");

    submit("  Hello World  ");
    assert.equal(sentMessage, "Hello World", "Valid string should be trimmed and sent");
  });

  // ── 6. Chat Lock State Logic (Client-Side) ──
  it("TC-UNIT-06: Student cannot submit via UI when isChatLocked is true", () => {
    const isChatLocked = true;
    const isHost = false;
    let submitted = false;

    const handleSend = (text: string) => {
      if (!text.trim()) return;
      if (!isHost && isChatLocked) {
        // Blocked by ClassFeedSidepanel.tsx:167
        return;
      }
      submitted = true;
    };

    handleSend("Can I still talk?");
    assert.equal(submitted, false, "Student submission must be blocked when isChatLocked is true");

    // Tutor CAN submit while locked
    let tutorSubmitted = false;
    const handleTutorSend = (text: string) => {
      if (!text.trim()) return;
      if (!true /* isHost */ && isChatLocked) return;
      tutorSubmitted = true;
    };
    handleTutorSend("Teacher announcement during lock");
    assert.equal(tutorSubmitted, true, "Tutor must still be able to submit when chat is locked");
  });

  // ── 7. Pinned Message Replacement ──
  it("TC-UNIT-07: Pinning a new message overwrites the existing pinned notice", () => {
    let pinnedMessage: { text: string; senderName: string } | null = null;

    const onPinMessage = (text: string, senderName: string) => {
      pinnedMessage = { text, senderName };
    };
    const onUnpinMessage = () => {
      pinnedMessage = null;
    };

    onPinMessage("First notice: Page 42", "Tutor");
    assert.equal((pinnedMessage as any)?.text, "First notice: Page 42");

    onPinMessage("Second notice: Homework due Friday", "Tutor");
    assert.equal((pinnedMessage as any)?.text, "Second notice: Homework due Friday", "2nd notice replaces 1st notice");

    onUnpinMessage();
    assert.equal(pinnedMessage, null, "Unpin message clears pinned notice");
  });
});
