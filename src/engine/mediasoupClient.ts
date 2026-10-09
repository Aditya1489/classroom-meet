import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";

export interface RemoteParticipant {
  id: string;
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

  public serverRole: "tutor" | "student" = "student";
  public isServerOwner: boolean = false;

  // Listeners
  public onRoleAssigned?: (role: "tutor" | "student", isOwner: boolean) => void;
  public onParticipantsChange?: (participants: RemoteParticipant[]) => void;
  public onChatMessage?: (message: ChatMessage) => void;
  public onPollsChange?: (polls: Poll[]) => void;
  public onReaction?: (reaction: ReactionEvent) => void;
  public onWhiteboardData?: (data: any) => void;
  public onConnectionStateChange?: (state: "connecting" | "connected" | "disconnected" | "failed") => void;

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
  }) {
    if (!this.signalingUrl) {
      const errMsg = "Server not configured: VITE_MEDIASOUP_SERVER_URL is missing.";
      console.error(`[MathsyMeet Engine] ${errMsg}`);
      this.onConnectionStateChange?.("failed");
      throw new Error(errMsg);
    }

    this.onConnectionStateChange?.("connecting");

    let effectiveToken = token && token.trim().length > 0 ? token.trim() : "";
    if (!effectiveToken) {
      // Guest student: Request genuine short-lived guest token from the SFU server
      try {
        const guestRes = await fetch(`${this.signalingUrl.replace(/\/$/, "")}/api/guest-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: userName, guestId: userId })
        });
        if (guestRes.ok) {
          const guestData = await guestRes.json();
          effectiveToken = guestData.token;
        } else {
          console.error("[MathsyMeet Engine] Failed to obtain guest token:", guestRes.status);
        }
      } catch (err: any) {
        console.error("[MathsyMeet Engine] Network error requesting guest token:", err.message);
      }
    }

    // Establish WebSocket to Mediasoup signaling server
    this.socket = io(this.signalingUrl, {
      query: {
        token: effectiveToken,
        classId: roomId,
        name: userName,
        role: role === "host" ? "tutor" : "student",
        peerIdentity: `${userId}_${Math.random().toString(36).substring(2, 7)}`,
      },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.socket.on("connect", async () => {
      console.log("[MathsyMeet Engine] Socket connected to Mediasoup server:", this.signalingUrl);
      this.onConnectionStateChange?.("connected");
      await this.initMediasoupDevice();
      await this.createTransports(roomId);
    });

    this.socket.on("connect_error", (err) => {
      console.error("[MathsyMeet Engine] Socket connection error:", err.message);
      this.onConnectionStateChange?.("failed");
    });

    this.socket.on("disconnect", () => {
      console.log("[MathsyMeet Engine] Socket disconnected");
      this.onConnectionStateChange?.("disconnected");
    });

    // Handle room join confirmation from server
    this.socket.on("roomJoined", (data: { role?: "tutor" | "student"; isOwner?: boolean }) => {
      if (data?.role) {
        this.serverRole = data.role === "tutor" ? "tutor" : "student";
        this.isServerOwner = Boolean(data.isOwner);
        console.log(`[MathsyMeet Engine] Server confirmed role: ${this.serverRole}, isOwner: ${this.isServerOwner}`);
        this.onRoleAssigned?.(this.serverRole, this.isServerOwner);
      }
    });

    // Handle peer lifecycle events
    this.socket.on("peer-joined", (peer: { id: string; name: string; role: string }) => {
      this.participants.set(peer.id, {
        id: peer.id,
        name: peer.name,
        role: peer.role,
        isSpeaking: false,
        isHandRaised: false
      });
      this.notifyParticipants();
    });

    this.socket.on("peer-left", (peerId: string) => {
      this.participants.delete(peerId);
      this.notifyParticipants();
    });

    // Handle incoming media producers
    this.socket.on("new-producer", async (data: { producerId: string; peerId: string; kind: "audio" | "video"; source?: string }) => {
      await this.consumeTrack(data.producerId, data.peerId, data.kind, data.source);
    });

    // In-meeting signaling
    this.socket.on("chat:message", (msg: ChatMessage) => {
      this.chatMessages.push(msg);
      this.onChatMessage?.(msg);
    });

    this.socket.on("poll:update", (polls: Poll[]) => {
      this.activePolls = polls;
      this.onPollsChange?.(polls);
    });

    this.socket.on("reaction:receive", (reaction: ReactionEvent) => {
      this.onReaction?.(reaction);
    });

    this.socket.on("whiteboard:broadcast", (data: any) => {
      this.onWhiteboardData?.(data);
    });

    this.socket.on("hand:state", ({ peerId, raised }: { peerId: string; raised: boolean }) => {
      const p = this.participants.get(peerId);
      if (p) {
        p.isHandRaised = raised;
        this.notifyParticipants();
      }
    });
  }

  private async initMediasoupDevice() {
    try {
      this.device = new Device();
      const routerRtpCapabilities = await this.request("getRouterRtpCapabilities");
      if (routerRtpCapabilities && !this.device.loaded) {
        await this.device.load({ routerRtpCapabilities });
      }
    } catch (err: any) {
      console.warn("[MathsyMeet Engine] Mediasoup Device initialization note:", err.message);
    }
  }

  private async createTransports(roomId: string) {
    if (!this.device || !this.device.loaded) return;

    try {
      // 1. Create Send Transport
      const sendTransportData = await this.request("createWebRtcTransport", { producing: true, consuming: false });
      if (sendTransportData) {
        this.sendTransport = this.device.createSendTransport(sendTransportData);
        this.sendTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
          try {
            await this.request("connectWebRtcTransport", {
              transportId: this.sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (e) {
            errback(e);
          }
        });

        this.sendTransport.on("produce", async ({ kind, rtpParameters, appData }: any, callback: any, errback: any) => {
          try {
            const { id } = await this.request("produce", {
              transportId: this.sendTransport.id,
              kind,
              rtpParameters,
              appData,
            });
            callback({ id });
          } catch (e) {
            errback(e);
          }
        });
      }

      // 2. Create Receive Transport
      const recvTransportData = await this.request("createWebRtcTransport", { producing: false, consuming: true });
      if (recvTransportData) {
        this.recvTransport = this.device.createRecvTransport(recvTransportData);
        this.recvTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
          try {
            await this.request("connectWebRtcTransport", {
              transportId: this.recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (e) {
            errback(e);
          }
        });
      }
    } catch (err: any) {
      console.warn("[MathsyMeet Engine] Create transports notice:", err.message);
    }
  }

  private async consumeTrack(producerId: string, peerId: string, kind: "audio" | "video", source?: string) {
    if (!this.recvTransport || !this.device) return;

    try {
      const data = await this.request("consume", {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });

      if (!data) return;

      const consumer = await this.recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      await this.request("resumeConsumer", { consumerId: consumer.id });

      let participant = this.participants.get(peerId);
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
      } else if (kind === "audio") {
        participant.audioTrack = consumer.track;
      }

      this.notifyParticipants();
    } catch (err: any) {
      console.warn("[MathsyMeet Engine] consumeTrack error:", err.message);
    }
  }

  public async enableAudio(): Promise<MediaStreamTrack | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const track = stream.getAudioTracks()[0];
      this.localAudioTrack = track;

      if (this.sendTransport) {
        const producer = await this.sendTransport.produce({ track, appData: { mediaType: "audio" } });
        this.producers.set("audio", producer);
      }
      return track;
    } catch (e: any) {
      console.error("[MathsyMeet] enableAudio error:", e.message);
      return null;
    }
  }

  public disableAudio() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack = null;
    }
    const producer = this.producers.get("audio");
    if (producer) {
      producer.close();
      this.producers.delete("audio");
    }
  }

  public async enableVideo(deviceId?: string): Promise<MediaStreamTrack | null> {
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      this.localVideoTrack = track;

      if (this.sendTransport) {
        const producer = await this.sendTransport.produce({ track, appData: { mediaType: "video" } });
        this.producers.set("video", producer);
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
      producer.close();
      this.producers.delete("video");
    }
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
      producer.close();
      this.producers.delete("screen");
    }
  }

  public sendChatMessage(senderName: string, text: string, isHost = false) {
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 10),
      senderId: this.socket?.id || "local",
      senderName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHost
    };
    this.chatMessages.push(msg);
    this.socket?.emit("chat:send", msg);
    this.onChatMessage?.(msg);
  }

  public sendReaction(senderName: string, emoji: string) {
    const reaction: ReactionEvent = {
      id: Math.random().toString(36).substring(2, 10),
      senderName,
      emoji
    };
    this.socket?.emit("reaction:send", reaction);
    this.onReaction?.(reaction);
  }

  public toggleHandRaise(senderName: string, isRaised: boolean) {
    this.socket?.emit("hand:toggle", { raised: isRaised, name: senderName });
  }

  public broadcastWhiteboard(data: any) {
    this.socket?.emit("whiteboard:sync", data);
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
    this.socket?.emit("poll:vote", { pollId, optionId });
    this.onPollsChange?.(this.activePolls);
  }

  public emitSignal(event: string, payload: any): void {
    if (this.socket) {
      this.socket.emit(event, payload);
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
