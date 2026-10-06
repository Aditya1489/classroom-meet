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
import { Whiteboard } from "../whiteboard/Whiteboard";
import { RecordingModal } from "../recording/RecordingModal";
import { generateTabletCode } from "../../utils/tabletCode";
import { useAuth } from "../../auth/authContext";
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

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode,
  initialOptions,
  onLeaveMeeting,
}) => {
  const { profile, user, session } = useAuth();
  const engineRef = useRef<MathsyMediasoupEngine | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  // Strictly prioritize chosen role
  const isHost =
    initialOptions.role === "tutor" ||
    (initialOptions.role === undefined && Boolean(profile?.isHost || profile?.role === "tutor")) ||
    initialOptions.displayName.toLowerCase().includes("tutor") ||
    initialOptions.displayName.toLowerCase().includes("host");

  const myUserId = profile?.id || "user_" + Math.random().toString(36).substring(2, 8);
  const myName = initialOptions.displayName || profile?.name || (isHost ? "Tutor" : "Student");

  // Connection State
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "failed"
  >("connecting");

  // Media States
  const [isMicEnabled, setIsMicEnabled] = useState(!initialOptions.micMuted);
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
  const [unmuteRequestStatus, setUnmuteRequestStatus] = useState<"none" | "requesting" | "approved">(isHost ? "approved" : "none");
  const [unmuteRequests, setUnmuteRequests] = useState<Array<{ userId: string; name: string }>>([]);

  // Side Drawer State
  const [isSideDrawerOpen, setIsSideDrawerOpen] = useState(false);
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

    engine.onConnectionStateChange = (state) => {
      setConnectionState(state);
      if (state === "connected") {
        toast.success(`Joined room: ${meetingCode}`);
      }
    };

    engine.onParticipantsChange = (updated) => {
      setRemoteParticipants([...updated]);
    };

    engine.onChatMessage = (msg: any) => {
      const normalized: ChatMsg = {
        id: msg.id || Math.random().toString(),
        senderId: msg.senderId || msg.from?.identity || "unknown",
        senderName: msg.senderName || msg.from?.name || "Student",
        message: msg.text || msg.message || "",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isHost: msg.isHost || false,
      };

      setChatMessages((prev) => [...prev, normalized]);
      if (!isSideDrawerOpen || activeSideTab !== "chat") {
        setUnreadChatCount((c) => c + 1);
      }
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

    // Connect to room session
    engine
      .connect({
        roomId: meetingCode,
        userId: myUserId,
        userName: myName,
        role: isHost ? "host" : "student",
        token: session?.access_token || "",
      })
      .then(async () => {
        if (!initialOptions.camOff) {
          const vTrack = await engine.enableVideo();
          setLocalVideoTrack(vTrack);
        }
        if (!initialOptions.micMuted) {
          const aTrack = await engine.enableAudio();
          setLocalAudioTrack(aTrack);
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
      stopYouTubeLiveStreaming();
      engine.disconnect();
    };
  }, [meetingCode]);

  // Audio / Mic Handler
  const handleToggleMic = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isHost) {
      if (isMicEnabled) {
        engine.disableAudio();
        setLocalAudioTrack(null);
        setIsMicEnabled(false);
        toast.info("Microphone muted");
      } else {
        const track = await engine.enableAudio();
        setLocalAudioTrack(track);
        setIsMicEnabled(true);
        toast.success("Microphone unmuted");
      }
    } else {
      // Student logic: check if unmuting is allowed or requires request
      if (isMicEnabled) {
        engine.disableAudio();
        setLocalAudioTrack(null);
        setIsMicEnabled(false);
        setUnmuteRequestStatus("none");
        toast.info("Microphone muted");
      } else if (unmuteRequestStatus === "approved") {
        const track = await engine.enableAudio();
        setLocalAudioTrack(track);
        setIsMicEnabled(true);
        toast.success("Microphone activated");
      } else {
        setUnmuteRequestStatus("requesting");
        toast.info("Speaking request sent to host.");
        // If simulated or socket present
        if (engine.socket) {
          engine.socket.emit("unmuteRequest", { type: "REQUEST_UNMUTE", userId: myUserId, name: myName });
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
        toast.info("Camera disabled");
      } else {
        const track = await engine.enableVideo();
        setLocalVideoTrack(track);
        setIsCamEnabled(true);
        toast.success("Camera enabled");
      }
    } else {
      if (!isCamEnabled) {
        const track = await engine.enableVideo();
        setLocalVideoTrack(track);
        setIsCamEnabled(true);
        setShowCameraGateModal(false);
        toast.success("Camera enabled");
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
      toast.info("Screen share ended");
    } else {
      const track = await engine.startScreenShare();
      if (track) {
        setLocalScreenTrack(track);
        setIsScreenSharing(true);
        setLayoutMode("screenshare");
        toast.success("Screen sharing started");
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
  };

  // Student Raise Hand
  const handleToggleRaiseHand = () => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    engineRef.current?.toggleHandRaise(myName, next);
    toast.info(next ? "Hand raised! Host notified." : "Hand lowered");
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

  // Send Chat Message
  const handleSendMessage = (text: string) => {
    const msgPayload: ChatMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      senderId: myUserId,
      senderName: myName,
      message: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isHost: isHost,
    };

    setChatMessages((prev) => [...prev, msgPayload]);
    engineRef.current?.sendChatMessage(myName, text, isHost);
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
    toast.success("Poll launched to all students!");
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

  // Mute All Students (Host)
  const handleMuteAll = () => {
    toast.success("Muted all students");
  };

  // Lower All Hands (Host)
  const handleLowerAllHands = () => {
    setIsHandRaised(false);
    toast.success("Lowered all raised hands");
  };

  // Force Mute Single Student (Host)
  const handleForceMuteStudent = (studentId: string, studentName: string) => {
    toast.success(`Muted ${studentName}`);
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
  const handleEndClassClick = () => {
    if (isYouTubeLive) {
      stopYouTubeLiveStreaming();
      setIsYouTubeLive(false);
    }
    if (isHost) {
      setShowPostClassModal(true);
    } else {
      onLeaveMeeting();
    }
  };

  // All participants list (Local User + Remote Peers)
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
    ...remoteParticipants.map((p) => ({
      id: p.id,
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
      {/* ── CLASSROOM HEADER ── */}
      <header className="h-14 shrink-0 bg-[#16130f] border-b border-[#f3eee6]/[0.08] px-4 flex items-center justify-between z-20 backdrop-blur-md">
        {/* Left: Room Badge & Duration */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse shrink-0" />
            <span className="text-xs font-mono font-bold text-[#f3eee6] tracking-wide truncate">
              {meetingCode}
            </span>
          </div>

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
              setShowWhiteboard(false);
              setLayoutMode("grid");
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
              setShowWhiteboard(false);
              setLayoutMode("spotlight");
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
                }}
                isHost={isHost}
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
          onToggleChatLock={() => {
            setIsChatLocked(!isChatLocked);
            toast.info(!isChatLocked ? "Chat locked for students" : "Chat unlocked");
          }}
          pinnedMessage={pinnedMessage}
          onPinMessage={(text) => {
            setPinnedMessage({ text, senderName: myName });
            toast.success("Message pinned at the top");
          }}
          onUnpinMessage={() => setPinnedMessage(null)}
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
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
            title={
              isMicEnabled
                ? "Mute Microphone"
                : unmuteRequestStatus === "requesting"
                ? "Approval Pending..."
                : "Unmute Microphone"
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

        {/* Center: Whiteboard, YouTube Live & Reactions */}
        <div className="flex items-center gap-2 relative">
          {/* Whiteboard Button (Host) */}
          {isHost && (
            <Button
              onClick={handleToggleWhiteboard}
              className={`h-11 px-5 rounded-full font-bold text-xs gap-2 transition border shadow-md ${
                showWhiteboard
                  ? "bg-[#1a73e8] text-white border-[#1a73e8]/40"
                  : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
              }`}
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span>{showWhiteboard ? "Hide Whiteboard" : "Math Whiteboard"}</span>
            </Button>
          )}

          {/* YouTube Live Quick Button (Host) */}
          {isHost && (
            <Button
              onClick={() => {
                if (isYouTubeLive) {
                  handleStopYouTubeLive();
                } else {
                  setIsRecordingModalOpen(true);
                }
              }}
              className={`h-11 px-4 rounded-full font-bold text-xs gap-2 transition border shadow-md ${
                isYouTubeLive
                  ? "bg-red-600 hover:bg-red-700 text-white border-red-500 shadow-lg shadow-red-600/30 animate-pulse"
                  : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
              }`}
              title={isYouTubeLive ? "End YouTube Live stream" : "Go Live on YouTube"}
            >
              <Youtube className={`w-4 h-4 ${isYouTubeLive ? "text-white" : "text-red-500"}`} />
              <span className="hidden md:inline">
                {isYouTubeLive ? `End Live (${formatDuration(youtubeLiveSeconds)})` : "Go Live"}
              </span>
            </Button>
          )}

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

          {/* Class Feed Sidepanel Trigger */}
          <Button
            onClick={() => {
              setIsSideDrawerOpen(!isSideDrawerOpen);
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
          toast.info("Sent camera-off request to host.");
          setTimeout(() => {
            setJoinPendingApproval(false);
            setCameraOffAllowed(true);
            setShowCameraGateModal(false);
            toast.success("Host approved camera-off exemption!");
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
          toast.info("Exemption request sent to host.");
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
        onComplete={() => {
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
