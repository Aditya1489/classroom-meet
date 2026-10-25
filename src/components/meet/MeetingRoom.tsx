import React, { useState, useEffect, useRef } from "react";
import {
  MathsyMediasoupEngine,
  RemoteParticipant,
  ChatMessage,
  Poll,
  ReactionEvent,
} from "../../engine/mediasoupClient";
import { VideoTile } from "./VideoTile";
import { VideoTrackPlayer } from "./VideoTrackPlayer";
import { GoogleMeetAudioVisualizer } from "./GoogleMeetAudioVisualizer";
import { TabletPairingModal } from "./TabletPairingModal";
import { PreJoinCameraGateModal, InClassCameraOffWarningModal } from "./CameraGateModal";
import { FloatingReactionsOverlay, ReactionPickerBar, FloatingReaction } from "./FloatingReactions";
import { PostClassModal } from "./PostClassModal";
import { ClassFeedSidepanel, ChatMsg, PollItem } from "./ClassFeedSidepanel";
import { InfoDrawer } from "./InfoDrawer";
import { Whiteboard } from "../whiteboard/Whiteboard";
import { RecordingModal } from "../recording/RecordingModal";
import { generateTabletCode } from "../../utils/tabletCode";
import { useAuth } from "../../auth/authContext";
import { dbClient } from "../../lib/dbClient";
import { Button } from "../ui/button";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Smile,
  Hand,
  PhoneOff,
  LogOut,
  MessageSquare,
  Users,
  BarChart2,
  Maximize2,
  Minimize2,
  Tablet,
  Disc,
  LayoutGrid,
  Radio,
  Sparkles,
  Shield,
  Loader2,
  AlertCircle,
  Clock,
  Pin,
  GraduationCap,
  BookOpen,
  Youtube,
  ExternalLink,
  Info,
  Check,
  X,
} from "lucide-react";
import { YouTubeConnectModal } from "../youtube/YouTubeConnectModal";
import {
  startYouTubeLiveStreaming,
  stopYouTubeLiveStreaming,
} from "../../services/youtubeService";
import { toast } from "sonner";

interface MeetingRoomProps {
  meetingCode: string;
  initialOptions: {
    micMuted: boolean;
    camOff: boolean;
    displayName: string;
    presentImmediately: boolean;
    role?: "tutor" | "student";
  };
  onLeaveMeeting: () => void;
}

const RemoteAudioElement: React.FC<{ participant: RemoteParticipant }> = ({ participant }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (participant.audioTrack && !participant.isAudioMuted) {
      const stream = new MediaStream([participant.audioTrack]);
      el.srcObject = stream;
      el.play().catch((e) => console.warn(`[MathsyMeet AudioSink] play() error for ${participant.id}:`, e));
    } else {
      el.srcObject = null;
    }
  }, [participant.audioTrack, participant.isAudioMuted]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode,
  initialOptions,
  onLeaveMeeting,
}) => {
  const { profile, user, session } = useAuth();
  const engineRef = useRef<MathsyMediasoupEngine | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  // Host status is authorized server-side based on room ownership (live_classes.tutor_id === user.id)
  // Display names containing "tutor" or "host" confer ZERO privileges.
  const [isHost, setIsHost] = useState<boolean>(() => {
    const fromSession = typeof window !== "undefined" && window.sessionStorage.getItem(`mathsy_host_${meetingCode}`) === "true";
    return initialOptions.role === "tutor" || profile?.role === "tutor" || fromSession;
  });

  const isHostRef = useRef<boolean>(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  // Persistent user identity: strictly maintained across renders to prevent ID desync with Mediasoup SFU & Tutor approvals
  const [myUserId] = useState<string>(() => {
    if (profile?.id) return profile.id.replace(/_/g, "-");
    const sessionKey = `mathsy_uid_${meetingCode}`;
    if (typeof window !== "undefined") {
      const saved = window.sessionStorage.getItem(sessionKey);
      if (saved) return saved.replace(/_/g, "-");
      const generated = "usr-" + Math.random().toString(36).substring(2, 9);
      window.sessionStorage.setItem(sessionKey, generated);
      return generated;
    }
    return "usr-" + Math.random().toString(36).substring(2, 9);
  });

  const myUserIdRef = useRef<string>(myUserId);
  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  const myName = initialOptions.displayName || profile?.name || (isHost ? "Tutor" : "Student");

  // Connection State
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "failed"
  >("connecting");

  // Media States (students join with microphone muted by default)
  const [isMicEnabled, setIsMicEnabled] = useState(Boolean(isHost && !initialOptions.micMuted));
  const [isCamEnabled, setIsCamEnabled] = useState(!initialOptions.camOff);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);

  // Local tracks
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<MediaStreamTrack | null>(null);

  // Remote Participants & Spotlight
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // View / Layout Modes: "grid" | "spotlight" | "whiteboard" | "screenshare"
  const [layoutMode, setLayoutMode] = useState<"grid" | "spotlight" | "whiteboard" | "screenshare">("grid");
  const [showWhiteboard, setShowWhiteboard] = useState(false);

  // Duration Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Fullscreen State
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await playerRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      setIsFullscreen(!isFullscreen);
    }
  };

  // Tablet Companion Pairing Code
  const [tabletCode] = useState(() => generateTabletCode());
  const [showTabletModal, setShowTabletModal] = useState(false);

  // Mandatory Camera Policy State
  const [cameraOffAllowed, setCameraOffAllowed] = useState(false);
  const [showCameraGateModal, setShowCameraGateModal] = useState(!isHost && initialOptions.camOff);
  const [joinPendingApproval, setJoinPendingApproval] = useState(false);
  const [showCameraOffWarningModal, setShowCameraOffWarningModal] = useState(false);
  const [cameraRequests, setCameraRequests] = useState<Array<{ studentId: string; name: string; type: string }>>([]);

  // Approval-gated Microphone State (for students)
  const [hasSpeakingPermission, setHasSpeakingPermission] = useState<boolean>(isHost);
  const [unmuteRequestStatus, setUnmuteRequestStatus] = useState<"none" | "requesting" | "approved">(isHost ? "approved" : "none");
  const [unmuteRequests, setUnmuteRequests] = useState<Array<{ userId: string; name: string }>>([]);

  // Side Drawer State
  const [isSideDrawerOpen, setIsSideDrawerOpen] = useState(false);
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState(false);
  const [activeSideTab, setActiveSideTab] = useState<"chat" | "polls" | "participants">("chat");
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<{ text: string; senderName: string } | null>(null);
  const [isChatLocked, setIsChatLocked] = useState(false);

  // Polls State
  const [activePoll, setActivePoll] = useState<PollItem | null>(null);
  const [hasVotedPoll, setHasVotedPoll] = useState(false);

  // Floating Reactions State
  const [activeReactions, setActiveReactions] = useState<FloatingReaction[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  // Recording State
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // YouTube Live State
  const [isYouTubeLive, setIsYouTubeLive] = useState(false);
  const [youtubeLiveSeconds, setYoutubeLiveSeconds] = useState(0);
  const [youtubeLiveUrl, setYoutubeLiveUrl] = useState("");
  const [showYouTubeConnectModal, setShowYouTubeConnectModal] = useState(false);

  useEffect(() => {
    const handleUrlUpdate = (e: any) => {
      if (e?.detail) setYoutubeLiveUrl(e.detail);
    };
    window.addEventListener("mathsy-update-live-url", handleUrlUpdate);
    return () => window.removeEventListener("mathsy-update-live-url", handleUrlUpdate);
  }, []);

  // Recording Timer
  useEffect(() => {
    let interval: any = null;
    if (isRecordingActive) {
      interval = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecordingActive]);

  // YouTube Live Timer
  useEffect(() => {
    let interval: any = null;
    if (isYouTubeLive) {
      interval = setInterval(() => {
        setYoutubeLiveSeconds((s) => s + 1);
      }, 1000);
    } else {
      setYoutubeLiveSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isYouTubeLive]);

  // Post Class Workflow Modal
  const [showPostClassModal, setShowPostClassModal] = useState(false);

  // Initialize Mediasoup Engine & Listeners
  useEffect(() => {
    const engine = new MathsyMediasoupEngine();
    engineRef.current = engine;

    const loadChatHistory = async () => {
      try {
        const history = await dbClient.getChatHistory(meetingCode);
        if (history && Array.isArray(history.messages)) {
          const mapped: ChatMsg[] = history.messages.map((m: any) => ({
            id: m._id || m.id,
            clientMessageId: m.clientMessageId,
            senderId: m.senderId,
            senderName: m.senderName,
            message: m.text,
            timestamp: m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            isHost: Boolean(m.isHost || m.senderRole === "tutor" || m.senderRole === "host"),
            status: "sent" as const,
          }));

          setChatMessages((prev) => {
            const historyIds = new Set(mapped.map((m) => m.id));
            const historyClientIds = new Set(mapped.map((m) => m.clientMessageId).filter(Boolean));
            const pendingLive = prev.filter(
              (p) => !historyIds.has(p.id) && (!p.clientMessageId || !historyClientIds.has(p.clientMessageId))
            );
            return [...mapped, ...pendingLive];
          });
        }
        if (typeof history?.isChatLocked === "boolean") {
          setIsChatLocked(history.isChatLocked);
        }
        if (history?.pinnedMessage !== undefined) {
          setPinnedMessage(history.pinnedMessage);
        }
      } catch (err) {
        console.warn("[MeetingRoom] Failed to load chat history:", err);
      }
    };

    engine.onConnectionStateChange = (state) => {
      setConnectionState(state);
      if (state === "connected") {
        loadChatHistory();
        dbClient.getWhiteboardState(meetingCode).then((wbState) => {
          if (wbState?.isOpen && !isHostRef.current) {
            setShowWhiteboard(true);
            setLayoutMode("whiteboard");
          }
        });
      }
    };

    engine.onParticipantsChange = (updated) => {
      setRemoteParticipants([...updated]);
    };

    engine.onPeerLeft = (peerId) => {
      console.log("[MeetingRoom] Peer left:", peerId);
      setUnmuteRequests((prev) => prev.filter((r) => r.userId !== peerId && (r as any).peerId !== peerId));
    };

    engine.onChatMessage = (msg: any) => {
      const msgId = msg.id || msg._id || msg.clientMessageId;
      const clientMsgId = msg.clientMessageId;

      setChatMessages((prev) => {
        const exists = prev.some(
          (m) =>
            (msgId && m.id === msgId) ||
            (clientMsgId && (m.id === clientMsgId || m.clientMessageId === clientMsgId))
        );
        if (exists) {
          return prev.map((m) => {
            if (
              (msgId && m.id === msgId) ||
              (clientMsgId && (m.id === clientMsgId || m.clientMessageId === clientMsgId))
            ) {
              return {
                ...m,
                id: msgId || m.id,
                clientMessageId: clientMsgId || m.clientMessageId,
                status: "sent" as const,
                message: msg.text || msg.message || m.message,
                isHost: Boolean(msg.isHost ?? m.isHost),
              };
            }
            return m;
          });
        }

        const normalized: ChatMsg = {
          id: msgId || Math.random().toString(),
          clientMessageId: clientMsgId,
          senderId: msg.senderId || msg.from?.identity || "unknown",
          senderName: msg.senderName || msg.from?.name || "Student",
          message: msg.text || msg.message || "",
          timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isHost: Boolean(msg.isHost),
          status: "sent" as const,
        };

        return [...prev, normalized];
      });

      // Never count current user's own messages as unread!
      const isMyMessage = msg.senderId === myUserId;
      if (!isMyMessage && (!isSideDrawerOpen || activeSideTab !== "chat")) {
        setUnreadChatCount((c) => c + 1);
      }
    };

    engine.onChatLockChange = (locked) => {
      setIsChatLocked(locked);
      toast.info(locked ? "Chat has been locked by tutor" : "Chat has been unlocked", { id: "chat-lock" });
    };

    engine.onPinnedMessageChange = (pin) => {
      setPinnedMessage(pin);
      if (pin) {
        toast.success("New announcement pinned at the top", { id: "pinned-msg" });
      }
    };

    engine.onClassEnded = () => {
      setChatMessages([]);
      setIsChatLocked(true);
      setPinnedMessage(null);
      setUnmuteRequests([]);
      setHasSpeakingPermission(false);
      setUnmuteRequestStatus("none");
      toast.info("The class has ended. Chat history has been cleared.", { id: "class-ended" });
    };

    engine.onReaction = (r: ReactionEvent) => {
      const newR: FloatingReaction = {
        id: Date.now() + Math.random().toString(),
        emoji: r.emoji,
        x: Math.random() * 70 + 15,
        userName: r.senderName,
      };
      setActiveReactions((prev) => [...prev, newR]);
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter((item) => item.id !== newR.id));
      }, 2500);
    };

    // Microphone speaking request handling (Student -> Tutor)
    engine.onUnmuteRequest = (req) => {
      console.log(`[MicFlow][${req.correlationId || "unknown"}] MeetingRoom onUnmuteRequest:`, {
        req,
        isHostRef: isHostRef.current,
        myUserId,
      });
      if (!isHostRef.current) {
        console.warn(`[MicFlow][${req.correlationId || "unknown"}] Dropped onUnmuteRequest: current user is not tutor/host`);
        return;
      }
      setUnmuteRequests((prev) => {
        if (prev.some((r) => r.userId === req.userId)) {
          console.log(`[MicFlow][${req.correlationId || "unknown"}] Request already queued for student:`, req.userId);
          return prev;
        }
        console.log(`[MicFlow][${req.correlationId || "unknown"}] Added to unmuteRequests queue. New size:`, prev.length + 1);
        return [...prev, req];
      });
    };

    // Real-time meeting control signals (mic approval, force mute, cancel request)
    engine.onControlMessage = (ctrl) => {
      const targetId = (ctrl.targetUserId || ctrl.userId || (ctrl as any).peerId || "").toLowerCase().replace(/_/g, "-");
      const currentId = (myUserIdRef.current || myUserId || "").toLowerCase().replace(/_/g, "-");
      const engineId = (engineRef.current?.getCurrentUserId() || "").toLowerCase().replace(/_/g, "-");
      const isTargetMe = Boolean(targetId && (targetId === currentId || targetId === engineId));

      if (ctrl.controlAction === "MIC_RESPONSE") {
        if (isTargetMe) {
          if (ctrl.approved) {
            setHasSpeakingPermission(true);
            setUnmuteRequestStatus("approved");

            // Attempt activation; gracefully catch browser gesture or hardware errors
            engine
              .enableAudio()
              .then((track) => {
                if (track) {
                  setLocalAudioTrack(track);
                  setIsMicEnabled(true);
                }
              })
              .catch((err: any) => {
                console.warn("[MeetingRoom] Async audio activation prevented by browser:", err.message);
                setIsMicEnabled(false);
                if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                  toast.error("Microphone permission blocked by browser. Allow mic access in site settings, then click Unmute.");
                } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                  toast.error("No microphone detected. Please plug in a microphone, then click Unmute.");
                }
              });
          } else {
            setHasSpeakingPermission(false);
            setUnmuteRequestStatus("none");
            engine.disableAudio();
            setLocalAudioTrack(null);
            setIsMicEnabled(false);
          }
        }
      } else if (ctrl.controlAction === "FORCE_MUTE") {
        // Enforce room isolation (normalized)
        const ctrlRoom = (ctrl.roomCode || "").toLowerCase().trim();
        const curRoom = meetingCode.toLowerCase().trim();
        if (ctrlRoom && curRoom && ctrlRoom !== curRoom) return;

        if (ctrl.all && !isHostRef.current) {
          engine.disableAudio();
          setLocalAudioTrack(null);
          setIsMicEnabled(false);
          setHasSpeakingPermission(false);
          setUnmuteRequestStatus("none");
        } else if (isTargetMe) {
          engine.disableAudio();
          setLocalAudioTrack(null);
          setIsMicEnabled(false);
          setHasSpeakingPermission(false);
          setUnmuteRequestStatus("none");
        }
      } else if (ctrl.controlAction === "CANCEL_REQUEST") {
        if (isHostRef.current) {
          console.log(`[MicFlow][${ctrl.correlationId || "cancel"}] Tutor received CANCEL_REQUEST for user:`, ctrl.userId || ctrl.senderId);
          setUnmuteRequests((prev) => prev.filter((r) => r.userId !== ctrl.userId && r.userId !== ctrl.senderId));
        }
      } else if (ctrl.controlAction === "WHITEBOARD_STATE") {
        const ctrlRoom = (ctrl.roomCode || "").toLowerCase().trim();
        const curRoom = meetingCode.toLowerCase().trim();
        if (ctrlRoom && curRoom && ctrlRoom !== curRoom) return;
        // Tutor/Host view state is authoritative for all students
        if (!isHostRef.current) {
          const shouldOpen = Boolean(ctrl.isOpen);
          setShowWhiteboard(shouldOpen);
          setLayoutMode(shouldOpen ? "whiteboard" : "grid");
        }
      }
    };

    // Record self in room attendance in PostgreSQL with server-verified role
    dbClient
      .recordParticipantJoin({
        room_code: meetingCode,
        user_id: myUserId,
        display_name: myName,
        role: isHostRef.current ? "tutor" : "student",
      })
      .then((joinRes) => {
        if (joinRes) {
          if (joinRes.tutorId) {
            engine.setAuthorizedTutorId(String(joinRes.tutorId));
          }
          if (joinRes.participant?.role === "tutor" || joinRes.isHost) {
            setIsHost(true);
            isHostRef.current = true;
            setHasSpeakingPermission(true);
            setUnmuteRequestStatus("approved");
            engine.setIsHostUser(true);
          }
        }
      });

    // Late-joining participant: query active whiteboard state
    dbClient.getWhiteboardState(meetingCode).then((wbState) => {
      if (wbState?.isOpen) {
        setShowWhiteboard(true);
        setLayoutMode("whiteboard");
      }
    });

    // Handle tab close / refresh: send beacon leave to keep attendance clean
    const handleBeforeUnload = () => {
      try {
        const payload = JSON.stringify({ user_id: myUserId, display_name: myName });
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(`/api/rooms/${encodeURIComponent(meetingCode)}/leave`, blob);
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const authToken = session?.access_token || localStorage.getItem("mathsy_meet_token") || "";

    // Connect to room session with verified server-issued session token
    engine
      .connect({
        roomId: meetingCode,
        userId: myUserId,
        userName: myName,
        role: isHost ? "host" : "student",
        token: authToken,
      })
      .then(async () => {
        if (!initialOptions.camOff) {
          const vTrack = await engine.enableVideo();
          setLocalVideoTrack(vTrack);
        }
        // Students join muted by default and cannot publish audio before tutor permission
        if (isHost && !initialOptions.micMuted) {
          try {
            const aTrack = await engine.enableAudio();
            setLocalAudioTrack(aTrack);
          } catch (err: any) {
            console.warn("[MeetingRoom] Tutor audio autostart note:", err.message);
          }
        }
        if (initialOptions.presentImmediately) {
          const sTrack = await engine.startScreenShare();
          if (sTrack) {
            setLocalScreenTrack(sTrack);
            setIsScreenSharing(true);
            setLayoutMode("screenshare");
          }
        }
      });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      dbClient.recordParticipantLeave(meetingCode, myUserId, myName);
      stopYouTubeLiveStreaming();
      engine.disconnect();
    };
  }, [meetingCode]);

  const handleMicError = (err: any) => {
    console.error("[MeetingRoom] Microphone access error:", err);
    setIsMicEnabled(false);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      toast.error("Microphone permission denied by browser. Please enable microphone permissions in your browser address bar.");
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      toast.error("No microphone device found. Please connect a microphone.");
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      toast.error("Microphone is currently in use by another application.");
    } else {
      toast.error(err.message || "Failed to access microphone.");
    }
  };

  // Audio / Mic Handler
  const handleToggleMic = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isHost) {
      if (isMicEnabled) {
        engine.disableAudio();
        setLocalAudioTrack(null);
        setIsMicEnabled(false);
      } else {
        try {
          const track = await engine.enableAudio();
          setLocalAudioTrack(track);
          setIsMicEnabled(true);
        } catch (err: any) {
          handleMicError(err);
        }
      }
    } else {
      // Student logic: speaking requires approval every time
      if (hasSpeakingPermission && isMicEnabled) {
        // Student mutes microphone -> revokes speaking permission so starting mic requires approval every time
        engine.disableAudio();
        setLocalAudioTrack(null);
        setIsMicEnabled(false);
        setHasSpeakingPermission(false);
        setUnmuteRequestStatus("none");
      } else {
        // Student is muted or does not have speaking permission
        if (unmuteRequestStatus === "requesting") {
          // Cancel pending speaking request (no popup)
          engine.cancelMicRequest(myUserIdRef.current);
          setUnmuteRequestStatus("none");
        } else {
          // Request permission from tutor every time (no popup)
          setUnmuteRequestStatus("requesting");
          engine.requestMic(myUserIdRef.current, myName);
        }
      }
    }
  };

  // Camera Handler with Policy Check
  const handleCameraToggle = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isHost) {
      if (isCamEnabled) {
        engine.disableVideo();
        setLocalVideoTrack(null);
        setIsCamEnabled(false);
      } else {
        const track = await engine.enableVideo();
        setLocalVideoTrack(track);
        setIsCamEnabled(true);
      }
    } else {
      if (!isCamEnabled) {
        const track = await engine.enableVideo();
        setLocalVideoTrack(track);
        setIsCamEnabled(true);
        setShowCameraGateModal(false);
      } else {
        // Turning camera OFF triggers policy warning
        setShowCameraOffWarningModal(true);
      }
    }
  };

  // Screen Share Handler
  const handleToggleScreenShare = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isScreenSharing) {
      engine.stopScreenShare();
      setLocalScreenTrack(null);
      setIsScreenSharing(false);
      if (layoutMode === "screenshare") setLayoutMode("grid");
    } else {
      const track = await engine.startScreenShare();
      if (track) {
        setLocalScreenTrack(track);
        setIsScreenSharing(true);
        setLayoutMode("screenshare");
      }
    }
  };

  // Whiteboard Toggle Handler
  const handleToggleWhiteboard = () => {
    const next = !showWhiteboard;
    setShowWhiteboard(next);
    if (next) {
      setLayoutMode("whiteboard");
    } else if (layoutMode === "whiteboard") {
      setLayoutMode("grid");
    }

    if (isHost) {
      engineRef.current?.broadcastWhiteboardState(meetingCode, next, true);
      dbClient.setWhiteboardState(meetingCode, next);
    }
  };

  // Student Raise Hand
  const handleToggleRaiseHand = () => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    engineRef.current?.toggleHandRaise(myName, next);
    if (next) {
      toast.info("Hand raised! Host notified.", { id: "hand-raise" });
    }
  };

  // Send Reaction
  const handleSendReaction = (emoji: string) => {
    engineRef.current?.sendReaction(myName, emoji);

    const newR: FloatingReaction = {
      id: Date.now() + Math.random().toString(),
      emoji,
      x: Math.random() * 70 + 15,
      userName: myName,
    };
    setActiveReactions((prev) => [...prev, newR]);
    setTimeout(() => {
      setActiveReactions((prev) => prev.filter((r) => r.id !== newR.id));
    }, 2500);
  };

  // Send Chat Message via single persistence authority (MongoDB backend) + real-time broadcast
  const handleSendMessage = (text: string) => {
    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const optimisticMsg: ChatMsg = {
      id: clientMessageId,
      clientMessageId,
      senderId: myUserId,
      senderName: myName,
      message: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isHost: isHost,
      status: "sending",
    };

    setChatMessages((prev) => [...prev, optimisticMsg]);

    const performSend = async (cId: string, content: string) => {
      try {
        const res = await dbClient.saveChatMessage(meetingCode, content, cId);
        if (res && (res.success || res.message)) {
          const canonical = res.message || res;
          const canonicalId = canonical._id || canonical.id || cId;
          const canonicalTimestamp = canonical.createdAt
            ? new Date(canonical.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : optimisticMsg.timestamp;

          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === cId || m.clientMessageId === cId
                ? {
                    ...m,
                    id: canonicalId,
                    clientMessageId: cId,
                    status: "sent",
                    timestamp: canonicalTimestamp,
                    isHost: Boolean(canonical.isHost ?? isHost),
                  }
                : m
            )
          );

          // Broadcast saved canonical message to peers
          engineRef.current?.broadcastChatMessage({
            id: canonicalId,
            clientMessageId: cId,
            senderId: myUserId,
            senderName: myName,
            text: content,
            timestamp: canonicalTimestamp,
            isHost: Boolean(canonical.isHost ?? isHost),
          });
        } else {
          throw new Error(res?.error || "Failed to save message");
        }
      } catch (err: any) {
        console.error("[MeetingRoom] Error saving message:", err);
        toast.error(err.message || "Failed to send message");
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === cId || m.clientMessageId === cId
              ? {
                  ...m,
                  status: "failed",
                  onRetry: () => performSend(cId, content),
                }
              : m
          )
        );
      }
    };

    performSend(clientMessageId, text);
  };

  // Launch Poll
  const handleLaunchPoll = (pollData: {
    question: string;
    options: string[];
    pollType: "mcq" | "multi_correct" | "subjective";
    correctOptionIndex?: number | null;
    timerSeconds?: number | null;
  }) => {
    const newPoll: PollItem = {
      id: "poll_" + Date.now(),
      question: pollData.question,
      options: pollData.options,
      pollType: pollData.pollType,
      correctOptionIndex: pollData.correctOptionIndex,
      timerSeconds: pollData.timerSeconds,
      isActive: true,
      votes: {},
      totalVotes: 0,
      voters: [],
    };

    setActivePoll(newPoll);
    setHasVotedPoll(false);
    setIsSideDrawerOpen(true);
    setActiveSideTab("polls");
    toast.success("Poll launched to all students!", { id: "poll-launch" });
  };

  // Vote Poll
  const handleVotePoll = (optionIndex: number) => {
    if (!activePoll || hasVotedPoll) return;

    setActivePoll((prev) => {
      if (!prev) return null;
      const currentVotes = { ...prev.votes };
      currentVotes[optionIndex] = (currentVotes[optionIndex] || 0) + 1;
      const isCorrect = prev.correctOptionIndex === optionIndex;

      return {
        ...prev,
        votes: currentVotes,
        totalVotes: prev.totalVotes + 1,
        voters: [
          ...prev.voters,
          {
            userId: myUserId,
            userName: myName,
            optionIndex,
            timestamp: Date.now(),
            isCorrect,
          },
        ],
      };
    });

    setHasVotedPoll(true);
  };

  // End Poll
  const handleEndPoll = () => {
    if (!activePoll) return;
    setActivePoll((prev) => (prev ? { ...prev, isActive: false } : null));
    toast.info("Poll ended. Leaderboard revealed!");
  };

  // Approve speaking request (Host)
  const handleApproveMic = (studentId: string, studentName: string) => {
    engineRef.current?.respondMicRequest(studentId, true, myName);
    const norm = (studentId || "").toLowerCase().replace(/_/g, "-");
    setUnmuteRequests((prev) => prev.filter((r) => {
      const rNorm = (r.userId || "").toLowerCase().replace(/_/g, "-");
      return r.userId !== studentId && rNorm !== norm;
    }));
  };

  // Deny speaking request (Host)
  const handleDenyMic = (studentId: string, studentName: string) => {
    engineRef.current?.respondMicRequest(studentId, false, myName);
    const norm = (studentId || "").toLowerCase().replace(/_/g, "-");
    setUnmuteRequests((prev) => prev.filter((r) => {
      const rNorm = (r.userId || "").toLowerCase().replace(/_/g, "-");
      return r.userId !== studentId && rNorm !== norm;
    }));
  };

  // Mute All Students (Host)
  const handleMuteAll = () => {
    engineRef.current?.forceMuteAll();
  };

  // Lower All Hands (Host)
  const handleLowerAllHands = () => {
    setIsHandRaised(false);
    toast.success("Lowered all raised hands");
  };

  // Force Mute Single Student (Host)
  const handleForceMuteStudent = (studentId: string, studentName: string) => {
    engineRef.current?.forceMuteParticipant(studentId);
  };

  // Expel Student (Host)
  const handleExpelStudent = (studentId: string, studentName: string) => {
    if (window.confirm(`Are you sure you want to remove ${studentName} from the class?`)) {
      setRemoteParticipants((prev) => prev.filter((p) => p.id !== studentId));
      toast.success(`${studentName} removed from session`);
    }
  };

  // YouTube Live Handlers
  const handleStartYouTubeLive = async (mode: "mathsy" | "personal" = "personal") => {
    try {
      const session = await startYouTubeLiveStreaming({
        meetingCode,
        title: `${initialOptions.displayName || "Tutor"}'s Live Class - ${meetingCode}`,
        description: `Live Interactive Classroom on Mathsy Meet | Room ${meetingCode}`,
        broadcastMode: mode,
        localAudioTrack,
        remoteAudioTracks: remoteParticipants
          .map((p) => p.audioTrack)
          .filter(Boolean) as MediaStreamTrack[],
        emitSignal: (event, payload) => engineRef.current?.emitSignal(event, payload),
        onSignal: (event, cb) => engineRef.current?.onSignal(event, cb),
        onStatusChange: (status) => {
          if (status === "live") {
            setIsYouTubeLive(true);
          } else if (status === "ended") {
            setIsYouTubeLive(false);
          }
        },
      });

      if (session) {
        setIsYouTubeLive(true);
        setYoutubeLiveUrl(session.youtubeUrl);
      }
    } catch (err: any) {
      console.error("[YouTubeLive] Failed to start:", err);
      toast.error("Failed to start YouTube Live Stream");
    }
  };

  const handleStopYouTubeLive = () => {
    stopYouTubeLiveStreaming();
    setIsYouTubeLive(false);
  };

  useEffect(() => {
    const handleLiveUrlUpdate = (e: any) => {
      if (e.detail) {
        setYoutubeLiveUrl(e.detail);
      }
    };
    window.addEventListener("mathsy-update-live-url", handleLiveUrlUpdate);
    return () => window.removeEventListener("mathsy-update-live-url", handleLiveUrlUpdate);
  }, []);

  // End Meeting Handler
  const handleEndClassClick = async () => {
    dbClient.recordParticipantLeave(meetingCode, myUserId, myName);
    if (isYouTubeLive) {
      stopYouTubeLiveStreaming();
      setIsYouTubeLive(false);
    }
    if (isHost) {
      try {
        await dbClient.endMeeting(meetingCode);
        engineRef.current?.broadcastClassEnded();
      } catch (err) {
        console.warn("[MeetingRoom] Error ending meeting on backend:", err);
      }
      setChatMessages([]);
      setShowPostClassModal(true);
    } else {
      onLeaveMeeting();
    }
  };

  // All participants list (Local User + Remote Mediasoup Peers)
  // 100% Dynamic: Only active live connected participants are shown in the video grid.
  const allParticipants = [
    {
      id: myUserId,
      name: myName,
      role: isHost ? "host" : "student",
      audioTrack: localAudioTrack,
      videoTrack: localVideoTrack,
      isAudioMuted: !isMicEnabled,
      isVideoMuted: !isCamEnabled,
      isHandRaised: isHandRaised,
    },
    ...remoteParticipants
      .filter((p) => p.id !== myUserId && p.name.trim().toLowerCase() !== myName.trim().toLowerCase())
      .map((p) => ({
        id: p.id,
        userId: (p as any).userId || p.id,
        name: p.name,
        role: p.role || "student",
        audioTrack: p.audioTrack || null,
        videoTrack: p.videoTrack || null,
        isAudioMuted: p.isAudioMuted ?? !p.audioTrack,
        isVideoMuted: p.isVideoMuted ?? !p.videoTrack,
        isHandRaised: p.isHandRaised ?? false,
      })),
  ];

  const totalRaisedHands = allParticipants.filter((p) => p.isHandRaised).length;

  return (
    <div
      ref={playerRef}
      className="flex flex-col h-screen w-screen bg-[#0e0d0b] text-[#f3eee6] overflow-hidden select-none font-sans relative"
    >
      {/* Persistent Audio Sink: Guarantees remote student/tutor audio is always played regardless of active view layout (Whiteboard, Screen Share, Spotlight, or Grid) */}
      <div className="hidden" aria-hidden="true">
        {remoteParticipants.map((p) => (
          <RemoteAudioElement key={p.id} participant={p} />
        ))}
      </div>

      {/* ── CLASSROOM HEADER ── */}
      <header className="h-14 shrink-0 bg-[#16130f] border-b border-[#f3eee6]/[0.08] px-4 flex items-center justify-between z-20 backdrop-blur-md">
        {/* Left: Room Badge & Duration */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              setIsInfoDrawerOpen(!isInfoDrawerOpen);
              if (!isInfoDrawerOpen) setIsSideDrawerOpen(false);
            }}
            title="Meeting details (Click to view code & link)"
            className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-3 py-1 rounded-full text-xs transition cursor-pointer group"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse shrink-0" />
            <span className="text-xs font-mono font-bold text-[#f3eee6] tracking-wide truncate group-hover:text-[#f59e0b] transition">
              {meetingCode}
            </span>
            <Info className="w-3.5 h-3.5 text-[#a39e94] group-hover:text-[#f59e0b] transition ml-0.5" />
          </button>

          <div className="hidden sm:flex items-center gap-1.5 bg-[#1a1814] border border-[#f3eee6]/10 px-2.5 py-1 rounded-full text-xs font-mono text-[#a39e94]">
            <Clock className="w-3.5 h-3.5 text-[#a39e94]" />
            <span>{formatDuration(elapsedSeconds)}</span>
          </div>

          {/* Role Badge */}
          {isHost ? (
            <span className="hidden sm:inline-flex items-center gap-1 bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold">
              <GraduationCap className="w-3.5 h-3.5" />
              Tutor (Host)
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold">
              <BookOpen className="w-3.5 h-3.5" />
              Student
            </span>
          )}

          {/* Connection status indicator */}
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: connectionState === "connected" ? "#10b981" : "#f59e0b",
            }}
            title={`Status: ${connectionState}`}
          />
        </div>

        {/* Center: Layout Selector */}
        <div className="hidden md:flex items-center gap-1 bg-[#1a1814] border border-[#f3eee6]/10 p-1 rounded-xl">
          <button
            onClick={() => {
              const wasWhiteboard = showWhiteboard || layoutMode === "whiteboard";
              setShowWhiteboard(false);
              setLayoutMode("grid");
              if (isHost && wasWhiteboard) {
                engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
                dbClient.setWhiteboardState(meetingCode, false);
              }
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              layoutMode === "grid" && !showWhiteboard
                ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                : "text-[#a39e94] hover:text-[#f3eee6]"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Grid
          </button>

          <button
            onClick={() => {
              const wasWhiteboard = showWhiteboard || layoutMode === "whiteboard";
              setShowWhiteboard(false);
              setLayoutMode("spotlight");
              if (isHost && wasWhiteboard) {
                engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
                dbClient.setWhiteboardState(meetingCode, false);
              }
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              layoutMode === "spotlight" && !showWhiteboard
                ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                : "text-[#a39e94] hover:text-[#f3eee6]"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Spotlight
          </button>

          {isHost && (
            <button
              onClick={() => {
                setShowWhiteboard(true);
                setLayoutMode("whiteboard");
                engineRef.current?.broadcastWhiteboardState(meetingCode, true, true);
                dbClient.setWhiteboardState(meetingCode, true);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                showWhiteboard || layoutMode === "whiteboard"
                  ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                  : "text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Whiteboard
            </button>
          )}

          {isScreenSharing && (
            <button
              onClick={() => setLayoutMode("screenshare")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                layoutMode === "screenshare"
                  ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                  : "text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Screen
            </button>
          )}
        </div>

        {/* Right: Companion Tablet, YouTube Connect, Recording & Fullscreen */}
        <div className="flex items-center gap-2">
          {/* Pair Tablet Companion button */}
          {isHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTabletModal(true)}
              className="h-8 px-2.5 rounded-xl border-[#f3eee6]/10 bg-[#1a1814] hover:bg-[#221f1a] text-[#f3eee6] text-xs font-semibold gap-1.5"
              title="Pair iPad or Android tablet to draw on live whiteboard"
            >
              <Tablet className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span className="hidden sm:inline">Pair Tablet</span>
            </Button>
          )}

          {/* YouTube Channel Settings (Host) */}
          {isHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowYouTubeConnectModal(true)}
              className="h-8 px-2.5 rounded-xl border-[#f3eee6]/10 bg-[#1a1814] hover:bg-[#221f1a] text-[#f3eee6] text-xs font-semibold gap-1.5"
              title="Connect YouTube Channel & Stream Key"
            >
              <Youtube className="w-3.5 h-3.5 text-red-500" />
              <span className="hidden sm:inline">YouTube</span>
            </Button>
          )}

          {/* Recording & Live Stream trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsRecordingModalOpen(true)}
            className={`h-8 px-2.5 rounded-xl text-xs font-bold gap-1.5 border transition ${
              isYouTubeLive
                ? "bg-red-600 text-white border-red-500 animate-pulse shadow-md shadow-red-500/25"
                : isRecordingActive
                ? "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"
                : "bg-zinc-900 border-white/10 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {isYouTubeLive ? (
              <>
                <Radio className="w-3.5 h-3.5 text-white animate-spin" />
                <span className="hidden sm:inline">LIVE {formatDuration(youtubeLiveSeconds)}</span>
              </>
            ) : (
              <>
                <Disc className={`w-3.5 h-3.5 ${isRecordingActive ? "text-red-400" : "text-zinc-400"}`} />
                <span className="hidden sm:inline">
                  {isRecordingActive ? `REC ${formatDuration(recordingSeconds)}` : "Record / Live"}
                </span>
              </>
            )}
          </Button>

          {/* Active Live Watch Link */}
          {isYouTubeLive && youtubeLiveUrl && (
            <a
              href={youtubeLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-2.5 rounded-xl bg-red-600/20 border border-red-500/40 text-red-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition"
              title="Open YouTube Live Stream in new tab"
            >
              <span className="hidden sm:inline">Watch</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE & STAGE ── */}
      <main className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Floating Tutor Speaking Request Banner */}
        {isHost && unmuteRequests.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-[#181612]/95 border border-amber-500/50 backdrop-blur-md rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Mic className="w-5 h-5 animate-pulse" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs sm:text-sm font-semibold text-white truncate">
                <span className="text-amber-400 font-bold">{unmuteRequests[0].name}</span> requested to speak
              </span>
              <span className="text-[11px] text-[#a39e94]">
                {unmuteRequests.length > 1
                  ? `+${unmuteRequests.length - 1} more student(s) waiting`
                  : "Click Allow to unmute student microphone"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-1">
              <button
                onClick={() => handleApproveMic(unmuteRequests[0].userId, unmuteRequests[0].name)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Check className="w-3.5 h-3.5" />
                Allow Mic
              </button>
              <button
                onClick={() => handleDenyMic(unmuteRequests[0].userId, unmuteRequests[0].name)}
                className="bg-zinc-800 hover:bg-zinc-700 text-[#d4cfc5] text-xs font-medium px-2.5 py-1.5 rounded-lg border border-white/10 transition cursor-pointer active:scale-95"
              >
                <X className="w-3.5 h-3.5" />
                Decline
              </button>
            </div>
          </div>
        )}

        <section className="flex-1 min-w-0 h-full relative p-3 flex flex-col justify-center items-center overflow-hidden">
          {/* SCREEN SHARE PRESENTATION MODE */}
          {layoutMode === "screenshare" && localScreenTrack ? (
            <div className="w-full h-full relative bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/10">
              <VideoTrackPlayer
                track={localScreenTrack}
                className="w-full h-full object-contain"
              />
              {/* Floating PIP Host Camera */}
              {isCamEnabled && localVideoTrack && (
                <div className="absolute bottom-4 right-4 w-48 aspect-video rounded-xl overflow-hidden border border-white/20 bg-zinc-900 shadow-2xl z-20">
                  <VideoTrackPlayer
                    track={localVideoTrack}
                    mirror={true}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1.5 left-1.5 bg-black/80 px-2 py-0.5 rounded text-[9px] font-bold text-white flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Host
                  </div>
                </div>
              )}
            </div>
          ) : showWhiteboard || layoutMode === "whiteboard" ? (
            /* COLLABORATIVE WHITEBOARD MODE WITH TLDraw & GEOMETRY TOOLS */
            <div className="w-full h-full relative rounded-2xl overflow-hidden border border-white/10">
              <Whiteboard
                onClose={() => {
                  setShowWhiteboard(false);
                  setLayoutMode("grid");
                  if (isHost) {
                    engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
                    dbClient.setWhiteboardState(meetingCode, false);
                  }
                }}
                isHost={isHost}
                roomCode={meetingCode}
                engine={engineRef.current}
                myUserId={myUserId}
              />
              {/* Floating PIP Host Camera */}
              {isCamEnabled && localVideoTrack && (
                <div className="absolute bottom-4 right-4 w-44 aspect-video rounded-xl overflow-hidden border border-white/20 bg-zinc-900 shadow-2xl z-30 pointer-events-auto">
                  <VideoTrackPlayer
                    track={localVideoTrack}
                    mirror={true}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1.5 left-1.5 bg-black/80 px-2 py-0.5 rounded text-[9px] font-bold text-white flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Host
                  </div>
                </div>
              )}
            </div>
          ) : layoutMode === "spotlight" && allParticipants.length > 0 ? (
            /* SPOTLIGHT VIEW */
            <div className="w-full h-full flex flex-col md:flex-row gap-3">
              <div className="flex-1 h-full min-h-0">
                {(() => {
                  const featured = allParticipants.find((p) => p.id === pinnedId) || allParticipants[0];
                  return (
                    <VideoTile
                      key={featured.id}
                      id={featured.id}
                      name={featured.name}
                      videoTrack={featured.videoTrack}
                      audioTrack={featured.audioTrack}
                      isAudioMuted={featured.isAudioMuted}
                      isVideoMuted={featured.isVideoMuted}
                      isLocal={featured.id === myUserId}
                      isHost={featured.role === "host"}
                      isViewerHost={isHost}
                      isSpeaking={!featured.isAudioMuted && Boolean(featured.audioTrack)}
                      isHandRaised={featured.isHandRaised}
                      isMicRequested={unmuteRequests.some((r) => r.userId === featured.id || (featured as any).userId === r.userId)}
                      onApproveMic={() => {
                        const m = unmuteRequests.find((r) => r.userId === featured.id || (featured as any).userId === r.userId);
                        handleApproveMic(m?.userId || featured.id, featured.name);
                      }}
                      onDenyMic={() => {
                        const m = unmuteRequests.find((r) => r.userId === featured.id || (featured as any).userId === r.userId);
                        handleDenyMic(m?.userId || featured.id, featured.name);
                      }}
                      isPinned={true}
                      onTogglePin={() => setPinnedId(null)}
                      onLowerHand={() => isHost && handleLowerAllHands()}
                      onForceMute={() => handleForceMuteStudent(featured.id, featured.name)}
                      onExpel={() => handleExpelStudent(featured.id, featured.name)}
                      className="w-full h-full"
                    />
                  );
                })()}
              </div>

              {/* Sidebar Carousel of Other Participants */}
              {allParticipants.length > 1 && (
                <div className="w-full md:w-60 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto">
                  {allParticipants
                    .filter((p) => p.id !== (pinnedId || allParticipants[0].id))
                    .map((p) => (
                      <VideoTile
                        key={p.id}
                        id={p.id}
                        name={p.name}
                        videoTrack={p.videoTrack}
                        audioTrack={p.audioTrack}
                        isAudioMuted={p.isAudioMuted}
                        isVideoMuted={p.isVideoMuted}
                        isLocal={p.id === myUserId}
                        isHost={p.role === "host"}
                        isViewerHost={isHost}
                        isSpeaking={!p.isAudioMuted && Boolean(p.audioTrack)}
                        isHandRaised={p.isHandRaised}
                        isMicRequested={unmuteRequests.some((r) => r.userId === p.id || (p as any).userId === r.userId)}
                        onApproveMic={() => {
                          const m = unmuteRequests.find((r) => r.userId === p.id || (p as any).userId === r.userId);
                          handleApproveMic(m?.userId || p.id, p.name);
                        }}
                        onDenyMic={() => {
                          const m = unmuteRequests.find((r) => r.userId === p.id || (p as any).userId === r.userId);
                          handleDenyMic(m?.userId || p.id, p.name);
                        }}
                        isPinned={false}
                        onTogglePin={() => setPinnedId(p.id)}
                        onLowerHand={() => isHost && handleLowerAllHands()}
                        onForceMute={() => handleForceMuteStudent(p.id, p.name)}
                        onExpel={() => handleExpelStudent(p.id, p.name)}
                        className="w-48 md:w-full aspect-video shrink-0"
                      />
                    ))}
                </div>
              )}
            </div>
          ) : (
            /* DYNAMIC RESPONSIVE GRID (GOOGLE MEET STYLE) */
            <div
              className={`w-full h-full grid gap-3 ${
                allParticipants.length === 1
                  ? "grid-cols-1"
                  : allParticipants.length === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : allParticipants.length <= 4
                  ? "grid-cols-2 grid-rows-2"
                  : allParticipants.length <= 6
                  ? "grid-cols-2 md:grid-cols-3 grid-rows-2"
                  : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
              }`}
            >
              {allParticipants.map((p) => (
                <VideoTile
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  videoTrack={p.videoTrack}
                  audioTrack={p.audioTrack}
                  isAudioMuted={p.isAudioMuted}
                  isVideoMuted={p.isVideoMuted}
                  isLocal={p.id === myUserId}
                  isHost={p.role === "host"}
                  isViewerHost={isHost}
                  isSpeaking={!p.isAudioMuted && Boolean(p.audioTrack)}
                  isHandRaised={p.isHandRaised}
                  isMicRequested={unmuteRequests.some((r) => r.userId === p.id || (p as any).userId === r.userId)}
                  onApproveMic={() => {
                    const m = unmuteRequests.find((r) => r.userId === p.id || (p as any).userId === r.userId);
                    handleApproveMic(m?.userId || p.id, p.name);
                  }}
                  onDenyMic={() => {
                    const m = unmuteRequests.find((r) => r.userId === p.id || (p as any).userId === r.userId);
                    handleDenyMic(m?.userId || p.id, p.name);
                  }}
                  isPinned={p.id === pinnedId}
                  onTogglePin={() => setPinnedId(pinnedId === p.id ? null : p.id)}
                  onLowerHand={() => isHost && handleLowerAllHands()}
                  onForceMute={() => handleForceMuteStudent(p.id, p.name)}
                  onExpel={() => handleExpelStudent(p.id, p.name)}
                  className="w-full h-full"
                />
              ))}
            </div>
          )}

          {/* Floating Physics Reactions Overlay */}
          <FloatingReactionsOverlay reactions={activeReactions} />
        </section>

        {/* ── MEETING DETAILS INFO DRAWER (Google Meet Style) ── */}
        <InfoDrawer
          isOpen={isInfoDrawerOpen}
          meetingCode={meetingCode}
          onClose={() => setIsInfoDrawerOpen(false)}
          hostName={isHost ? myName : (allParticipants.find((p) => p.role === "host")?.name || "Tutor")}
          isHost={isHost}
        />

        {/* ── UNIFIED 3-TAB CLASS FEED SIDE DRAWER ── */}
        <ClassFeedSidepanel
          isOpen={isSideDrawerOpen}
          activeTab={activeSideTab}
          onTabChange={(tab) => {
            setActiveSideTab(tab);
            if (tab === "chat") setUnreadChatCount(0);
          }}
          onClose={() => setIsSideDrawerOpen(false)}
          isHost={isHost}
          currentUserId={myUserId}
          currentUserName={myName}
          meetingCode={meetingCode}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
          isChatLocked={isChatLocked}
          onToggleChatLock={async () => {
            const nextLock = !isChatLocked;
            setIsChatLocked(nextLock);
            try {
              await dbClient.setChatLock(meetingCode, nextLock);
              engineRef.current?.emitChatLock(nextLock);
              toast.info(nextLock ? "Chat locked for students" : "Chat unlocked");
            } catch (err: any) {
              setIsChatLocked(!nextLock);
              toast.error(err.message || "Failed to toggle chat lock");
            }
          }}
          pinnedMessage={pinnedMessage}
          onPinMessage={async (text) => {
            const pinData = { text, senderName: myName };
            setPinnedMessage(pinData);
            try {
              await dbClient.setPinnedMessage(meetingCode, text);
              engineRef.current?.emitChatPin(pinData);
              toast.success("Message pinned at the top");
            } catch (err: any) {
              toast.error(err.message || "Failed to pin message");
            }
          }}
          onUnpinMessage={async () => {
            setPinnedMessage(null);
            try {
              await dbClient.setPinnedMessage(meetingCode, null);
              engineRef.current?.emitChatPin(null);
            } catch (err: any) {
              toast.error(err.message || "Failed to unpin message");
            }
          }}
          activePoll={activePoll}
          onLaunchPoll={handleLaunchPoll}
          onVotePoll={handleVotePoll}
          onEndPoll={handleEndPoll}
          onDismissLeaderboard={() => setActivePoll(null)}
          hasVoted={hasVotedPoll}
          participants={allParticipants}
          onLowerHand={(uid) => {
            if (uid === myUserId) setIsHandRaised(false);
          }}
          onLowerAllHands={handleLowerAllHands}
          onForceMuteStudent={handleForceMuteStudent}
          onMuteAllStudents={handleMuteAll}
          onExpelStudent={handleExpelStudent}
          unmuteRequests={unmuteRequests}
          onApproveMic={handleApproveMic}
          onDenyMic={handleDenyMic}
        />
      </main>

      {/* ── BOTTOM GOOGLE MEET CONTROLS BAR ── */}
      <footer className="h-20 shrink-0 bg-[#18191c] border-t border-white/10 flex items-center justify-between px-4 md:px-8 z-30 select-none">
        {/* Left Side: Mic, Camera, Raise Hand, Screen Share */}
        <div className="flex items-center gap-2.5">
          {/* Mic Button with speaking request support */}
          <button
            onClick={handleToggleMic}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md ${
              isMicEnabled
                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                : unmuteRequestStatus === "requesting"
                ? "bg-amber-500 text-white animate-pulse"
                : hasSpeakingPermission
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
            title={
              isMicEnabled
                ? "Mute Microphone"
                : unmuteRequestStatus === "requesting"
                ? "Speaking request pending tutor approval (Click to cancel)"
                : hasSpeakingPermission
                ? "Unmute Microphone (Speaking Approved)"
                : isHost
                ? "Unmute Microphone"
                : "Request Tutor to Speak"
            }
          >
            {isMicEnabled ? (
              <Mic className="w-5 h-5" />
            ) : unmuteRequestStatus === "requesting" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </button>

          {/* Camera Button with Policy Check */}
          <button
            onClick={handleCameraToggle}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md ${
              isCamEnabled
                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
            title={isCamEnabled ? "Turn off camera" : "Turn on camera"}
          >
            {isCamEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Student Raise Hand Button */}
          {!isHost && (
            <button
              onClick={handleToggleRaiseHand}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md ${
                isHandRaised
                  ? "bg-amber-500 text-zinc-950 font-bold shadow-lg shadow-amber-500/30 animate-pulse border border-amber-300"
                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
              }`}
              title={isHandRaised ? "Lower Hand" : "Raise Hand"}
            >
              <Hand className={`w-5 h-5 ${isHandRaised ? "text-zinc-950" : "text-amber-400"}`} />
            </button>
          )}

          {/* Screen Share Button */}
          {isHost && (
            <button
              onClick={handleToggleScreenShare}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md ${
                isScreenSharing
                  ? "bg-[#1a73e8] text-white border border-[#1a73e8]/30 shadow-lg shadow-[#1a73e8]/25"
                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
              }`}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
            >
              {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Center: Reactions */}
        <div className="flex items-center gap-2 relative">

          {/* Floating Reaction Picker Popover */}
          <div className="relative">
            <button
              onClick={() => setShowReactionPicker(!showReactionPicker)}
              className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center border border-white/10 transition shadow-md"
              title="Send emoji reaction"
            >
              <Smile className="w-5 h-5 text-amber-400" />
            </button>

            {showReactionPicker && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50">
                <ReactionPickerBar
                  onSelectReaction={handleSendReaction}
                  onClose={() => setShowReactionPicker(false)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Raised Hand notification, Class Feed, Leave/End Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Host Raised Hands Alert Pill */}
          {isHost && totalRaisedHands > 0 && (!isSideDrawerOpen || activeSideTab !== "participants") && (
            <Button
              onClick={() => {
                setIsSideDrawerOpen(true);
                setActiveSideTab("participants");
              }}
              className="h-10 px-3.5 rounded-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs gap-1.5 shadow-lg shadow-amber-500/25 border border-amber-400/50 animate-pulse"
            >
              <Hand className="w-4 h-4 text-zinc-950" />
              <span>{totalRaisedHands} Hand Raised</span>
            </Button>
          )}

          {/* Meeting Details / Info Trigger (Google Meet style) */}
          <Button
            onClick={() => {
              setIsInfoDrawerOpen(!isInfoDrawerOpen);
              if (!isInfoDrawerOpen) setIsSideDrawerOpen(false);
            }}
            className={`h-11 px-3.5 rounded-full font-bold text-xs border transition relative gap-1.5 cursor-pointer ${
              isInfoDrawerOpen
                ? "bg-[#f59e0b] text-[#0e0d0b] border-[#f59e0b] shadow-md shadow-[#f59e0b]/20"
                : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
            }`}
            title="Meeting details (Meeting link & code)"
          >
            <Info className="w-4 h-4" />
            <span className="hidden md:inline">Info</span>
          </Button>

          {/* Class Feed Sidepanel Trigger */}
          <Button
            onClick={() => {
              setIsSideDrawerOpen(!isSideDrawerOpen);
              if (!isSideDrawerOpen) setIsInfoDrawerOpen(false);
              setUnreadChatCount(0);
            }}
            className={`h-11 px-4 rounded-full font-bold text-xs border transition relative gap-2 ${
              isSideDrawerOpen
                ? "bg-[#1a73e8] text-white border-[#1a73e8]/30"
                : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Class Feed</span>
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-md animate-pulse">
                {unreadChatCount}
              </span>
            )}
          </Button>

          {/* Leave / End Class Button */}
          {isHost ? (
            <Button
              variant="destructive"
              onClick={handleEndClassClick}
              className="h-11 px-5 rounded-full font-bold text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25"
            >
              <PhoneOff className="w-4 h-4" />
              <span>End Class</span>
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={onLeaveMeeting}
              className="h-11 px-5 rounded-full font-bold text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave Room</span>
            </Button>
          )}
        </div>
      </footer>

      {/* ── MODALS & DIALOGS ── */}

      {/* Tablet Companion Pairing Modal */}
      <TabletPairingModal
        open={showTabletModal}
        onOpenChange={setShowTabletModal}
        tabletCode={tabletCode}
      />

      {/* Pre-Join Mandatory Camera Gate Modal */}
      <PreJoinCameraGateModal
        open={showCameraGateModal}
        localVideoTrack={localVideoTrack}
        joinPendingApproval={joinPendingApproval}
        onTurnOnCamera={() => {
          handleCameraToggle();
          setShowCameraGateModal(false);
        }}
        onRequestCameraOff={() => {
          setJoinPendingApproval(true);
          setTimeout(() => {
            setJoinPendingApproval(false);
            setCameraOffAllowed(true);
            setShowCameraGateModal(false);
            toast.success("Host approved camera-off exemption!", { id: "cam-exemption" });
          }, 3000);
        }}
        onCancel={onLeaveMeeting}
      />

      {/* In-Class Camera Off Warning Modal */}
      <InClassCameraOffWarningModal
        open={showCameraOffWarningModal}
        onOpenChange={setShowCameraOffWarningModal}
        onKeepCameraOn={() => setShowCameraOffWarningModal(false)}
        onRequestExemption={() => {
          setShowCameraOffWarningModal(false);
          toast.info("Exemption request sent to host.", { id: "cam-exemption-req" });
        }}
        onTurnOffAndLeave={() => {
          setShowCameraOffWarningModal(false);
          engineRef.current?.disableVideo();
          setLocalVideoTrack(null);
          setIsCamEnabled(false);
          onLeaveMeeting();
        }}
      />

      {/* Post-Class Workflow Modal (Host) */}
      <PostClassModal
        open={showPostClassModal}
        onOpenChange={setShowPostClassModal}
        meetingCode={meetingCode}
        durationFormatted={formatDuration(elapsedSeconds)}
        onComplete={async () => {
          try {
            await dbClient.endMeeting(meetingCode);
            engineRef.current?.broadcastClassEnded();
          } catch (err) {
            console.warn("[MeetingRoom] Error ending meeting:", err);
          }
          setChatMessages([]);
          setShowPostClassModal(false);
          onLeaveMeeting();
        }}
      />

      {/* Recording & YouTube Live Modal */}
      <RecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        meetingCode={meetingCode}
        isRecording={isRecordingActive}
        recordingSeconds={recordingSeconds}
        onStartLocalRecording={() => {
          setIsRecordingActive(true);
          setIsRecordingModalOpen(false);
          toast.success("HD local recording started");
        }}
        onStopLocalRecording={() => {
          setIsRecordingActive(false);
          setIsRecordingModalOpen(false);
          toast.info("Recording saved");
        }}
        isLiveStreaming={isYouTubeLive}
        liveStreamSeconds={youtubeLiveSeconds}
        liveStreamUrl={youtubeLiveUrl}
        onStartYouTubeLive={handleStartYouTubeLive}
        onStopYouTubeLive={handleStopYouTubeLive}
      />

      {/* YouTube Channel Settings Modal */}
      <YouTubeConnectModal
        open={showYouTubeConnectModal}
        onOpenChange={setShowYouTubeConnectModal}
      />
    </div>
  );
};
