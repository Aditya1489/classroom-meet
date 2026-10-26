import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";

export interface RemoteParticipant {
  id: string;
  userId?: string;
  name: string;
  role: string;
  isAudioMuted?: boolean;
  isVideoMuted?: boolean;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  screenTrack?: MediaStreamTrack;
  isSpeaking?: boolean;
  isHandRaised?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isHost?: boolean;
  clientMessageId?: string;
  senderRole?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  creatorName: string;
  isActive: boolean;
  totalVotes: number;
  userVotedId?: string;
}

export interface ReactionEvent {
  id: string;
  senderName: string;
  emoji: string;
}

export interface MicRequestEvent {
  userId: string;
  name: string;
  timestamp?: number;
  correlationId?: string;
  roomCode?: string;
}

export interface ControlMessageEvent {
  isControl: boolean;
  controlAction: "REQUEST_MIC" | "CANCEL_REQUEST" | "MIC_RESPONSE" | "FORCE_MUTE" | "WHITEBOARD_STATE" | "PEER_MUTE_STATE" | "CLASS_ENDED";
  userId?: string;
  targetUserId?: string;
  name?: string;
  approved?: boolean;
  tutorName?: string;
  all?: boolean;
  roomCode?: string;
  isOpen?: boolean;
  layoutMode?: string;
  isHost?: boolean;
  senderId?: string;
  senderRole?: string;
  correlationId?: string;
  timestamp?: number;
}

function generateClientJwt(userId: string, role: string, name: string): string {
  try {
    const b64Url = (obj: any) =>
      btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    const header = b64Url({ alg: "HS256", typ: "JWT" });
    const payload = b64Url({
      sub: userId,
      id: userId,
      role: role === "host" ? "tutor" : role,
      name: name,
      exp: Math.floor(Date.now() / 1000) + 86400 * 7,
    });
    return `${header}.${payload}.mathsySig`;
  } catch {
    return "";
  }
}

function getEffectiveToken(token: string | undefined, userId: string, role: string, userName: string): string {
  if (token && token.trim().length > 0) {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payloadStr = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadStr);
        if (payload && payload.sub) {
          return token;
        }
      }
    } catch {
      // Invalid format, fall back
    }
  }
  return generateClientJwt(userId, role, userName);
}

function sanitizeTransportData(data: any, signalingUrl: string) {
  if (!data) return data;

  const publicServerIp = "80.225.208.166";
  const publicDomain = "rtc.mathsy.in";

  if (Array.isArray(data.iceCandidates)) {
    const sanitizedCandidates: any[] = [];
    for (const c of data.iceCandidates) {
      const rawIp = c.ip || c.address || "";
      const isPrivate =
        rawIp.startsWith("10.") ||
        rawIp.startsWith("192.168.") ||
        rawIp === "127.0.0.1" ||
        rawIp === "localhost" ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(rawIp);

      if (isPrivate) {
        console.log(`[MathsyMeet Engine] Rewriting private ICE candidate IP: ${rawIp} -> ${publicServerIp}`);
        sanitizedCandidates.push({
          ...c,
          ip: publicServerIp,
          address: publicServerIp,
        });
      } else {
        sanitizedCandidates.push(c);
      }
    }
    data.iceCandidates = sanitizedCandidates;
  }

  return data;
}
export class MathsyMediasoupEngine {
  public socket: Socket | null = null;
  public device: Device | null = null;
  private sendTransport: any = null;
  private recvTransport: any = null;
  
  private producers = new Map<"audio" | "video" | "screen", any>();
  private consumers = new Map<string, any>(); // consumerId -> Consumer
  
  public localAudioTrack: MediaStreamTrack | null = null;
  public localVideoTrack: MediaStreamTrack | null = null;
  public localScreenTrack: MediaStreamTrack | null = null;

  public participants = new Map<string, RemoteParticipant>();
  public chatMessages: ChatMessage[] = [];
  public activePolls: Poll[] = [];
  private currentUserId: string = "";
  public roomId: string = "";
  public isHostUser: boolean = false;
  public authorizedTutorId: string | null = null;
  private isEnablingAudio: boolean = false;
  private processedControlIds = new Set<string>();

  public serverRole: "tutor" | "student" = "student";
  public isServerOwner: boolean = false;
  public isDemo: boolean = false;
  public demoRemainingSec: number | null = null;
  public onDemoRoomEnded?: () => void;
  public getAuthToken(): string {
    return this.activeToken;
  }

  // Listeners
  public onRoleAssigned?: (role: "tutor" | "student", isOwner: boolean, roomData?: any) => void;
  public onParticipantsChange?: (participants: RemoteParticipant[]) => void;
  public onPeerLeft?: (peerId: string) => void;
  public onChatMessage?: (message: ChatMessage) => void;
  public onPollsChange?: (polls: Poll[]) => void;
  public onReaction?: (reaction: ReactionEvent) => void;
  public onWhiteboardData?: (data: any) => void;
  public onConnectionStateChange?: (state: "connecting" | "connected" | "disconnected" | "failed", errorMessage?: string) => void;
  public onUnmuteRequest?: (request: MicRequestEvent) => void;
  public onControlMessage?: (msg: ControlMessageEvent) => void;
  public onChatLockChange?: (locked: boolean) => void;
  public onPinnedMessageChange?: (message: { text: string; senderName: string } | null) => void;
  public onClassEnded?: () => void;

  public activeToken: string = "";
  public isChatLocked: boolean = false;
  public pinnedMessage: any = null;
  public letStudentsDraw: boolean = false;
  public whiteboardSnapshot: any = null;

  // Section 3 Listeners
  public onForceMute?: (reason: string) => void;
  public onExpelled?: (reason: string) => void;
  public onHandLowered?: (studentId?: string) => void;
  public onHandLowerAll?: () => void;
  public onChatPinChange?: (pinnedMessage: any) => void;
  public onDrawingPermissionChange?: (allowed: boolean) => void;
  public onCameraOffRequest?: (data: { studentId: string; studentName: string; reason?: string }) => void;
  public onCameraOffResponse?: (data: { studentId: string; approved: boolean; reason?: string }) => void;

  public getCurrentUserId(): string {
    return this.currentUserId;
  }

  public getSocketId(): string | undefined {
    return this.socket?.id;
  }

  public setAuthorizedTutorId(tutorId: string | null) {
    this.authorizedTutorId = tutorId;
  }

  public setIsHostUser(isHost: boolean) {
    this.isHostUser = isHost;
  }

  private signalingUrl: string;

  constructor() {
    this.signalingUrl = import.meta.env.VITE_MEDIASOUP_SERVER_URL || "";
    if (!this.signalingUrl) {
      console.error("[MathsyMeet Engine] Critical: VITE_MEDIASOUP_SERVER_URL is not configured.");
    }
  }

  public async connect({
    roomId,
    userId,
    userName,
    token = "",
    role = "host",
  }: {
    roomId: string;
    userId: string;
    userName: string;
    token?: string;
    role?: "host" | "tutor" | "student" | "guest";
  }): Promise<void> {
    if (!this.signalingUrl) {
      const errMsg = "Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.";
      console.error(`[MathsyMeet Engine] ${errMsg}`);
      this.onConnectionStateChange?.("failed", errMsg);
      throw new Error(errMsg);
    }

    this.onConnectionStateChange?.("connecting");
    this.roomId = (roomId || "").toLowerCase().trim();
    this.isHostUser = role === "host" || role === "tutor";

    // Replace underscores with hyphens so extractBaseUserId on server treats each user as unique
    const sanitizedUserId = userId.replace(/_/g, "-");
    this.currentUserId = sanitizedUserId;

    let effectiveToken = token && token.trim().length > 0 ? token.trim() : "";
    if (!effectiveToken) {
      try {
        const guestRes = await fetch(`${this.signalingUrl.replace(/\/$/, "")}/api/guest-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: userName, guestId: sanitizedUserId })
        });
        if (guestRes.ok) {
          const guestData = await guestRes.json();
          effectiveToken = guestData.token;
        }
      } catch (err: any) {
        console.warn("[MathsyMeet Engine] Fallback guest token generator used:", err.message);
      }
    }

    if (!effectiveToken) {
      effectiveToken = getEffectiveToken(token, sanitizedUserId, role, userName);
    }
    this.activeToken = effectiveToken;

    return new Promise<void>((resolve) => {
      let resolved = false;
      const finishConnect = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      // Establish WebSocket to Mediasoup signaling server
      this.socket = io(this.signalingUrl, {
        auth: {
          token: effectiveToken,
        },
        query: {
          token: effectiveToken,
          classId: roomId,
          name: userName,
          role: role === "host" ? "tutor" : "student",
          peerIdentity: sanitizedUserId,
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      this.socket.on("error", (err: any) => {
        console.error("[MathsyMeet Engine] Server error notification:", err);
        if (err?.code === "ROOM_FULL") {
          this.onConnectionStateChange?.("failed", err.message || "Room is full (max participants reached)");
        }
      });

      this.socket.on("demoRoomEnded", () => {
        console.log("[MathsyMeet Engine] Received demoRoomEnded from server");
        this.onDemoRoomEnded?.();
      });

      this.socket.on("connect", () => {
        console.log("[MathsyMeet Engine] Socket connected to Mediasoup server:", this.signalingUrl);
        this.onConnectionStateChange?.("connected");
      });

      this.socket.on("connect_error", (err) => {
        console.warn("[MathsyMeet Engine] Socket connection warning:", err.message);
        this.onConnectionStateChange?.("connected");
        finishConnect();
      });

      this.socket.on("disconnect", () => {
        console.log("[MathsyMeet Engine] Socket disconnected");
        this.onConnectionStateChange?.("disconnected");
      });

      // Handle roomJoined (Server returns routerRtpCapabilities and list of existing peers)
      this.socket.on("roomJoined", async (data: any) => {
        console.log("[MathsyMeet Engine] roomJoined received. Existing peers:", data?.peers?.length || 0);

        if (data?.role) {
          this.serverRole = data.role === "tutor" ? "tutor" : "student";
          this.isServerOwner = Boolean(data.isOwner);
          this.isDemo = Boolean(data.isDemo);
          this.demoRemainingSec = typeof data.remainingSec === "number" ? data.remainingSec : null;
          if (data.whiteboardSnapshot) this.whiteboardSnapshot = data.whiteboardSnapshot;
          if (typeof data.letStudentsDraw === "boolean") this.letStudentsDraw = data.letStudentsDraw;
          if (data.pinnedMessage) this.pinnedMessage = data.pinnedMessage;
          if (typeof data.isChatLocked === "boolean") this.isChatLocked = data.isChatLocked;
          console.log(`[MathsyMeet Engine] Server confirmed role: ${this.serverRole}, isOwner: ${this.isServerOwner}, isDemo: ${this.isDemo}`);
          this.onRoleAssigned?.(this.serverRole, this.isServerOwner, data);
        }
        
        // Initialize Mediasoup device with router capabilities
        if (data?.routerRtpCapabilities && !this.device?.loaded) {
          try {
            this.device = new Device();
            await this.device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
            await this.createTransports(roomId);
          } catch (err: any) {
            console.warn("[MathsyMeet Engine] Device init note:", err.message);
          }
        }

        // Populate existing participants already in room
        if (Array.isArray(data?.peers)) {
          data.peers.forEach((peer: any) => {
            const pId = peer.id || peer.baseUserId;
            const pUserId = peer.baseUserId || peer.userId || peer.id;
            if (pId && pId !== sanitizedUserId && pId !== userId) {
              this.participants.set(pId, {
                id: pId,
                userId: pUserId,
                name: peer.name || "Participant",
                role: peer.role || "student",
                isSpeaking: false,
                isHandRaised: false,
                isAudioMuted: true,
                isVideoMuted: true,
              });
            }
          });
          this.notifyParticipants();
        }

        if (typeof data?.isChatLocked === "boolean") {
          this.onChatLockChange?.(data.isChatLocked);
        }
        if (data?.pinnedMessage !== undefined) {
          this.onPinnedMessageChange?.(data.pinnedMessage);
        }

        finishConnect();
      });

      // Safety timeout to unblock callers if server roomJoined takes longer
      setTimeout(finishConnect, 3000);

      // Handle peer lifecycle events (peerJoined / peer-joined)
      const handlePeerJoined = (peer: { id: string; name: string; role: string; baseUserId?: string; userId?: string }) => {
        const pId = peer.id || peer.baseUserId;
        const pUserId = peer.baseUserId || peer.userId || peer.id;
        if (!pId || pId === sanitizedUserId || pId === userId) return;
        console.log("[MathsyMeet Engine] Peer joined room:", peer);
        this.participants.set(pId, {
          id: pId,
          userId: pUserId,
          name: peer.name || "Participant",
          role: peer.role || "student",
          isSpeaking: false,
          isHandRaised: false,
          isAudioMuted: true,
          isVideoMuted: true,
        });
        this.notifyParticipants();
      };
      this.socket.on("peerJoined", handlePeerJoined);
      this.socket.on("peer-joined", handlePeerJoined);

      this.socket.on("forceMute", (payload: any) => {
        console.log("[MathsyMeet Engine] Received forceMute from tutor:", payload);
        this.disableAudio();
        this.onForceMute?.(payload?.reason || "You were muted by the tutor");
      });

      this.socket.on("expelled", (payload: any) => {
        console.log("[MathsyMeet Engine] Received expelled from tutor:", payload);
        this.disconnect();
        this.onExpelled?.(payload?.reason || "Removed by tutor");
      });

      this.socket.on("hand:lowered", (payload: any) => {
        console.log("[MathsyMeet Engine] Received hand:lowered:", payload);
        const studentId = payload?.studentId;
        if (studentId) {
          const p = this.participants.get(studentId);
          if (p) p.isHandRaised = false;
          this.notifyParticipants();
        }
        this.onHandLowered?.(studentId);
      });

      this.socket.on("hand:lowerAll", () => {
        console.log("[MathsyMeet Engine] Received hand:lowerAll");
        for (const p of this.participants.values()) {
          p.isHandRaised = false;
        }
        this.notifyParticipants();
        this.onHandLowerAll?.();
      });

      this.socket.on("chatLock", (payload: any) => {
        this.isChatLocked = Boolean(payload?.locked);
        console.log("[MathsyMeet Engine] Received chatLock:", this.isChatLocked);
        this.onChatLockChange?.(this.isChatLocked);
      });

      this.socket.on("chatPin", (payload: any) => {
        this.pinnedMessage = payload?.message || null;
        console.log("[MathsyMeet Engine] Received chatPin:", this.pinnedMessage);
        this.onChatPinChange?.(this.pinnedMessage);
      });

      this.socket.on("whiteboard:drawingPermission", (payload: any) => {
        this.letStudentsDraw = Boolean(payload?.allowed);
        console.log("[MathsyMeet Engine] Received whiteboard:drawingPermission:", this.letStudentsDraw);
        this.onDrawingPermissionChange?.(this.letStudentsDraw);
      });

      this.socket.on("cameraOffRequest", (payload: any) => {
        console.log("[MathsyMeet Engine] Received cameraOffRequest:", payload);
        this.onCameraOffRequest?.(payload);
      });

      this.socket.on("cameraOffResponse", (payload: any) => {
        console.log("[MathsyMeet Engine] Received cameraOffResponse:", payload);
        this.onCameraOffResponse?.(payload);
      });

      // Handle peer left events (peerLeft / peer-left)
      const handlePeerLeft = (data: any) => {
        const pId = typeof data === "string" ? data : (data?.id || data?.peerId || data?.baseUserId);
        if (!pId) return;
        console.log("[MathsyMeet Engine] Peer left room:", pId);
        this.participants.delete(pId);
        for (const [key] of this.participants.entries()) {
          if (key === pId || (typeof data === "object" && (data.id === key || data.baseUserId === key))) {
            this.participants.delete(key);
          }
        }
        this.notifyParticipants();
        this.onPeerLeft?.(pId);
      };
      this.socket.on("peerLeft", handlePeerLeft);
      this.socket.on("peer-left", handlePeerLeft);

      // Handle incoming media producers
      const handleNewProducer = async (data: any) => {
        console.log("[MathsyMeet Engine] newProducer received:", data);
        if (!data || typeof data !== "object") return;
        const producerId = data.producerId || data.id;
        const peerId = data.producerPeerId || data.peerId || data.producerBaseUserId || data.baseUserId;
        const kind = data.kind;
        const source = data.appData?.mediaType || data.source || data.mediaType;
        if (producerId && peerId && kind) {
          await this.consumeTrack(producerId, peerId, kind, source);
        }
      };
      this.socket.on("newProducer", handleNewProducer);
      this.socket.on("new-producer", handleNewProducer);

      // Handle initial active producers when joining (handles nested array [[p1, p2]])
      const handleActiveProducers = async (producers: any) => {
        console.log("[MathsyMeet Engine] activeProducers received:", producers);
        const list: any[] = Array.isArray(producers) ? producers.flat(2) : [];
        for (const p of list) {
          if (!p || typeof p !== "object") continue;
          const producerId = p.producerId || p.id;
          const peerId = p.producerPeerId || p.peerId || p.producerBaseUserId || p.baseUserId;
          const kind = p.kind;
          const source = p.appData?.mediaType || p.source || p.mediaType;
          if (producerId && peerId && kind) {
            await this.consumeTrack(producerId, peerId, kind, source);
          }
        }
      };
      this.socket.on("activeProducers", handleActiveProducers);
      this.socket.on("active-producers", handleActiveProducers);

      // Handle tutor status event when tutor is in room or joins
      this.socket.on("tutorStatus", (data: any) => {
        if (!data || data.status !== "connected") return;
        const pId = data.peerId || data.baseUserId;
        if (!pId || pId === sanitizedUserId || pId === userId) return;
        if (!this.participants.has(pId)) {
          this.participants.set(pId, {
            id: pId,
            name: data.name || "Tutor",
            role: "host",
            isSpeaking: false,
            isHandRaised: false,
            isAudioMuted: true,
            isVideoMuted: true,
          });
          this.notifyParticipants();
        }
      });

      // Handle producer closure from SFU
      this.socket.on("producerClosed", ({ producerId, peerId }: any) => {
        const consumer = Array.from(this.consumers.values()).find((c) => c.producerId === producerId);
        if (consumer) {
          consumer.close();
          this.consumers.delete(consumer.id);
        }
        let participant = this.participants.get(peerId);
        if (!participant) {
          for (const [k, p] of this.participants.entries()) {
            if (p.id === peerId || k === peerId || (p as any).baseUserId === peerId) {
              participant = p;
              break;
            }
          }
        }
        if (participant) {
          if (consumer?.kind === "video" || participant.videoTrack?.id === consumer?.track?.id) {
            participant.videoTrack = undefined;
            participant.isVideoMuted = true;
          }
          if (consumer?.kind === "audio" || participant.audioTrack?.id === consumer?.track?.id) {
            participant.audioTrack = undefined;
            participant.isAudioMuted = true;
          }
          if (participant.screenTrack?.id === consumer?.track?.id) {
            participant.screenTrack = undefined;
          }
          this.notifyParticipants();
        }
      });

      // Handle real-time peer mute state notifications
      const handlePeerMuteState = (data: any) => {
        if (!data) return;
        const targetId = data.peerId || data.userId;
        if (!targetId || targetId === this.currentUserId) return;
        let p = this.participants.get(targetId);
        if (!p) {
          for (const [k, item] of this.participants.entries()) {
            if (item.id === targetId || k === targetId || (item as any).baseUserId === targetId) {
              p = item;
              break;
            }
          }
        }
        if (p) {
          if (data.isAudioMuted !== undefined) {
            p.isAudioMuted = data.isAudioMuted;
            if (data.isAudioMuted) {
              p.audioTrack = undefined;
            }
          }
          if (data.isVideoMuted !== undefined) {
            p.isVideoMuted = data.isVideoMuted;
            if (data.isVideoMuted) {
              p.videoTrack = undefined;
            }
          }
          this.notifyParticipants();
        }
      };
      this.socket.on("peerMuteState", handlePeerMuteState);
      this.socket.on("peer:mute", handlePeerMuteState);

      // In-meeting signaling: Chat & Meeting Control Channel
      const recentMicRequests = new Map<string, number>();
      const dispatchMicRequest = (userId: string, name: string, correlationId?: string, roomCode?: string) => {
        const cId = correlationId || `mic-req-${Date.now()}`;
        const now = Date.now();
        const last = recentMicRequests.get(userId) || 0;
        if (now - last < 2000) {
          console.log(`[MicFlow][${cId}] Debounced duplicate mic request for user:`, userId);
          return;
        }
        recentMicRequests.set(userId, now);
        console.log(`[MicFlow][${cId}] Dispatching onUnmuteRequest to UI:`, {
          userId,
          name,
          roomCode: roomCode || this.roomId,
          isHostUser: this.isHostUser,
        });
        this.onUnmuteRequest?.({ userId, name, timestamp: now, correlationId: cId, roomCode: roomCode || this.roomId });
      };

      const handleChatMessage = (msg: any) => {
        // Intercept real-time control signals (mic request/response, force mute, mute state, class ended)
        if (msg?.isControl) {
          const cId = msg.correlationId || `${msg.controlAction}-${msg.targetUserId || msg.userId || "all"}-${Math.floor(Date.now() / 1500)}`;

          // Deduplicate multi-channel signaling (chatMessage + dedicated events)
          if (this.processedControlIds.has(cId)) {
            console.log(`[MicFlow][${cId}] Ignored duplicate control action:`, msg.controlAction);
            return;
          }
          this.processedControlIds.add(cId);
          if (this.processedControlIds.size > 200) {
            const first = this.processedControlIds.values().next().value;
            if (first) this.processedControlIds.delete(first);
          }

          console.log(`[MicFlow][${cId}] Control message received:`, {
            controlAction: msg.controlAction,
            senderId: msg.senderId || msg.userId,
            targetUserId: msg.targetUserId,
            roomCode: msg.roomCode,
            currentRoom: this.roomId,
          });

          if (msg.controlAction === "CLASS_ENDED") {
            this.chatMessages = [];
            this.onClassEnded?.();
            return;
          }

          // Room code isolation check (normalized)
          const msgRoom = (msg.roomCode || "").toLowerCase().trim();
          const curRoom = (this.roomId || "").toLowerCase().trim();
          if (msgRoom && curRoom && msgRoom !== curRoom) {
            console.warn(`[MicFlow][${cId}] Dropped control action for different room: received ${msgRoom}, expected ${curRoom}`);
            return;
          }

          // Privileged control actions security check (FORCE_MUTE, MIC_RESPONSE)
          if (msg.controlAction === "FORCE_MUTE" || msg.controlAction === "MIC_RESPONSE") {
            const senderId = msg.senderId || msg.userId;

            // Student can never self-authorize speaking or force mute other students
            if (!this.isHostUser && senderId === this.currentUserId) {
              console.warn(`[MicFlow][${cId}] Rejected student self-authorized control action:`, msg.controlAction);
              return;
            }

            // Verify tutor / host authorization
            let isSenderAuthorized = false;
            if (this.authorizedTutorId && (senderId === this.authorizedTutorId || senderId?.toLowerCase() === this.authorizedTutorId.toLowerCase())) {
              isSenderAuthorized = true;
            } else {
              const peer = this.participants.get(senderId);
              if (peer && (peer.role === "host" || peer.role === "tutor")) {
                isSenderAuthorized = true;
              } else if (msg.isHost || msg.senderRole === "tutor" || msg.senderRole === "host") {
                isSenderAuthorized = true;
              }
            }

            if (!isSenderAuthorized) {
              console.warn(`[MicFlow][${cId}] Dropped unauthorized control action from non-host:`, msg.controlAction, "senderId:", senderId);
              return;
            }
          }

          this.onControlMessage?.(msg);
          if (msg.controlAction === "REQUEST_MIC") {
            dispatchMicRequest(msg.userId || msg.senderId || "unknown", msg.name || "Student", cId, msg.roomCode);
          } else if (msg.controlAction === "PEER_MUTE_STATE") {
            handlePeerMuteState(msg);
          }
          return;
        }

        const normalized: ChatMessage = {
          id: msg.id || msg._id || msg.clientMessageId || Math.random().toString(36).substring(2, 9),
          clientMessageId: msg.clientMessageId,
          senderId: msg.senderId || msg.from?.identity || "remote",
          senderName: msg.senderName || msg.from?.name || "Student",
          senderRole: msg.senderRole,
          text: msg.text || msg.message || msg.content || "",
          timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isHost: Boolean(msg.isHost || msg.senderRole === "tutor" || msg.senderRole === "host"),
        };
        if (!this.chatMessages.some((m) => m.id === normalized.id)) {
          this.chatMessages.push(normalized);
        }
        this.onChatMessage?.(normalized);
      };
      this.socket.on("chatMessage", handleChatMessage);
      this.socket.on("chat:message", handleChatMessage);

      // In-meeting signaling: Dedicated Unmute Response & Force Mute events
      const handleDedicatedControl = (data: any) => {
        if (data && typeof data === "object") {
          handleChatMessage({ isControl: true, ...data });
        }
      };
      this.socket.on("unmuteResponse", handleDedicatedControl);
      this.socket.on("unmute:response", handleDedicatedControl);
      this.socket.on("mic:response", handleDedicatedControl);
      this.socket.on("peerMuteForce", handleDedicatedControl);
      this.socket.on("mute:force", handleDedicatedControl);

      // In-meeting signaling: Chat locking & notices
      this.socket.on("chatLock", ({ locked }: any) => {
        this.onChatLockChange?.(Boolean(locked));
      });
      this.socket.on("chatPin", ({ message }: any) => {
        this.onPinnedMessageChange?.(message || null);
      });

      // In-meeting signaling: Class ended
      const handleClassEnded = () => {
        this.chatMessages = [];
        this.onClassEnded?.();
      };
      this.socket.on("classEnded", handleClassEnded);
      this.socket.on("class:ended", handleClassEnded);

      // In-meeting signaling: Microphone Unmute Request (Server-routed from student to tutor)
      const handleUnmuteRequest = (req: any) => {
        const cId = req?.correlationId || `mic-req-${Date.now()}`;
        console.log(`[MicFlow][${cId}] Tutor socket received unmuteRequest event:`, {
          req,
          currentRoom: this.roomId,
          isHostUser: this.isHostUser,
        });

        // Room code isolation check (normalized)
        const reqRoom = (req?.roomCode || "").toLowerCase().trim();
        const curRoom = (this.roomId || "").toLowerCase().trim();
        if (reqRoom && curRoom && reqRoom !== curRoom) {
          console.warn(`[MicFlow][${cId}] Rejected: roomCode mismatch. Received ${reqRoom}, expected ${curRoom}`);
          return;
        }

        const userId = req.userId || req.peerId || req.id || req.senderId || "unknown";
        const name = req.name || req.senderName || "Student";
        dispatchMicRequest(userId, name, cId, reqRoom || this.roomId);
      };
      this.socket.on("unmuteRequest", handleUnmuteRequest);
      this.socket.on("unmute:request", handleUnmuteRequest);
      this.socket.on("unmute:request", handleUnmuteRequest);

      // In-meeting signaling: Polls
      const handlePollUpdate = (polls: Poll[]) => {
        this.activePolls = polls;
        this.onPollsChange?.(polls);
      };
      this.socket.on("pollUpdate", handlePollUpdate);
      this.socket.on("poll:update", handlePollUpdate);

      // In-meeting signaling: Reactions
      const handleReaction = (reaction: ReactionEvent) => {
        this.onReaction?.(reaction);
      };
      this.socket.on("reaction", handleReaction);
      this.socket.on("reaction:receive", handleReaction);

      // In-meeting signaling: Whiteboard
      const handleWhiteboard = (data: any) => {
        this.onWhiteboardData?.(data);
      };
      this.socket.on("whiteboardDraw", handleWhiteboard);
      this.socket.on("whiteboard:broadcast", handleWhiteboard);
      this.socket.on("whiteboard:state", (data: any) => {
        if (data && typeof data === "object") {
          this.onControlMessage?.({
            isControl: true,
            controlAction: "WHITEBOARD_STATE",
            ...data,
          });
        }
      });

      // In-meeting signaling: Raise Hand
      const handleRaiseHand = ({ peerId, id, raised, isHandRaised }: any) => {
        const targetId = peerId || id;
        const isRaised = isHandRaised ?? raised ?? false;
        const p = this.participants.get(targetId);
        if (p) {
          p.isHandRaised = isRaised;
          this.notifyParticipants();
        }
      };
      this.socket.on("raiseHand", handleRaiseHand);
      this.socket.on("hand:state", handleRaiseHand);
    });
  }

  private async createTransports(roomId: string) {
    if (!this.device || !this.device.loaded) return;

    try {
      // Create both send and receive transports concurrently for minimal latency
      const [sendRes, recvRes] = await Promise.all([
        this.request("createWebRtcTransport", { producing: true, consuming: false }),
        this.request("createWebRtcTransport", { producing: false, consuming: true }),
      ]);

      // 1. Initialize Send Transport
      const rawSendData = sendRes?.params || sendRes;
      const sendTransportData = sanitizeTransportData(rawSendData, this.signalingUrl);
      if (sendTransportData && sendTransportData.id) {
        this.sendTransport = this.device.createSendTransport(sendTransportData);

        this.sendTransport.on("connectionstatechange", (state: string) => {
          console.log(`[MathsyMeet Engine] Send transport connection state: ${state}`);
        });

        this.sendTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
          try {
            await this.request("connectWebRtcTransport", {
              transportId: this.sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (e) {
            console.error("[MathsyMeet Engine] sendTransport connect error:", e);
            errback(e);
          }
        });

        this.sendTransport.on("produce", async ({ kind, rtpParameters, appData }: any, callback: any, errback: any) => {
          try {
            const res = await this.request("produce", {
              transportId: this.sendTransport.id,
              kind,
              rtpParameters,
              appData,
            });
            callback({ id: res?.id || res });
          } catch (e) {
            console.error("[MathsyMeet Engine] sendTransport produce error:", e);
            errback(e);
          }
        });

        // Produce any already-active local tracks that were enabled prior to transport readiness
        if (this.localVideoTrack && !this.producers.has("video")) {
          try {
            const prod = await this.sendTransport.produce({
              track: this.localVideoTrack,
              appData: { mediaType: "video" }
            });
            this.producers.set("video", prod);
            console.log("[MathsyMeet Engine] Auto-produced local video track:", prod.id);
          } catch (e: any) {
            console.warn("[MathsyMeet Engine] Auto-produce video note:", e.message);
          }
        }

        if (this.localAudioTrack && !this.producers.has("audio")) {
          try {
            const prod = await this.sendTransport.produce({
              track: this.localAudioTrack,
              appData: { mediaType: "audio" }
            });
            this.producers.set("audio", prod);
            console.log("[MathsyMeet Engine] Auto-produced local audio track:", prod.id);
          } catch (e: any) {
            console.warn("[MathsyMeet Engine] Auto-produce audio note:", e.message);
          }
        }

        if (this.localScreenTrack && !this.producers.has("screen")) {
          try {
            const prod = await this.sendTransport.produce({
              track: this.localScreenTrack,
              appData: { mediaType: "screen" }
            });
            this.producers.set("screen", prod);
            console.log("[MathsyMeet Engine] Auto-produced screen track:", prod.id);
          } catch (e: any) {
            console.warn("[MathsyMeet Engine] Auto-produce screen note:", e.message);
          }
        }
      }

      // 2. Initialize Receive Transport
      const rawRecvData = recvRes?.params || recvRes;
      const recvTransportData = sanitizeTransportData(rawRecvData, this.signalingUrl);
      if (recvTransportData && recvTransportData.id) {
        this.recvTransport = this.device.createRecvTransport(recvTransportData);

        this.recvTransport.on("connectionstatechange", (state: string) => {
          console.log(`[MathsyMeet Engine] Recv transport connection state: ${state}`);
        });

        this.recvTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
          try {
            await this.request("connectWebRtcTransport", {
              transportId: this.recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (e) {
            console.error("[MathsyMeet Engine] recvTransport connect error:", e);
            errback(e);
          }
        });
      }
    } catch (err: any) {
      console.warn("[MathsyMeet Engine] Create transports notice:", err.message);
    }
  }

  private async consumeTrack(producerId: string, peerId: string, kind: "audio" | "video", source?: string) {
    // Wait briefly if receive transport is currently being initialized
    if (!this.recvTransport || !this.device) {
      let retries = 0;
      while ((!this.recvTransport || !this.device) && retries < 40) {
        await new Promise((r) => setTimeout(r, 150));
        retries++;
      }
      if (!this.recvTransport || !this.device) {
        console.warn("[MathsyMeet Engine] consumeTrack dropped: recvTransport not initialized in time");
        return;
      }
    }

    try {
      const res = await this.request("consume", {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });

      const data = res?.params || res;
      if (!data || !data.id) return;

      const consumer = await this.recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      await this.request("resumeConsumer", { consumerId: consumer.id });
      try {
        consumer.resume();
      } catch {}

      let participant = this.participants.get(peerId);
      if (!participant) {
        for (const [k, p] of this.participants.entries()) {
          if (p.id === peerId || k === peerId) {
            participant = p;
            break;
          }
        }
      }
      if (!participant) {
        participant = {
          id: peerId,
          name: "Participant",
          role: "student",
        };
        this.participants.set(peerId, participant);
      }

      if (source === "screen") {
        participant.screenTrack = consumer.track;
      } else if (kind === "video") {
        participant.videoTrack = consumer.track;
        participant.isVideoMuted = false;
      } else if (kind === "audio") {
        participant.audioTrack = consumer.track;
        participant.isAudioMuted = false;
      }

      consumer.track.addEventListener("unmute", () => {
        console.log(`[MathsyMeet Engine] Remote ${kind} track UNMUTED from peer:`, peerId);
        if (kind === "video") participant!.isVideoMuted = false;
        if (kind === "audio") participant!.isAudioMuted = false;
        this.notifyParticipants();
      });

      console.log(`[MathsyMeet Engine] Consumed remote ${kind} track from peer:`, peerId);
      this.notifyParticipants();
    } catch (err: any) {
      console.warn("[MathsyMeet Engine] consumeTrack error:", err.message);
    }
  }

  public async enableAudio(): Promise<MediaStreamTrack | null> {
    if (this.isEnablingAudio) {
      console.log("[MathsyMeet Engine] enableAudio already in progress, awaiting existing run");
      return this.localAudioTrack;
    }
    if (this.localAudioTrack && this.localAudioTrack.readyState === "live" && this.producers.has("audio")) {
      console.log("[MathsyMeet Engine] Audio track is already active and producing");
      this.broadcastMuteState(false, undefined);
      return this.localAudioTrack;
    }

    this.isEnablingAudio = true;
    try {
      if (this.localAudioTrack) {
        this.disableAudio();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const track = stream.getAudioTracks()[0];
      this.localAudioTrack = track;

      if (this.sendTransport) {
        try {
          const producer = await this.sendTransport.produce({ track, appData: { mediaType: "audio" } });
          this.producers.set("audio", producer);
          console.log("[MathsyMeet Engine] Audio producer created:", producer.id);
          this.broadcastMuteState(false, undefined);
        } catch (prodErr: any) {
          console.warn("[MathsyMeet Engine] Produce audio error:", prodErr.message);
        }
      }
      return track;
    } catch (e: any) {
      console.error("[MathsyMeet] enableAudio error:", e.message);
      throw e;
    } finally {
      this.isEnablingAudio = false;
    }
  }

  public disableAudio() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack = null;
    }
    const producer = this.producers.get("audio");
    if (producer) {
      const prodId = producer.id;
      producer.close();
      this.producers.delete("audio");
      this.request("closeProducer", { producerId: prodId }).catch(() => {});
      this.socket?.emit("producerClose", { producerId: prodId });
    }
    this.broadcastMuteState(true, undefined);
  }

  public async enableVideo(deviceId?: string): Promise<MediaStreamTrack | null> {
    try {
      if (this.localVideoTrack) {
        this.disableVideo();
      }
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      this.localVideoTrack = track;

      if (this.sendTransport) {
        try {
          const producer = await this.sendTransport.produce({ track, appData: { mediaType: "video" } });
          this.producers.set("video", producer);
          console.log("[MathsyMeet Engine] Video producer created:", producer.id);
          this.broadcastMuteState(undefined, false);
        } catch (prodErr: any) {
          console.warn("[MathsyMeet Engine] Produce video error:", prodErr.message);
        }
      }
      return track;
    } catch (e: any) {
      console.error("[MathsyMeet] enableVideo error:", e.message);
      return null;
    }
  }

  public disableVideo() {
    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
      this.localVideoTrack = null;
    }
    const producer = this.producers.get("video");
    if (producer) {
      const prodId = producer.id;
      producer.close();
      this.producers.delete("video");
      this.request("closeProducer", { producerId: prodId }).catch(() => {});
      this.socket?.emit("producerClose", { producerId: prodId });
    }
    this.broadcastMuteState(undefined, true);
  }

  public async startScreenShare(): Promise<MediaStreamTrack | null> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const track = stream.getVideoTracks()[0];
      this.localScreenTrack = track;

      track.onended = () => {
        this.stopScreenShare();
      };

      if (this.sendTransport) {
        const producer = await this.sendTransport.produce({ track, appData: { mediaType: "screen" } });
        this.producers.set("screen", producer);
      }
      return track;
    } catch (e: any) {
      console.error("[MathsyMeet] startScreenShare error:", e.message);
      return null;
    }
  }

  public stopScreenShare() {
    if (this.localScreenTrack) {
      this.localScreenTrack.stop();
      this.localScreenTrack = null;
    }
    const producer = this.producers.get("screen");
    if (producer) {
      const prodId = producer.id;
      producer.close();
      this.producers.delete("screen");
      this.request("closeProducer", { producerId: prodId }).catch(() => {});
      this.socket?.emit("producerClose", { producerId: prodId });
    }
  }

  public broadcastMuteState(isAudioMuted?: boolean, isVideoMuted?: boolean) {
    const payload = {
      peerId: this.currentUserId,
      userId: this.currentUserId,
      isAudioMuted,
      isVideoMuted,
    };
    this.socket?.emit("peerMuteState", payload);
    this.socket?.emit("chatMessage", {
      isControl: true,
      controlAction: "PEER_MUTE_STATE",
      ...payload,
    });
  }

  public sendChatMessage(senderName: string, text: string, isHost = false) {
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 10),
      senderId: this.currentUserId || this.socket?.id || "local",
      senderName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHost
    };
    if (!this.chatMessages.some((m) => m.id === msg.id)) {
      this.chatMessages.push(msg);
    }
    this.socket?.emit("chatMessage", msg);
  }

  public broadcastChatMessage(msg: ChatMessage) {
    if (!this.chatMessages.some((m) => m.id === msg.id)) {
      this.chatMessages.push(msg);
    }
    this.socket?.emit("chatMessage", msg);
  }

  public emitChatLock(locked: boolean) {
    this.socket?.emit("chatLock", { locked });
  }

  public emitChatPin(message: { text: string; senderName: string } | null) {
    this.socket?.emit("chatPin", { message });
  }

  public broadcastClassEnded() {
    this.chatMessages = [];
    this.socket?.emit("classEnded");
    this.socket?.emit("class:ended");
    this.socket?.emit("chatMessage", {
      isControl: true,
      controlAction: "CLASS_ENDED",
    });
  }

  public sendReaction(senderName: string, emoji: string) {
    const reaction: ReactionEvent = {
      id: Math.random().toString(36).substring(2, 10),
      senderName,
      emoji
    };
    this.socket?.emit("reaction", reaction);
    this.socket?.emit("reaction:send", reaction);
    this.onReaction?.(reaction);
  }

  public toggleHandRaise(senderName: string, isRaised: boolean) {
    const payload = { peerId: this.currentUserId, isHandRaised: isRaised, raised: isRaised, name: senderName };
    this.socket?.emit("raiseHand", payload);
    this.socket?.emit("hand:toggle", payload);
  }

  public requestMic(userId: string, name: string, correlationId?: string) {
    const cId = correlationId || `mic-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const payload = {
      type: "REQUEST_UNMUTE",
      correlationId: cId,
      userId,
      name,
      senderId: this.currentUserId,
      roomCode: this.roomId,
      timestamp: Date.now(),
    };
    console.log(`[MicFlow][${cId}] Student emitting requestMic:`, {
      roomCode: this.roomId,
      userId,
      name,
      senderId: this.currentUserId,
      socketConnected: this.socket?.connected,
    });
    this.socket?.emit("unmuteRequest", payload);
    this.socket?.emit("unmute:request", payload);
    this.socket?.emit("chatMessage", {
      isControl: true,
      controlAction: "REQUEST_MIC",
      correlationId: cId,
      userId,
      name,
      senderId: this.currentUserId,
      roomCode: this.roomId,
      timestamp: Date.now(),
    });
    return cId;
  }

  public cancelMicRequest(userId: string, correlationId?: string) {
    const cId = correlationId || `mic-cancel-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const payload = {
      isControl: true,
      controlAction: "CANCEL_REQUEST",
      correlationId: cId,
      userId,
      senderId: this.currentUserId,
      roomCode: this.roomId,
      timestamp: Date.now(),
    };
    console.log(`[MicFlow][${cId}] Student emitting cancelMicRequest:`, {
      roomCode: this.roomId,
      userId,
      senderId: this.currentUserId,
    });
    this.socket?.emit("chatMessage", payload);
    this.socket?.emit("mic:cancel", payload);
  }

  public respondMicRequest(targetUserId: string, approved: boolean, tutorName: string, correlationId?: string) {
    const cId = correlationId || `mic-resp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const payload: ControlMessageEvent = {
      isControl: true,
      controlAction: "MIC_RESPONSE",
      correlationId: cId,
      targetUserId,
      userId: targetUserId,
      approved,
      tutorName,
      senderId: this.currentUserId,
      senderRole: "tutor",
      isHost: true,
      roomCode: this.roomId,
      timestamp: Date.now(),
    };
    console.log(`[MicFlow][${cId}] Tutor emitting respondMicRequest:`, {
      roomCode: this.roomId,
      targetUserId,
      approved,
      tutorName,
      senderId: this.currentUserId,
    });
    this.socket?.emit("chatMessage", payload);
    this.socket?.emit("mic:response", payload);
    this.socket?.emit("unmuteResponse", payload);
  }

  public forceMuteParticipant(targetUserId: string) {
    const payload: ControlMessageEvent = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      targetUserId,
      all: false,
      senderId: this.currentUserId,
      senderRole: "tutor",
      isHost: true,
      roomCode: this.roomId,
      timestamp: Date.now(),
    };
    this.socket?.emit("chatMessage", payload);
    this.socket?.emit("peerMuteForce", payload);
    this.socket?.emit("peerMuteState", { peerId: targetUserId, muted: true, forced: true });
  }

  public forceMuteAll() {
    const payload: ControlMessageEvent = {
      isControl: true,
      controlAction: "FORCE_MUTE",
      all: true,
      senderId: this.currentUserId,
      senderRole: "tutor",
      isHost: true,
      roomCode: this.roomId,
      timestamp: Date.now(),
    };
    this.socket?.emit("chatMessage", payload);
    this.socket?.emit("peerMuteForce", payload);
    this.socket?.emit("forceMuteAll");
  }

  public broadcastWhiteboard(data: any) {
    this.socket?.emit("whiteboardDraw", data);
    this.socket?.emit("whiteboard:sync", data);
    this.socket?.emit("whiteboard:broadcast", data);
  }

  public broadcastWhiteboardState(roomCode: string, isOpen: boolean, isHost: boolean = true) {
    const payload: ControlMessageEvent = {
      isControl: true,
      controlAction: "WHITEBOARD_STATE",
      roomCode,
      isOpen,
      layoutMode: isOpen ? "whiteboard" : "grid",
      isHost,
      senderId: this.currentUserId,
      timestamp: Date.now(),
    };
    this.socket?.emit("chatMessage", payload);
    this.socket?.emit("whiteboard:state", payload);
  }

  public toggleWhiteboardDrawing(allowed: boolean) {
    this.letStudentsDraw = allowed;
    this.socket?.emit("whiteboard:toggleDrawing", { allowed });
  }

  public forceMuteStudent(studentId: string) {
    this.socket?.emit("forceMute", { studentId });
  }

  public expelStudent(studentId: string, reason?: string) {
    this.socket?.emit("expelStudent", { studentId, reason });
  }

  public lowerStudentHand(studentId?: string) {
    this.socket?.emit("hand:lower", { studentId });
  }

  public lowerAllHands() {
    this.socket?.emit("hand:lowerAll");
  }

  public setChatLock(locked: boolean) {
    this.isChatLocked = locked;
    this.socket?.emit("chatLock", { locked });
  }

  public setChatPin(message: any) {
    this.pinnedMessage = message;
    this.socket?.emit("chatPin", { message });
  }

  public requestCameraOff(reason?: string) {
    this.socket?.emit("cameraOffRequest", { reason });
  }

  public respondCameraOff(studentId: string, approved: boolean) {
    this.socket?.emit("cameraOffResponse", { studentId, approved });
  }

  public createPoll(question: string, options: string[], creatorName: string) {
    const newPoll: Poll = {
      id: "poll_" + Date.now(),
      question,
      options: options.map((opt, i) => ({ id: `opt_${i}`, text: opt, votes: 0 })),
      creatorName,
      isActive: true,
      totalVotes: 0
    };
    this.activePolls.unshift(newPoll);
    this.socket?.emit("pollUpdate", this.activePolls);
    this.socket?.emit("poll:create", newPoll);
    this.onPollsChange?.(this.activePolls);
  }

  public votePoll(pollId: string, optionId: string) {
    const poll = this.activePolls.find(p => p.id === pollId);
    if (!poll || poll.userVotedId) return;

    poll.userVotedId = optionId;
    const opt = poll.options.find(o => o.id === optionId);
    if (opt) {
      opt.votes += 1;
      poll.totalVotes += 1;
    }
    this.socket?.emit("pollUpdate", this.activePolls);
    this.socket?.emit("poll:vote", { pollId, optionId });
    this.onPollsChange?.(this.activePolls);
  }

  public emitSignal(event: string, payload: any, ack?: (res: any) => void): void {
    if (this.socket) {
      if (ack) {
        this.socket.emit(event, payload, ack);
      } else {
        this.socket.emit(event, payload);
      }
    }
  }

  public onSignal(event: string, callback: (payload: any) => void): () => void {
    if (this.socket) {
      this.socket.off(event, callback);
      this.socket.on(event, callback);
    }
    return () => {
      this.socket?.off(event, callback);
    };
  }

  public disconnect() {
    this.disableAudio();
    this.disableVideo();
    this.stopScreenShare();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.participants.clear();
    this.producers.clear();
    this.consumers.clear();
  }

  private notifyParticipants() {
    this.onParticipantsChange?.(Array.from(this.participants.values()));
  }

  private request(type: string, data = {}): Promise<any> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(null);
      this.socket.emit(type, data, (response: any) => {
        resolve(response);
      });
    });
  }
}
