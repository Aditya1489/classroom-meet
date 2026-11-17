import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { useDocumentPiP } from "../../hooks/useDocumentPiP";
import { FloatingMeetOverlay } from "./FloatingMeetOverlay";
import { generateTabletCode } from "../../utils/tabletCode";
import { useAuth } from "../../auth/authContext";
import { dbClient, DbRoomKnock } from "../../lib/dbClient";
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
  AlertTriangle,
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
  Volume2,
  ExternalLink,
  Info,
  Check,
  X,
  MoreHorizontal,
  ChevronDown,
  ChevronLeft,
  Send,
  SlidersHorizontal,
  RotateCcw,
  Minus,
  RotateCw,
  Download,
  ZoomIn,
  Search,
  FileUp,
  Zap,
  ChevronRight,
} from "lucide-react";
import {
  isMobileDevice,
  isLandscapeOrientation,
  enterMobileFullscreenAndLandscape,
  exitMobileFullscreenAndUnlock,
} from "../../lib/mobileFullscreen";
import { YouTubeConnectModal } from "../youtube/YouTubeConnectModal";
import {
  startYouTubeLiveStreaming,
  stopYouTubeLiveStreaming,
  updateYouTubeLiveAudioSources,
  StreamStats,
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
    userId?: string;
    token?: string;
    isHost?: boolean;
  };
  onLeaveMeeting: () => void;
}

const RemoteAudioElement: React.FC<{
  participant: RemoteParticipant;
  playScreenAudio?: boolean;
}> = ({ participant, playScreenAudio = true }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const screenAudioRef = useRef<HTMLAudioElement>(null);

  // Play participant microphone audio (Always active so tutor voice is never missed)
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

  // Play participant shared screen / tab audio as a fallback when screen share stage is not actively mounted
  useEffect(() => {
    const el = screenAudioRef.current;
    if (!el) return;
    if (participant.screenAudioTrack && playScreenAudio) {
      const stream = new MediaStream([participant.screenAudioTrack]);
      el.srcObject = stream;
      el.play().catch((e) => console.warn(`[MathsyMeet ScreenAudioSink] play() error for ${participant.id}:`, e));
    } else {
      el.srcObject = null;
    }
  }, [participant.screenAudioTrack, playScreenAudio]);

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <audio ref={screenAudioRef} autoPlay playsInline />
    </>
  );
};

function playKnockChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Tone 1: 520Hz (Ding)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(520, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: 440Hz (Dong)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(440, now + 0.18);
    gain2.gain.setValueAtTime(0.18, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.6);
  } catch (err) {
    console.warn("[Knock Chime] Audio synthesis error:", err);
  }
}

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
    return Boolean(initialOptions.isHost || fromSession);
  });
  const [grantedRole, setGrantedRole] = useState<"tutor" | "student">(
    isHost ? "tutor" : (initialOptions.isHost ? "tutor" : "student")
  );

  const isHostRef = useRef<boolean>(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  // Persistent user identity: strictly maintained across renders to prevent ID desync with Mediasoup SFU & Tutor approvals
  const [myUserId] = useState<string>(() => {
    const sessionKey = `mathsy_uid_${meetingCode}`;
    let tabId = "";
    if (typeof window !== "undefined") {
      let saved = window.sessionStorage.getItem(sessionKey);
      if (!saved) {
        saved = Math.random().toString(36).substring(2, 7);
        window.sessionStorage.setItem(sessionKey, saved);
      }
      tabId = saved;
    } else {
      tabId = Math.random().toString(36).substring(2, 7);
    }

    if (initialOptions.userId) return `${initialOptions.userId.replace(/_/g, "-")}-${tabId}`;
    if (profile?.id) return `${profile.id.replace(/_/g, "-")}-${tabId}`;
    if (typeof window !== "undefined") {
      try {
        const savedUserStr = window.localStorage.getItem("mathsy_meet_user");
        if (savedUserStr) {
          const parsed = JSON.parse(savedUserStr);
          if (parsed?.id) return `${parsed.id.replace(/_/g, "-")}-${tabId}`;
        }
      } catch {}
    }
    return `usr-${tabId}-${Math.random().toString(36).substring(2, 7)}`;
  });

  const myUserIdRef = useRef<string>(myUserId);
  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  const myName =
    initialOptions.displayName ||
    profile?.name ||
    (() => {
      if (typeof window !== "undefined") {
        try {
          const savedUserStr = window.localStorage.getItem("mathsy_meet_user");
          if (savedUserStr) {
            const parsed = JSON.parse(savedUserStr);
            if (parsed?.name || parsed?.full_name) return parsed.name || parsed.full_name;
          }
        } catch {}
      }
      return isHost ? "Tutor" : "Student";
    })();

  // Connection State
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "failed"
  >("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState<boolean>(meetingCode.startsWith("demo-"));
  const [demoRemainingSec, setDemoRemainingSec] = useState<number | null>(meetingCode.startsWith("demo-") ? 1800 : null);
  const [isDemoEnded, setIsDemoEnded] = useState<boolean>(false);

  // Media States (students join with microphone muted and camera OFF by default)
  const [isMicEnabled, setIsMicEnabled] = useState(Boolean(isHost && !initialOptions.micMuted));
  const [isCamEnabled, setIsCamEnabled] = useState(Boolean(isHost && !initialOptions.camOff));
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean>(isHost);
  const [videoAllowedPeers, setVideoAllowedPeers] = useState<Set<string>>(new Set());
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState<boolean>(false);
  const [gridPage, setGridPage] = useState<number>(0);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);

  // Local tracks
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<MediaStreamTrack | null>(null);
  const [localScreenAudioTrack, setLocalScreenAudioTrack] = useState<MediaStreamTrack | null>(null);

  // Remote Participants & Spotlight
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // View / Layout Modes: "grid" | "spotlight" | "whiteboard" | "screenshare"
  const [layoutMode, setLayoutMode] = useState<"grid" | "spotlight" | "whiteboard" | "screenshare">("grid");
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const showWhiteboardRef = useRef(showWhiteboard);
  useEffect(() => {
    showWhiteboardRef.current = showWhiteboard;
  }, [showWhiteboard]);

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

  // Document Picture-in-Picture for Floating "Always-on-Top" Mini-View during Screen Share
  const {
    isPiPSupported,
    pipWindow,
    isPiPActive,
    openPiP,
    closePiP,
  } = useDocumentPiP({
    width: 340,
    height: 480,
  });

  // Automatically support Document PiP on tab-switch / mediaSession in Chrome 120+
  useEffect(() => {
    if (!isScreenSharing) {
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          (navigator.mediaSession as any).setActionHandler("enterpictureinpicture", null);
        } catch {}
      }
      return;
    }

    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        (navigator.mediaSession as any).setActionHandler("enterpictureinpicture", async () => {
          console.log("[MeetingRoom] mediaSession enterpictureinpicture triggered");
          await openPiP({ width: 340, height: 480 });
        });
      } catch (e) {
        console.warn("[MeetingRoom] mediaSession setActionHandler enterpictureinpicture error:", e);
      }
    }

    return () => {
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          (navigator.mediaSession as any).setActionHandler("enterpictureinpicture", null);
        } catch {}
      }
    };
  }, [isScreenSharing, openPiP]);

  // Mobile Fullscreen & Landscape Orientation for student attendees
  const isMobile = isMobileDevice();
  const isStudentAttendee = !isHost && grantedRole !== "tutor";
  const [isLandscape, setIsLandscape] = useState(() => isLandscapeOrientation());
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [screenZoom, setScreenZoom] = useState(1);
  const [isPipMinimized, setIsPipMinimized] = useState(false);

  useEffect(() => {
    const handleOrientationChange = () => {
      setIsLandscape(isLandscapeOrientation());
    };
    window.addEventListener("resize", handleOrientationChange);
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => {
      window.removeEventListener("resize", handleOrientationChange);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, []);

  // When student attendee joins on mobile devices, request native fullscreen & landscape
  useEffect(() => {
    if (isStudentAttendee && isMobile) {
      enterMobileFullscreenAndLandscape(document.documentElement)
        .then((res) => {
          if (res.fullscreen) setIsFullscreen(true);
          if (res.orientation) setIsLandscape(true);
        })
        .catch(() => {});
    }
    return () => {
      if (isStudentAttendee && isMobile) {
        exitMobileFullscreenAndUnlock().catch(() => {});
      }
    };
  }, [isStudentAttendee, isMobile]);

  // Fullscreen State & Change Listeners
  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(active);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const res = await enterMobileFullscreenAndLandscape(document.documentElement);
        setIsFullscreen(true);
        if (res.orientation) setIsLandscape(true);
        if (isMobile) setIsFocusMode(true);
      } else {
        await exitMobileFullscreenAndUnlock();
        setIsFullscreen(false);
        if (isMobile) setIsFocusMode(false);
      }
    } catch (e) {
      console.warn("[MeetingRoom] toggleFullscreen note:", e);
      const next = !isFullscreen;
      setIsFullscreen(next);
      if (isMobile) setIsFocusMode(next);
    }
  };

  // Pen Device Mode (?pen=1 or passed in options)
  const isPenDevice = window.location.search.includes("pen=1") || Boolean((initialOptions as any)?.isPenDevice);

  // Expelled state
  const [isExpelled, setIsExpelled] = useState(false);
  const [expelledReason, setExpelledReason] = useState("");

  // Camera-off approval state
  const [pendingCameraOffRequest, setPendingCameraOffRequest] = useState<{ studentId: string; studentName: string; reason?: string } | null>(null);

  // Whiteboard sync state
  const [initialWhiteboardSnapshot, setInitialWhiteboardSnapshot] = useState<any>(null);
  const [remoteWhiteboardSnapshot, setRemoteWhiteboardSnapshot] = useState<any>(null);
  const [letStudentsDraw, setLetStudentsDraw] = useState(false);

  // Active Room-Wide Whiteboard & Slide Persistence (Preserved across view toggles until host ends meeting)
  const [roomWhiteboardSnapshot, setRoomWhiteboardSnapshot] = useState<any>(() => {
    try {
      if (typeof window !== "undefined" && meetingCode) {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${meetingCode}`);
        if (cached) return JSON.parse(cached)?.snapshot || null;
      }
    } catch {}
    return null;
  });
  const [roomPresentationSlides, setRoomPresentationSlides] = useState<any[]>(() => {
    try {
      if (typeof window !== "undefined" && meetingCode) {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${meetingCode}`);
        if (cached) return JSON.parse(cached)?.slides || [];
      }
    } catch {}
    return [];
  });
  const [roomSlideIndex, setRoomSlideIndex] = useState<number>(() => {
    try {
      if (typeof window !== "undefined" && meetingCode) {
        const cached = localStorage.getItem(`mathsy_room_whiteboard_${meetingCode}`);
        if (cached) return JSON.parse(cached)?.slideIndex || 0;
      }
    } catch {}
    return 0;
  });

  const handleWhiteboardStateChange = useCallback((snapshot: any, slides?: any[], slideIndex?: number) => {
    if (snapshot) {
      setRoomWhiteboardSnapshot(snapshot);
      if (engineRef.current) engineRef.current.whiteboardSnapshot = snapshot;
    }
    if (slides && slides.length > 0) {
      setRoomPresentationSlides(slides);
    }
    if (typeof slideIndex === "number") {
      setRoomSlideIndex(slideIndex);
    }
    try {
      if (typeof window !== "undefined" && meetingCode) {
        localStorage.setItem(
          `mathsy_room_whiteboard_${meetingCode}`,
          JSON.stringify({
            snapshot: snapshot || roomWhiteboardSnapshot,
            slides: (slides && slides.length > 0) ? slides : roomPresentationSlides,
            slideIndex: typeof slideIndex === "number" ? slideIndex : roomSlideIndex,
            updatedAt: Date.now(),
          })
        );
      }
    } catch {}
  }, [meetingCode, roomWhiteboardSnapshot, roomPresentationSlides, roomSlideIndex]);

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

  // Google Meet Host Admission (Knocking) State
  const [pendingKnocks, setPendingKnocks] = useState<DbRoomKnock[]>([]);
  const seenKnockIdsRef = useRef<Set<string>>(new Set());

  // Polling for waiting participants (host only)
  useEffect(() => {
    if (!isHost) return;

    let isSubscribed = true;
    const fetchKnocks = async () => {
      try {
        const knocks = await dbClient.getHostKnocks(meetingCode);
        if (!isSubscribed) return;
        setPendingKnocks(knocks);

        // Check for newly arrived knocks to trigger chime
        let hasNew = false;
        knocks.forEach((k) => {
          if (!seenKnockIdsRef.current.has(k.id)) {
            seenKnockIdsRef.current.add(k.id);
            hasNew = true;
          }
        });

        if (hasNew) {
          playKnockChime();
        }
      } catch (err) {
        console.warn("[MeetingRoom] Error fetching pending knocks:", err);
      }
    };

    fetchKnocks();
    const interval = setInterval(fetchKnocks, 1500);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [isHost, meetingCode]);

  const handleAdmitKnock = async (knockId: string, name: string) => {
    const success = await dbClient.respondKnock(meetingCode, knockId, "admit");
    if (success) {
      toast.success(`Admitted ${name} to the call`);
      setPendingKnocks((prev) => prev.filter((k) => k.id !== knockId));
    } else {
      toast.error(`Failed to admit ${name}`);
    }
  };

  const handleDenyKnock = async (knockId: string, name: string) => {
    const success = await dbClient.respondKnock(meetingCode, knockId, "deny");
    if (success) {
      toast.info(`Denied entry for ${name}`);
      setPendingKnocks((prev) => prev.filter((k) => k.id !== knockId));
    } else {
      toast.error(`Failed to deny ${name}`);
    }
  };

  const handleAdmitAllKnocks = async () => {
    const res = await dbClient.respondAllKnocks(meetingCode, "admit");
    if (res.success) {
      toast.success(`Admitted ${res.updatedCount} participant(s) to the call`);
      setPendingKnocks([]);
    } else {
      toast.error("Failed to admit all participants");
    }
  };

  // Side Drawer State
  const [isSideDrawerOpen, setIsSideDrawerOpen] = useState(false);
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState(false);
  const [activeSideTab, setActiveSideTab] = useState<"chat" | "polls" | "participants">("chat");
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<{ text: string; senderName: string } | null>(null);
  const [isChatLocked, setIsChatLocked] = useState(false);
  const [mobileSidebarTab, setMobileSidebarTab] = useState<"controls" | "chat" | "participants">("controls");
  const [mobileChatText, setMobileChatText] = useState("");
  const mobileChatBottomRef = useRef<HTMLDivElement>(null);
  const [selectedCameraPeerId, setSelectedCameraPeerId] = useState<string | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantFilter, setParticipantFilter] = useState<"all" | "cameras" | "hands">("all");
  const whiteboardActionsRef = useRef<{ zoomToFit: () => void; exportPdf: () => void; importFile?: () => void } | null>(null);

  useEffect(() => {
    if (mobileSidebarTab === "chat") {
      mobileChatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, mobileSidebarTab]);

  // Polls State
  const [activePoll, setActivePoll] = useState<PollItem | null>(null);
  const [hasVotedPoll, setHasVotedPoll] = useState(false);

  // Floating Reactions State
  const [activeReactions, setActiveReactions] = useState<FloatingReaction[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  // Mobile Responsive State
  const [showMobileLayoutMenu, setShowMobileLayoutMenu] = useState(false);
  const [showMobileMoreSheet, setShowMobileMoreSheet] = useState(false);

  // Recording State
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // YouTube Live State
  const [isYouTubeLive, setIsYouTubeLive] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [youtubeLiveSeconds, setYoutubeLiveSeconds] = useState(0);
  const [youtubeLiveUrl, setYoutubeLiveUrl] = useState("");
  const [showYouTubeConnectModal, setShowYouTubeConnectModal] = useState(false);

  // B6: Dynamically update audio mix when local mic or remote tracks change while streaming
  useEffect(() => {
    if (isYouTubeLive) {
      updateYouTubeLiveAudioSources(
        localAudioTrack,
        remoteParticipants.map((p) => p.audioTrack).filter(Boolean) as MediaStreamTrack[]
      );
    }
  }, [isYouTubeLive, localAudioTrack, remoteParticipants]);

  // B7: Clean up live stream on pagehide / beforeunload / unmount
  useEffect(() => {
    const handlePageHide = () => {
      if (isYouTubeLive) {
        stopYouTubeLiveStreaming(false);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, [isYouTubeLive]);

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


  // Demo Room Countdown Timer
  useEffect(() => {
    if (!isDemo || demoRemainingSec === null) return;
    const interval = setInterval(() => {
      setDemoRemainingSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          setIsDemoEnded(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isDemo, demoRemainingSec]);

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

    engine.onConnectionStateChange = (state, errMsg?: string) => {
      setConnectionState(state);
      if (state === "connected") {
        setConnectionError(null);
        toast.success(`Joined room: ${meetingCode}`);
        loadChatHistory();
        dbClient.getWhiteboardState(meetingCode).then((wbState) => {
          if (wbState?.isOpen && !isHostRef.current) {
            setShowWhiteboard(true);
            setLayoutMode("whiteboard");
          }
        });
      } else if (state === "failed") {
        const msg = errMsg || "Could not connect to the classroom server.";
        setConnectionError(msg);
        toast.error("Connection Failed", { description: msg });
      }
    };

    engine.onRoleAssigned = (serverRole, isOwner, roomData) => {
      if (isOwner) {
        setIsHost(true);
        isHostRef.current = true;
        setGrantedRole("tutor");
        window.sessionStorage.setItem(`mathsy_host_${meetingCode}`, "true");
        // Ensure database whiteboard state matches initial host mode (default grid)
        if (!showWhiteboardRef.current) {
          dbClient.setWhiteboardState(meetingCode, false);
        }
      } else if (!isHostRef.current) {
        // Only demote to student if the participant is not already an authorized room host.
        // True room ownership is authoritative from PostgreSQL database (/api/rooms/:roomCode/participants),
        // and cannot be stripped by unauthenticated media relay (SFU) events.
        setIsHost(false);
        isHostRef.current = false;
        setGrantedRole("student");
        window.sessionStorage.removeItem(`mathsy_host_${meetingCode}`);
      }
      if (roomData?.isDemo) {
        setIsDemo(true);
        if (typeof roomData.remainingSec === "number") {
          setDemoRemainingSec(roomData.remainingSec);
        }
      }
      if (roomData?.whiteboardSnapshot) {
        setInitialWhiteboardSnapshot(roomData.whiteboardSnapshot);
        setRoomWhiteboardSnapshot((prev: any) => prev || roomData.whiteboardSnapshot);
      }
      if (typeof roomData?.letStudentsDraw === "boolean") {
        setLetStudentsDraw(roomData.letStudentsDraw);
      }
      if (roomData?.pinnedMessage) {
        setPinnedMessage(roomData.pinnedMessage);
      }
      if (typeof roomData?.isChatLocked === "boolean") {
        setIsChatLocked(roomData.isChatLocked);
      }
      if (roomData?.activePoll) {
        setActivePoll(roomData.activePoll);
      }
      if (serverRole === "tutor" || isPenDevice) {
        setUnmuteRequestStatus("approved");
        setShowCameraGateModal(false);
      }
    };

    engine.onDemoRoomEnded = () => {
      setIsDemoEnded(true);
    };

    engine.onParticipantsChange = (updated) => {
      setRemoteParticipants([...updated]);
      // If I am host, ensure newly joined participants synchronize with my current layout mode
      if (isHostRef.current) {
        engineRef.current?.broadcastWhiteboardState(meetingCode, showWhiteboardRef.current, true);
      }
    };

    engine.onCameraPermissionChange = (allowed: boolean) => {
      setHasCameraPermission(allowed);
      if (allowed) {
        toast.success("Tutor granted you permission to turn on your camera! 📹", { id: "cam-perm" });
      } else {
        toast.info("Camera permission was revoked by the tutor.", { id: "cam-perm" });
        setIsCamEnabled(false);
        setLocalVideoTrack(null);
      }
    };

    engine.onForceCameraOff = () => {
      setIsCamEnabled(false);
      setLocalVideoTrack(null);
      toast.info("Your camera was turned off by the tutor.", { id: "cam-force-off" });
    };

    engine.onPeerVideoPermission = (peerId: string, allowed: boolean) => {
      setVideoAllowedPeers((prev) => {
        const next = new Set(prev);
        if (allowed) next.add(peerId);
        else next.delete(peerId);
        return next;
      });
    };

    engine.onScreenShareEnded = () => {
      console.log("[MeetingRoom] Engine notified screen share ended");
      setLocalScreenTrack(null);
      setLocalScreenAudioTrack(null);
      setIsScreenSharing(false);
      closePiP();
      setLayoutMode((prev) => (prev === "screenshare" ? "grid" : prev));
    };

    engine.onPeerLeft = (peerId, userId, name) => {
      console.log("[MeetingRoom] Peer left event received:", { peerId, userId, name });
      setUnmuteRequests((prev) =>
        prev.filter((r) => r.userId !== peerId && (r as any).peerId !== peerId && (!userId || r.userId !== userId))
      );
      setRemoteParticipants((prev) =>
        prev.filter((p) => {
          const match =
            p.id === peerId ||
            p.id === userId ||
            (p as any).userId === peerId ||
            (p as any).userId === userId ||
            (p as any).peerId === peerId ||
            (p as any).peerId === userId ||
            (peerId && (p.id.includes(peerId) || peerId.includes(p.id))) ||
            (userId && ((p as any).userId?.includes(userId) || userId.includes((p as any).userId || ""))) ||
            (name && p.name && p.name.trim().toLowerCase() === name.trim().toLowerCase());
          return !match;
        })
      );
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
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem(`mathsy_room_whiteboard_${meetingCode}`);
        }
      } catch {}
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
      } else if (ctrl.controlAction === "SCREENSHARE_STATE") {
        const ctrlRoom = (ctrl.roomCode || "").toLowerCase().trim();
        const curRoom = meetingCode.toLowerCase().trim();
        if (ctrlRoom && curRoom && ctrlRoom !== curRoom) return;
        if (!isHostRef.current) {
          const shouldOpen = Boolean(ctrl.isOpen);
          if (shouldOpen) {
            setShowWhiteboard(false);
            setLayoutMode("screenshare");
          } else {
            setLayoutMode((prev) => (prev === "screenshare" ? "grid" : prev));
          }
        }
      } else if (ctrl.controlAction === "HAND_RAISE") {
        const targetId = (ctrl.peerId || ctrl.userId || ctrl.senderId || "").toLowerCase().replace(/_/g, "-");
        const isRaised = Boolean(ctrl.isHandRaised ?? ctrl.raised);
        if (targetId && isTargetMe) {
          setIsHandRaised(isRaised);
        } else {
          setRemoteParticipants((prev) =>
            prev.map((p) => {
              const pId = (p.id || (p as any).peerId || "").toLowerCase().replace(/_/g, "-");
              if (pId === targetId || pId.includes(targetId) || targetId.includes(pId)) {
                return { ...p, isHandRaised: isRaised };
              }
              return p;
            })
          );
        }
        if (isHostRef.current && isRaised) {
          toast.info(`${ctrl.name || "A student"} raised their hand!`, { id: `hand-${targetId}` });
        }
      } else if (ctrl.controlAction === "HAND_LOWER") {
        const targetId = (ctrl.targetUserId || ctrl.studentId || ctrl.userId || "").toLowerCase().replace(/_/g, "-");
        if (ctrl.all || targetId === "all") {
          setIsHandRaised(false);
          setRemoteParticipants((prev) => prev.map((p) => ({ ...p, isHandRaised: false })));
        } else if (isTargetMe) {
          setIsHandRaised(false);
          toast.info("Your hand was lowered by the tutor", { id: "hand-lowered" });
        } else {
          setRemoteParticipants((prev) =>
            prev.map((p) => {
              const pId = (p.id || (p as any).peerId || "").toLowerCase().replace(/_/g, "-");
              if (pId === targetId || pId.includes(targetId) || targetId.includes(pId)) {
                return { ...p, isHandRaised: false };
              }
              return p;
            })
          );
        }
      }
    };

    engine.onHandLowered = (studentId) => {
      const sId = (studentId || "").toLowerCase().replace(/_/g, "-");
      const currentId = (myUserIdRef.current || myUserId || "").toLowerCase().replace(/_/g, "-");
      if (!sId || sId === currentId || sId === "all") {
        setIsHandRaised(false);
      }
      setRemoteParticipants((prev) =>
        prev.map((p) => {
          const pId = (p.id || (p as any).peerId || "").toLowerCase().replace(/_/g, "-");
          if (!sId || sId === "all" || pId === sId) {
            return { ...p, isHandRaised: false };
          }
          return p;
        })
      );
    };

    engine.onHandLowerAll = () => {
      setIsHandRaised(false);
      setRemoteParticipants((prev) => prev.map((p) => ({ ...p, isHandRaised: false })));
    };

    // Resolve auth token (embed, session, or stored mathsy_meet_token)
    const authToken =
      initialOptions.token ||
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem(`mathsy_meet_embed_token_${meetingCode}`) ||
          window.sessionStorage.getItem("mathsy_meet_embed_token") ||
          window.localStorage.getItem("mathsy_meet_token")
        : "") ||
      session?.access_token ||
      "";

    // Record self in room attendance in PostgreSQL with server-verified role
    dbClient
      .recordParticipantJoin(
        {
          room_code: meetingCode,
          user_id: myUserId,
          display_name: myName,
          role: isHostRef.current ? "tutor" : "student",
        },
        authToken
      )
      .then((joinRes) => {
        if (joinRes) {
          // If server rejected non-host because class hasn't started or admission is required, boot back to lobby
          if (!isHostRef.current && (joinRes.code === "CLASS_NOT_STARTED" || joinRes.code === "ADMISSION_REQUIRED" || (joinRes.error && !joinRes.isHost))) {
            console.warn("[MeetingRoom] Room entry rejected by server:", joinRes);
            toast.error(joinRes.error || "This class has not started yet. Waiting for tutor...");
            try {
              engine.disconnect();
            } catch {}
            onLeaveMeeting();
            return;
          }

          if (joinRes.tutorId) {
            engine.setAuthorizedTutorId(String(joinRes.tutorId));
          }
          const hostConfirmed = Boolean(joinRes.isHost);
          setIsHost(hostConfirmed);
          isHostRef.current = hostConfirmed;
          engine.setIsHostUser(hostConfirmed);
          if (hostConfirmed) {
            setGrantedRole("tutor");
            setHasSpeakingPermission(true);
            setUnmuteRequestStatus("approved");
            window.sessionStorage.setItem(`mathsy_host_${meetingCode}`, "true");
          } else {
            setGrantedRole("student");
            setHasSpeakingPermission(false);
            setUnmuteRequestStatus("none");
            window.sessionStorage.removeItem(`mathsy_host_${meetingCode}`);
          }
        }
      });

    // Late-joining participant: query active whiteboard state
    dbClient.getWhiteboardState(meetingCode).then((wbState) => {
      if (wbState?.isOpen && !isHostRef.current) {
        setShowWhiteboard(true);
        setLayoutMode("whiteboard");
      }
    });

    // Handle tab close / refresh / mobile app switch: broadcast instant leave and beacon
    const handleBeforeUnload = () => {
      try {
        engine.leaveRoom();
        const payload = JSON.stringify({ user_id: myUserId, display_name: myName });
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(`/api/rooms/${encodeURIComponent(meetingCode)}/leave`, blob);
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

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
            setLocalScreenAudioTrack(engine.localScreenAudioTrack || null);
            setIsScreenSharing(true);
            setLayoutMode("screenshare");
            engine.broadcastScreenShareState(meetingCode, true, true);
          }
        }
      })
      .catch((err) => {
        console.warn("[MeetingRoom] Engine connect caught:", err);
      });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      try {
        engine.leaveRoom();
      } catch {}
      dbClient.recordParticipantLeave(meetingCode, myUserId, myName);
      stopYouTubeLiveStreaming();
      engine.disconnect();
    };
  }, [meetingCode]);

  // Authoritative room ownership synchronization when async authentication resolves
  useEffect(() => {
    if (!profile?.id && !session?.access_token) return;
    const token =
      session?.access_token ||
      (typeof window !== "undefined" ? window.localStorage.getItem("mathsy_meet_token") : "") ||
      "";
    dbClient
      .recordParticipantJoin(
        {
          room_code: meetingCode,
          user_id: myUserIdRef.current,
          display_name: myName,
          role: isHostRef.current ? "tutor" : "student",
        },
        token
      )
      .then((joinRes) => {
        if (joinRes && joinRes.isHost) {
          setIsHost(true);
          isHostRef.current = true;
          setGrantedRole("tutor");
          setHasSpeakingPermission(true);
          setUnmuteRequestStatus("approved");
          window.sessionStorage.setItem(`mathsy_host_${meetingCode}`, "true");
          const engine = engineRef.current;
          if (engine) {
            engine.setIsHostUser(true);
            if (joinRes.tutorId) {
              engine.setAuthorizedTutorId(String(joinRes.tutorId));
            }
          }
        }
      });
  }, [profile?.id, session?.access_token, meetingCode]);

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
        if (!hasCameraPermission) {
          toast.info("Camera is locked by the tutor. Please raise your hand to request camera permission.", { id: "cam-perm-needed" });
          return;
        }
        const track = await engine.enableVideo();
        setLocalVideoTrack(track);
        setIsCamEnabled(true);
        setShowCameraGateModal(false);
      } else {
        engine.disableVideo();
        setLocalVideoTrack(null);
        setIsCamEnabled(false);
      }
    }
  };

  const handleToggleStudentCamera = (peerId: string, allow: boolean) => {
    if (!isHost) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (allow) {
      engine.allowStudentCamera(peerId);
      setVideoAllowedPeers((prev) => new Set(prev).add(peerId));
      toast.success("Student camera permitted");
    } else {
      engine.revokeStudentCamera(peerId);
      setVideoAllowedPeers((prev) => {
        const next = new Set(prev);
        next.delete(peerId);
        return next;
      });
      toast.info("Student camera revoked");
    }
  };

  const handleToggleAudioOnly = () => {
    const next = !isAudioOnlyMode;
    setIsAudioOnlyMode(next);
    engineRef.current?.setAudioOnlyMode(next);
    if (next) {
      toast.success("Data Saver enabled: video streaming paused ⚡");
    } else {
      toast.info("Data Saver disabled: video streaming resumed");
    }
  };

  // Screen Share Handler
  const handleToggleScreenShare = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isScreenSharing) {
      engine.stopScreenShare();
      setLocalScreenTrack(null);
      setLocalScreenAudioTrack(null);
      setIsScreenSharing(false);
      closePiP();
      setLayoutMode((prev) => (prev === "screenshare" ? "grid" : prev));
    } else {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getDisplayMedia !== "function"
      ) {
        toast.info(
          "Screen sharing is not supported by your mobile browser. Please join from a desktop or laptop computer to share your screen.",
          { duration: 5000 }
        );
        return;
      }

      // If whiteboard was active, close it first to keep presentation modes clean and consistent
      if (showWhiteboard || layoutMode === "whiteboard") {
        setShowWhiteboard(false);
        engine.broadcastWhiteboardState(meetingCode, false, true);
        dbClient.setWhiteboardState(meetingCode, false);
      }

      // Smoothly transition focus to captured window/surface using CaptureController where supported
      let controller: any = undefined;
      if (typeof window !== "undefined" && "CaptureController" in window) {
        try {
          controller = new (window as any).CaptureController();
          if (typeof controller.setFocusBehavior === "function") {
            controller.setFocusBehavior("focus-captured-surface");
          }
        } catch (err) {
          console.warn("[MeetingRoom] CaptureController warning:", err);
        }
      }

      const track = await engine.startScreenShare(controller);
      if (track) {
        setLocalScreenTrack(track);
        setLocalScreenAudioTrack(engine.localScreenAudioTrack || null);
        setIsScreenSharing(true);
        setLayoutMode("screenshare");
        engine.broadcastScreenShareState(meetingCode, true, true);

        if (engine.localScreenAudioTrack) {
          toast.success("Sharing screen with tab/system audio", { id: "screen-audio-active" });
        } else {
          toast("Sharing screen (Tip: select 'Also share tab audio' to play video sound)", { icon: "ℹ️", id: "screen-audio-hint" });
        }

        // Immediately launch floating always-on-top Document PiP mini-meet overlay
        try {
          await openPiP({ width: 340, height: 480 });
          toast.success("Floating mini-view opened (Always on top)", { id: "pip-launched" });
        } catch (pipErr) {
          console.warn("[MeetingRoom] Error launching Document PiP window:", pipErr);
        }
      }
    }
  };

  // Unified Layout Switcher (used by desktop header, mobile header, and mobile more menu)
  const switchToLayout = (mode: "grid" | "spotlight" | "whiteboard" | "screenshare") => {
    if (mode === "whiteboard") {
      if (!isHost && !showWhiteboard) return;
      if (isScreenSharing) {
        engineRef.current?.stopScreenShare();
        setLocalScreenTrack(null);
        setLocalScreenAudioTrack(null);
        setIsScreenSharing(false);
      }
      setShowWhiteboard(true);
      setLayoutMode("whiteboard");
      if (isHost) {
        engineRef.current?.broadcastWhiteboardState(meetingCode, true, true);
        dbClient.setWhiteboardState(meetingCode, true);
      }
    } else if (mode === "grid") {
      const wasWhiteboard = showWhiteboard || layoutMode === "whiteboard";
      setShowWhiteboard(false);
      setLayoutMode("grid");
      if (isHost && wasWhiteboard) {
        engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
        dbClient.setWhiteboardState(meetingCode, false);
      }
    } else if (mode === "spotlight") {
      const wasWhiteboard = showWhiteboard || layoutMode === "whiteboard";
      setShowWhiteboard(false);
      setLayoutMode("spotlight");
      if (isHost && wasWhiteboard) {
        engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
        dbClient.setWhiteboardState(meetingCode, false);
      }
    } else if (mode === "screenshare") {
      setShowWhiteboard(false);
      setLayoutMode("screenshare");
    }
  };

  // Whiteboard Toggle Handler
  const handleToggleWhiteboard = () => {
    const next = !showWhiteboard;
    setShowWhiteboard(next);
    if (next) {
      if (isScreenSharing) {
        engineRef.current?.stopScreenShare();
        setLocalScreenTrack(null);
        setLocalScreenAudioTrack(null);
        setIsScreenSharing(false);
      }
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
        console.warn("[MeetingRoom] Backend chat persistence unavailable, falling back to direct WebRTC peer broadcast:", err);
        const fallbackTimestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        // Fallback: Always deliver via WebRTC live signaling so in-call communication never breaks
        engineRef.current?.broadcastChatMessage({
          id: cId,
          clientMessageId: cId,
          senderId: myUserId,
          senderName: myName,
          text: content,
          timestamp: fallbackTimestamp,
          isHost,
        });

        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === cId || m.clientMessageId === cId
              ? {
                  ...m,
                  status: "sent",
                  timestamp: fallbackTimestamp,
                }
              : m
          )
        );
      }
    };

    performSend(clientMessageId, text);
  };

  // Launch Poll (Broadcasts to everyone via socket)
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
    engineRef.current?.emitSignal("poll:update", newPoll);
    toast.success("Poll launched to all students!", { id: "poll-launch" });
  };

  // Vote Poll (Broadcasts vote & updates leaderboard)
  const handleVotePoll = (optionIndex: number) => {
    if (!activePoll || hasVotedPoll) return;

    const currentVotes = { ...activePoll.votes };
    currentVotes[optionIndex] = (currentVotes[optionIndex] || 0) + 1;
    const isCorrect = activePoll.correctOptionIndex === optionIndex;

    const updatedPoll: PollItem = {
      ...activePoll,
      votes: currentVotes,
      totalVotes: activePoll.totalVotes + 1,
      voters: [
        ...activePoll.voters,
        {
          userId: myUserId,
          userName: myName,
          optionIndex,
          timestamp: Date.now(),
          isCorrect,
        },
      ],
    };

    setActivePoll(updatedPoll);
    setHasVotedPoll(true);
    engineRef.current?.emitSignal("poll:vote", updatedPoll);
    toast.success("Vote recorded!");
  };

  // End Poll (Reveals answers and final scores to all participants)
  const handleEndPoll = () => {
    if (!activePoll) return;
    const endedPoll = { ...activePoll, isActive: false };
    setActivePoll(endedPoll);
    engineRef.current?.emitSignal("poll:update", endedPoll);
    toast.info("Poll ended. Leaderboard revealed to everyone!");
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
    toast.success("Muted all students");
  };

  // Lower All Hands (Tutor Only)
  const handleLowerAllHands = () => {
    engineRef.current?.lowerAllHands();
    setIsHandRaised(false);
    toast.success("Lowered all raised hands");
  };

  // Lower One Student Hand (Tutor Only)
  const handleLowerStudentHand = (studentId: string) => {
    engineRef.current?.lowerStudentHand(studentId);
    if (studentId === myUserId) setIsHandRaised(false);
  };

  // Force Mute Single Student (Tutor Only)
  const handleForceMuteStudent = (studentId: string, studentName: string) => {
    engineRef.current?.forceMuteParticipant?.(studentId);
    toast.success(`Muted ${studentName}`);
  };

  // Expel Student & Block Rejoin (Tutor Only)
  const handleExpelStudent = (studentId: string, studentName: string) => {
    if (window.confirm(`Are you sure you want to remove ${studentName} from the class and block rejoin?`)) {
      engineRef.current?.expelStudent(studentId);
      setRemoteParticipants((prev) => prev.filter((p) => p.id !== studentId));
      toast.success(`${studentName} removed from session and banned`);
    }
  };

  // Chat Lock & Pin (Tutor Only)
  const handleToggleChatLock = () => {
    const nextLocked = !isChatLocked;
    setIsChatLocked(nextLocked);
    engineRef.current?.setChatLock(nextLocked);
    toast.info(nextLocked ? "Chat locked for students" : "Chat unlocked");
  };

  const handlePinMessage = (text: string) => {
    const pin = { text, senderName: myName };
    setPinnedMessage(pin);
    engineRef.current?.setChatPin(pin);
    toast.success("Message pinned at top of chat");
  };

  const handleUnpinMessage = () => {
    setPinnedMessage(null);
    engineRef.current?.setChatPin(null);
  };

  // Camera-off entry requests
  const handleRequestCameraOff = () => {
    setJoinPendingApproval(true);
    engineRef.current?.requestCameraOff("Student requested camera-off entry");
    toast.info("Camera-off request sent to tutor. Waiting for approval...");
  };

  const handleRespondCameraOff = (studentId: string, approved: boolean) => {
    engineRef.current?.respondCameraOff(studentId, approved);
    setPendingCameraOffRequest(null);
    toast.success(approved ? "Approved camera-off request" : "Declined camera-off request");
  };

  // YouTube Live Handlers (B3, B4, B7)
  const handleStartYouTubeLive = async () => {
    try {
      setIsLiveConnecting(true);
      const authSessionToken = session?.access_token || engineRef.current?.getAuthToken() || "";
      const liveStreamSession = await startYouTubeLiveStreaming({
        meetingCode,
        title: `${myName}'s Mathsy Live Class - ${meetingCode}`,
        token: authSessionToken,
        localAudioTrack,
        remoteAudioTracks: remoteParticipants
          .map((p) => p.audioTrack)
          .filter(Boolean) as MediaStreamTrack[],
        emitSignal: (event, payload, ack) => engineRef.current?.emitSignal(event, payload, ack),
        onSignal: (event, cb) => engineRef.current?.onSignal(event, cb),
        onStatusChange: (status) => {
          if (status === "connecting") {
            setIsLiveConnecting(true);
          } else if (status === "live") {
            setIsLiveConnecting(false);
            setIsYouTubeLive(true);
          } else if (status === "ended" || status === "idle") {
            setIsLiveConnecting(false);
            setIsYouTubeLive(false);
            setStreamStats(null);
          } else if (status === "error") {
            setIsLiveConnecting(false);
            setIsYouTubeLive(false);
            setStreamStats(null);
          }
        },
        onStatsUpdate: (stats) => {
          setStreamStats(stats);
        },
        onError: () => {
          setIsLiveConnecting(false);
          setIsYouTubeLive(false);
          setStreamStats(null);
        },
      });

      if (liveStreamSession) {
        setYoutubeLiveUrl(liveStreamSession.youtubeUrl);
      }
    } catch (err: any) {
      console.error("[YouTubeLive] Failed to start:", err);
      setIsLiveConnecting(false);
      toast.error("Failed to start YouTube Live Stream");
    }
  };

  const handleStopYouTubeLive = async () => {
    await stopYouTubeLiveStreaming(true);
    setIsYouTubeLive(false);
    setIsLiveConnecting(false);
    setStreamStats(null);
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

  // Participant Leave Handler
  const handleLeaveMeeting = () => {
    try {
      engineRef.current?.leaveRoom();
      dbClient.recordParticipantLeave(meetingCode, myUserId, myName);
    } catch {}
    // Allow 150ms buffer flush so outbound PEER_LEFT socket packets traverse network
    setTimeout(() => {
      onLeaveMeeting();
    }, 150);
  };

  // Authoritative database participant reconciliation:
  // PostgreSQL room_participants (left_at IS NULL) is the single source of truth for who is admitted & active.
  // Any remote participant tile that has NO active media tracks AND is NOT active in the database is pruned as a ghost peer.
  useEffect(() => {
    if (!meetingCode) return;

    const reconcileWithDb = async () => {
      try {
        const dbParticipants = await dbClient.getParticipants(meetingCode);
        if (Array.isArray(dbParticipants)) {
          const activeUserIds = new Set(dbParticipants.map((p) => p.user_id).filter(Boolean));
          const activeNames = new Set(
            dbParticipants.map((p) => (p.display_name || "").trim().toLowerCase()).filter(Boolean)
          );

          setRemoteParticipants((prev) => {
            const next = prev.filter((p) => {
              const hasActiveMedia = Boolean(p.audioTrack || p.videoTrack || p.screenTrack);
              const isDbActive =
                activeUserIds.has(p.id) ||
                (p.userId && activeUserIds.has(p.userId)) ||
                (p.name && activeNames.has(p.name.trim().toLowerCase()));

              // If peer is not in active database participants and has no active media stream, prune immediately
              const isGhost = !hasActiveMedia && !isDbActive;
              if (isGhost) {
                console.log(`[MeetingRoom] Pruning ghost peer from remote participants: ${p.name} (${p.id})`);
                engineRef.current?.removeParticipant(p.id, p.name);
                return false;
              }
              return true;
            });
            return next.length === prev.length ? prev : next;
          });
        }
      } catch {
        // silent sync
      }
    };

    reconcileWithDb();
    const interval = setInterval(reconcileWithDb, 2000);

    return () => clearInterval(interval);
  }, [meetingCode, remoteParticipants.length]);

  // End Meeting Handler
  const handleEndClassClick = async () => {
    try {
      engineRef.current?.leaveRoom();
    } catch {}
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
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem(`mathsy_room_whiteboard_${meetingCode}`);
        }
      } catch {}
      setChatMessages([]);
      setShowPostClassModal(true);
    } else {
      handleLeaveMeeting();
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
      screenTrack: localScreenTrack,
      screenAudioTrack: localScreenAudioTrack,
      isAudioMuted: !isMicEnabled,
      isVideoMuted: !isCamEnabled,
      isHandRaised: isHandRaised,
    },
    ...remoteParticipants
      .filter((p) => p.id !== myUserId && (p as any).peerId !== myUserId)
      .map((p) => {
        const isPeerHost = p.role === "host" || p.role === "tutor" || (p as any).isHost === true;
        return {
          id: p.id,
          userId: (p as any).userId || p.id,
          name: p.name,
          role: isPeerHost ? "host" : (p.role || "student"),
          audioTrack: p.audioTrack || null,
          videoTrack: p.videoTrack || null,
          screenTrack: p.screenTrack || null,
          screenAudioTrack: p.screenAudioTrack || null,
          isAudioMuted: p.audioTrack ? Boolean(p.isAudioMuted && !p.audioTrack.enabled) : true,
          isVideoMuted: p.videoTrack ? Boolean(p.isVideoMuted && !p.videoTrack.enabled) : true,
          isHandRaised: p.isHandRaised ?? false,
        };
      }),
  ];

  // Grid Pagination & Bandwidth Optimization: Cap to 6 video tiles at a time
  const TILES_PER_PAGE = 6;
  const totalGridPages = Math.max(1, Math.ceil(allParticipants.length / TILES_PER_PAGE));
  const visibleGridParticipants = useMemo(() => {
    if (allParticipants.length <= TILES_PER_PAGE) return allParticipants;
    const pageIndex = Math.min(gridPage, totalGridPages - 1);
    const start = pageIndex * TILES_PER_PAGE;
    return allParticipants.slice(start, start + TILES_PER_PAGE);
  }, [allParticipants, gridPage, totalGridPages]);

  // Pause video consumers for off-screen tiles or during Audio-Only Mode to preserve CPU/bandwidth
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const visibleTrackIds = new Set(
      visibleGridParticipants.map((p) => p.videoTrack?.id).filter(Boolean)
    );

    remoteParticipants.forEach((p) => {
      if (p.videoTrack) {
        const consumerId = engine.getConsumerForTrack(p.videoTrack.id);
        if (consumerId) {
          if (visibleTrackIds.has(p.videoTrack.id) && !isAudioOnlyMode) {
            engine.resumeConsumer(consumerId);
          } else {
            engine.pauseConsumer(consumerId);
          }
        }
      }
    });
  }, [visibleGridParticipants, remoteParticipants, isAudioOnlyMode]);

  // Active Screen Share track (local presenter or remote peer)
  const remoteScreenSharer = remoteParticipants.find((p) => Boolean(p.screenTrack));
  const activeScreenTrack = localScreenTrack || remoteScreenSharer?.screenTrack || null;
  const isAnyoneScreenSharing = Boolean(activeScreenTrack);

  // Auto-switch layout mode for remote viewers when tutor starts/stops sharing
  useEffect(() => {
    if (!isHost) {
      if (remoteScreenSharer?.screenTrack) {
        if (!showWhiteboard) {
          setLayoutMode("screenshare");
        }
      } else {
        setLayoutMode((prev) => (prev === "screenshare" ? "grid" : prev));
      }
    }
  }, [remoteScreenSharer?.screenTrack, isHost, showWhiteboard]);

  const totalRaisedHands = allParticipants.filter((p) => p.isHandRaised).length;

  // Mobile Horizontal / Landscape 75/25 Split Layout Mode
  // Activated strictly on mobile devices in horizontal orientation when Whiteboard or Screen Share is active
  const isMobileLandscape = isMobile && isLandscape;
  const isMobileLandscapeSplit = isMobileLandscape && (showWhiteboard || layoutMode === "whiteboard" || (layoutMode === "screenshare" && isAnyoneScreenSharing));

  // Tutor / Presenter Peer & Floating PiP Media Resolution
  const tutorPeer = allParticipants.find((p) => (p.role === "host" || p.role === "tutor") && p.id !== myUserId)
    || remoteParticipants.find((p) => p.role === "host" || p.role === "tutor")
    || remoteParticipants.find((p) => p.id !== myUserId);

  const pipTrack = isHost
    ? (isCamEnabled ? localVideoTrack : null)
    : (tutorPeer?.videoTrack || null);

  const pipName = isHost
    ? "Host (You)"
    : tutorPeer
    ? (tutorPeer.name ? `${tutorPeer.name} (Tutor)` : "Tutor")
    : "Tutor";

  // Selected camera peer resolution in Mobile Landscape Split
  const mobileActiveCameraPeer = selectedCameraPeerId
    ? allParticipants.find((p) => p.id === selectedCameraPeerId) || tutorPeer
    : tutorPeer;

  const mobilePipTrack = isHost
    ? (isCamEnabled ? localVideoTrack : null)
    : (mobileActiveCameraPeer?.videoTrack || null);

  const mobilePipName = isHost
    ? `${myName} (You)`
    : mobileActiveCameraPeer
    ? (mobileActiveCameraPeer.name ? `${mobileActiveCameraPeer.name}${mobileActiveCameraPeer.role === "host" || mobileActiveCameraPeer.role === "tutor" ? " (Tutor)" : ""}` : "Tutor")
    : "Tutor";

  const mobileIsTutorSelected = !selectedCameraPeerId || selectedCameraPeerId === tutorPeer?.id;

  // Broadcaster students (cameras on, not host, not self) for 100-student smart switcher
  const broadcasterStudents = allParticipants.filter(
    (p) => p.id !== myUserId && p.id !== tutorPeer?.id && p.role !== "host" && p.role !== "tutor" && Boolean(p.videoTrack)
  );

  const isCustomStudentSelected = selectedCameraPeerId && selectedCameraPeerId !== tutorPeer?.id && !broadcasterStudents.some((b) => b.id === selectedCameraPeerId);
  const customSelectedPeer = isCustomStudentSelected ? allParticipants.find((p) => p.id === selectedCameraPeerId) : null;

  // Filtered students for 100-student directory
  const filteredStudents = allParticipants.filter((p) => {
    if (participantFilter === "cameras" && !p.videoTrack) return false;
    if (participantFilter === "hands" && !p.isHandRaised) return false;
    if (participantSearch.trim()) {
      const q = participantSearch.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.role && p.role.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div
      ref={playerRef}
      className="flex flex-col h-[100dvh] w-full min-h-0 bg-[#0e0d0b] text-[#f3eee6] overflow-hidden select-none font-sans relative"
    >
      {/* Floating Exit Focus Mode Pill */}
      {isFocusMode && (
        <button
          onClick={() => {
            setIsFocusMode(false);
            if (isFullscreen) {
              exitMobileFullscreenAndUnlock().catch(() => {});
              setIsFullscreen(false);
            }
          }}
          className="absolute top-2 left-2 z-50 px-3 py-1 bg-black/85 hover:bg-black text-[#f59e0b] border border-[#f59e0b]/40 rounded-full text-xs font-semibold backdrop-blur-md shadow-2xl flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Exit Focus</span>
        </button>
      )}

      {/* Persistent Audio Sink: Guarantees remote student/tutor audio is always played regardless of active view layout (Whiteboard, Screen Share, Spotlight, or Grid) */}
      <div className="hidden" aria-hidden="true">
        {remoteParticipants.map((p) => (
          <RemoteAudioElement
            key={p.id}
            participant={p}
            playScreenAudio={layoutMode !== "screenshare"}
          />
        ))}
      </div>

      {/* ── CLASSROOM HEADER ── */}
      <header
        className={`h-14 shrink-0 bg-[#16130f] border-b border-[#f3eee6]/[0.08] px-2.5 sm:px-4 flex items-center justify-between z-20 backdrop-blur-md gap-2 ${
          isFocusMode ? "mathsy-focus-mode-header hidden" : ""
        } ${isMobileLandscapeSplit ? "hidden" : ""}`}
      >
        {/* Left: Room Badge & Duration */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            onClick={() => {
              setIsInfoDrawerOpen(!isInfoDrawerOpen);
              if (!isInfoDrawerOpen) setIsSideDrawerOpen(false);
            }}
            title="Meeting details (Click to view code & link)"
            className="flex items-center gap-1.5 sm:gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-2.5 sm:px-3 py-1 rounded-full text-xs transition cursor-pointer group"
          >
            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#10b981] animate-pulse shrink-0" />
            <span className="text-xs font-mono font-bold text-[#f3eee6] tracking-wide truncate group-hover:text-[#f59e0b] transition max-w-[100px] sm:max-w-none">
              {meetingCode}
            </span>
            <Info className="w-3.5 h-3.5 text-[#a39e94] group-hover:text-[#f59e0b] transition ml-0.5 shrink-0" />
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
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              backgroundColor: connectionState === "connected" ? "#10b981" : "#f59e0b",
            }}
            title={`Status: ${connectionState}`}
          />

          {/* Demo room countdown badge */}
          {isDemo && demoRemainingSec !== null && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Demo: {Math.floor(demoRemainingSec / 60).toString().padStart(2, "0")}:{(demoRemainingSec % 60).toString().padStart(2, "0")}
            </div>
          )}
        </div>

        {/* Center: Desktop Layout Selector */}
        <div className="hidden md:flex items-center gap-1 bg-[#1a1814] border border-[#f3eee6]/10 p-1 rounded-xl">
          <button
            onClick={() => switchToLayout("grid")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              layoutMode === "grid" && !showWhiteboard
                ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                : "text-[#a39e94] hover:text-[#f3eee6]"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Grid
          </button>

          <button
            onClick={() => switchToLayout("spotlight")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
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
              onClick={() => switchToLayout("whiteboard")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                showWhiteboard || layoutMode === "whiteboard"
                  ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                  : "text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Whiteboard
            </button>
          )}

          {isAnyoneScreenSharing && (
            <button
              onClick={() => switchToLayout("screenshare")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                layoutMode === "screenshare" && !showWhiteboard
                  ? "bg-[#f59e0b] text-[#0e0d0b] shadow-sm"
                  : "text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Screen
            </button>
          )}
        </div>

        {/* Center: Mobile Layout Selector Dropdown */}
        <div className="flex md:hidden items-center relative">
          <button
            onClick={() => setShowMobileLayoutMenu(!showMobileLayoutMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1a1814] border border-[#f3eee6]/10 text-[#f3eee6] hover:bg-[#221f1a] transition cursor-pointer"
            title="Switch view layout"
          >
            {showWhiteboard || layoutMode === "whiteboard" ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Board</span>
              </>
            ) : layoutMode === "spotlight" ? (
              <>
                <Radio className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Spotlight</span>
              </>
            ) : layoutMode === "screenshare" ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Screen</span>
              </>
            ) : (
              <>
                <LayoutGrid className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Grid</span>
              </>
            )}
            <ChevronDown className={`w-3 h-3 text-[#a39e94] transition-transform ${showMobileLayoutMenu ? "rotate-180" : ""}`} />
          </button>

          {showMobileLayoutMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMobileLayoutMenu(false)} />
              <div className="absolute top-10 left-1/2 -translate-x-1/2 w-48 bg-[#1a1814] border border-[#f3eee6]/15 rounded-xl shadow-2xl p-1.5 z-50 text-left backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 space-y-1">
                <button
                  onClick={() => {
                    switchToLayout("grid");
                    setShowMobileLayoutMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                    layoutMode === "grid" && !showWhiteboard
                      ? "bg-[#f59e0b] text-[#0e0d0b]"
                      : "text-[#f3eee6] hover:bg-[#221f1a]"
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Grid View
                </button>

                <button
                  onClick={() => {
                    switchToLayout("spotlight");
                    setShowMobileLayoutMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                    layoutMode === "spotlight" && !showWhiteboard
                      ? "bg-[#f59e0b] text-[#0e0d0b]"
                      : "text-[#f3eee6] hover:bg-[#221f1a]"
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  Spotlight View
                </button>

                {(isHost || showWhiteboard) && (
                  <button
                    onClick={() => {
                      switchToLayout("whiteboard");
                      setShowMobileLayoutMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      showWhiteboard || layoutMode === "whiteboard"
                        ? "bg-[#f59e0b] text-[#0e0d0b]"
                        : "text-[#f3eee6] hover:bg-[#221f1a]"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Whiteboard
                  </button>
                )}

                {isAnyoneScreenSharing && (
                  <button
                    onClick={() => {
                      switchToLayout("screenshare");
                      setShowMobileLayoutMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      layoutMode === "screenshare" && !showWhiteboard
                        ? "bg-[#f59e0b] text-[#0e0d0b]"
                        : "text-[#f3eee6] hover:bg-[#221f1a]"
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    Screen Share
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: Companion Tablet, YouTube Connect, Recording & Fullscreen */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Pair Tablet Companion button */}
          {isHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTabletModal(true)}
              className="hidden sm:inline-flex h-8 px-2.5 rounded-xl border-[#f3eee6]/10 bg-[#1a1814] hover:bg-[#221f1a] text-[#f3eee6] text-xs font-semibold gap-1.5"
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
              className="hidden sm:inline-flex h-8 px-2.5 rounded-xl border-[#f3eee6]/10 bg-[#1a1814] hover:bg-[#221f1a] text-[#f3eee6] text-xs font-semibold gap-1.5"
              title="Connect YouTube Channel & Stream Key"
            >
              <Youtube className="w-3.5 h-3.5 text-red-500" />
              <span className="hidden sm:inline">YouTube</span>
            </Button>
          )}

          {/* Recording & Live Stream trigger (Tutors only - B9) */}
          {isHost && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRecordingModalOpen(true)}
                className={`hidden sm:inline-flex h-8 px-2.5 rounded-xl text-xs font-bold gap-1.5 border transition ${
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
            </>
          )}

          {/* Mobile Focus Mode Toggle */}
          {isMobile && (
            <button
              onClick={() => setIsFocusMode(!isFocusMode)}
              className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold transition flex items-center gap-1 cursor-pointer ${
                isFocusMode
                  ? "bg-[#f59e0b] text-[#0e0d0b]"
                  : "bg-[#1a1814] text-[#f3eee6] border border-[#f3eee6]/15 hover:border-[#f59e0b]"
              }`}
              title={isFocusMode ? "Exit Focus Mode" : "Focus Mode (Full Canvas)"}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>{isFocusMode ? "Exit" : "Focus"}</span>
            </button>
          )}

          {/* Data Saver / Audio-Only Mode Toggle */}
          <button
            onClick={handleToggleAudioOnly}
            className={`h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
              isAudioOnlyMode
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm"
                : "bg-[#1a1814] text-[#a39e94] border-white/10 hover:text-[#f3eee6] hover:bg-[#221f1a]"
            }`}
            title={isAudioOnlyMode ? "Disable Data Saver (Resume Video)" : "Enable Data Saver (Audio Only, Saves Network)"}
          >
            <Zap className={`w-3.5 h-3.5 ${isAudioOnlyMode ? "text-amber-400" : "text-zinc-400"}`} />
            <span className="hidden md:inline">{isAudioOnlyMode ? "Data Saver ON" : "Data Saver"}</span>
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
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

        {/* Floating Google Meet Host Admission Prompt */}
        {isHost && pendingKnocks.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-[#1e1c18]/95 border border-[#f59e0b]/60 backdrop-blur-md rounded-2xl px-5 py-3.5 shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 ring-1 ring-[#f59e0b]/20">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-[#f59e0b]/20 border border-[#f59e0b]/40 flex items-center justify-center text-[#f59e0b] overflow-hidden">
                {pendingKnocks[0].avatar_url ? (
                  <img src={pendingKnocks[0].avatar_url} alt={pendingKnocks[0].display_name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-[#f59e0b]">
                    {(pendingKnocks[0].display_name || "P")[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#f59e0b] border-2 border-[#1e1c18] animate-pulse" />
            </div>

            <div className="flex flex-col min-w-0 max-w-[260px] sm:max-w-xs">
              <span className="text-xs sm:text-sm font-semibold text-white truncate">
                <span className="text-[#f59e0b] font-bold">{pendingKnocks[0].display_name}</span> wants to join this call
              </span>
              <span className="text-[11px] text-[#a39e94] truncate">
                {pendingKnocks.length > 1
                  ? `+${pendingKnocks.length - 1} more waiting to join`
                  : (pendingKnocks[0].email || "Guest participant")}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-1">
              {pendingKnocks.length > 1 ? (
                <>
                  <button
                    onClick={handleAdmitAllKnocks}
                    className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Admit all ({pendingKnocks.length})
                  </button>
                  <button
                    onClick={() => {
                      setIsSideDrawerOpen(true);
                      setActiveSideTab("participants");
                    }}
                    className="bg-zinc-800 hover:bg-zinc-700 text-[#d4cfc5] text-xs font-medium px-2.5 py-1.5 rounded-lg border border-white/10 transition cursor-pointer active:scale-95"
                  >
                    View
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleDenyKnock(pendingKnocks[0].id, pendingKnocks[0].display_name)}
                    className="bg-zinc-800 hover:bg-zinc-700 text-[#d4cfc5] text-xs font-medium px-2.5 py-1.5 rounded-lg border border-white/10 transition cursor-pointer active:scale-95 hover:text-red-400"
                  >
                    Deny entry
                  </button>
                  <button
                    onClick={() => handleAdmitKnock(pendingKnocks[0].id, pendingKnocks[0].display_name)}
                    className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold px-3.5 py-1.5 rounded-lg transition shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Admit
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <section className={`flex-1 min-w-0 h-full relative ${isFocusMode ? "p-0" : isMobileLandscapeSplit ? "p-1 sm:p-1.5" : isMobile ? "p-1" : "p-3"} flex flex-col justify-center items-center overflow-hidden`}>
          {isMobileLandscapeSplit ? (
            /* ── MOBILE HORIZONTAL 75% / 25% SPLIT PRESENTATION STAGE ── */
            <div className="w-full h-full flex flex-row gap-1.5 overflow-hidden relative select-none">
              {/* LEFT 75%: EXPANSIVE WHITEBOARD / SCREENSHARE CANVAS */}
              <div className={`h-full relative overflow-hidden rounded-xl border border-white/10 bg-[#0e0d0b] transition-all duration-300 ${
                isFocusMode ? "w-full" : "w-[75%]"
              }`}>
                {/* 1-Tap Mobile Fullscreen Trigger (Hides browser URL bar and status bar) */}
                {isMobile && !isFullscreen && !isFocusMode && (
                  <button
                    onClick={toggleFullscreen}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-amber-500/95 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 shadow-2xl shadow-amber-500/30 border border-amber-300/80 backdrop-blur-md cursor-pointer transition-transform active:scale-95 animate-pulse"
                    title="Enter Full Screen Mode (Hide Browser Address Bar)"
                  >
                    <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Tap for Full Screen</span>
                  </button>
                )}
                {showWhiteboard || layoutMode === "whiteboard" ? (
                  <Whiteboard
                    onClose={() => {
                      setShowWhiteboard(false);
                      setLayoutMode("grid");
                      if (isHost) {
                        engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
                        dbClient.setWhiteboardState(meetingCode, false);
                      }
                    }}
                    isHost={isHost || isPenDevice}
                    roomCode={meetingCode}
                    engine={engineRef.current}
                    myUserId={myUserId}
                    initialSnapshot={roomWhiteboardSnapshot || initialWhiteboardSnapshot || engineRef.current?.whiteboardSnapshot}
                    initialSlides={roomPresentationSlides}
                    initialSlideIndex={roomSlideIndex}
                    onStateChange={handleWhiteboardStateChange}
                    remoteSnapshot={remoteWhiteboardSnapshot}
                    letStudentsDraw={letStudentsDraw}
                    onToggleStudentDrawing={(allowed) => engineRef.current?.toggleWhiteboardDrawing(allowed)}
                    onBroadcast={(data) => engineRef.current?.broadcastWhiteboard(data)}
                    onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                    isFocusMode={isFocusMode}
                    isMobile={isMobile}
                    onToggleFullscreen={toggleFullscreen}
                    isFullscreen={isFullscreen}
                    hideTopBar={isMobileLandscapeSplit}
                    onRegisterActions={(actions) => {
                      whiteboardActionsRef.current = actions;
                    }}
                  />
                ) : (
                  <VideoTrackPlayer
                    track={activeScreenTrack}
                    audioTrack={localScreenTrack ? null : remoteScreenSharer?.screenAudioTrack}
                    objectFit="contain"
                    className="w-full h-full object-contain select-none"
                  />
                )}
              </div>

              {/* RIGHT 25%: DEDICATED SIDEBAR (CAMERA TILE, PARTICIPANT SWITCHER, WHITEBOARD TOOLS, CONTROLS / INLINE VIEWS) */}
              {!isFocusMode && (
                <aside className="w-[25%] min-w-[140px] max-w-[280px] h-full flex flex-col justify-between bg-[#121215]/95 backdrop-blur-md border border-white/10 rounded-xl p-1 sm:p-1.5 z-20 shadow-2xl overflow-hidden shrink-0 gap-1">
                  {/* 1. TOP VIDEO TILE: ACTIVE PARTICIPANT / TUTOR CAMERA */}
                  <div className="h-[38%] min-h-[85px] w-full rounded-lg overflow-hidden bg-zinc-900 border border-white/10 shadow-lg relative flex items-center justify-center shrink-0">
                    {mobilePipTrack ? (
                      <VideoTrackPlayer
                        track={mobilePipTrack}
                        mirror={isHost && mobileIsTutorSelected}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/95 text-zinc-400 gap-0.5 p-1">
                        <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs border border-amber-500/30">
                          {(mobilePipName || "T").charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[8px] text-zinc-400 font-medium">Camera Off</span>
                      </div>
                    )}

                    {/* Active Speaker Info Pill */}
                    <div className="absolute bottom-1 left-1 right-1 bg-black/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-bold text-white flex items-center justify-between">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${mobilePipTrack ? "bg-emerald-400" : "bg-zinc-500"}`} />
                        <span className="truncate">{mobilePipName}</span>
                      </div>
                      {mobileIsTutorSelected ? (
                        <span className="text-[7px] text-amber-400 font-mono">TUTOR</span>
                      ) : (
                        <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse shrink-0" />
                      )}
                    </div>
                  </div>

                  {/* 2. PARTICIPANT CAMERA SWITCHER ROW (100-STUDENT SCALED) */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0 py-0.5 w-full">
                    {/* Tutor Pill (Always Pinned First, Sticky) */}
                    <button
                      onClick={() => setSelectedCameraPeerId(null)}
                      className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold border transition shrink-0 flex items-center gap-1 cursor-pointer sticky left-0 z-10 ${
                        mobileIsTutorSelected
                          ? "bg-amber-500/25 text-amber-300 border-amber-400/60 shadow-sm"
                          : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-white/10"
                      }`}
                      title="Switch to Tutor Camera"
                    >
                      <span>👑 Tutor</span>
                    </button>

                    {/* Dynamic Active Broadcaster Pills (Students with Camera On) */}
                    {broadcasterStudents.slice(0, 2).map((p) => {
                      const isSel = selectedCameraPeerId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setSelectedCameraPeerId(p.id)}
                          className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-medium border transition shrink-0 flex items-center gap-0.5 cursor-pointer ${
                            isSel
                              ? "bg-emerald-500/25 text-emerald-300 border-emerald-400/60 font-bold"
                              : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-white/10"
                          }`}
                          title={`View ${p.name}'s Camera`}
                        >
                          <span className="truncate max-w-[48px]">{p.name.split(" ")[0]}</span>
                          <Video className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                        </button>
                      );
                    })}

                    {/* Custom Selected Peer (from directory) */}
                    {customSelectedPeer && (
                      <button
                        className="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold bg-amber-500/25 text-amber-300 border border-amber-400/60 shrink-0 flex items-center gap-0.5"
                      >
                        <span className="truncate max-w-[48px]">{customSelectedPeer.name.split(" ")[0]}</span>
                      </button>
                    )}

                    {/* Directory Button (Opens 100-student directory) */}
                    <button
                      onClick={() => setMobileSidebarTab(mobileSidebarTab === "participants" ? "controls" : "participants")}
                      className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-semibold border transition shrink-0 flex items-center gap-0.5 ml-auto cursor-pointer ${
                        mobileSidebarTab === "participants"
                          ? "bg-blue-500/25 text-blue-300 border-blue-400/60 font-bold"
                          : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-white/10"
                      }`}
                      title="Browse all participants"
                    >
                      <Users className="w-2.5 h-2.5 text-blue-400" />
                      <span>{allParticipants.length}</span>
                      <ChevronDown className="w-2.5 h-2.5 text-zinc-400" />
                    </button>
                  </div>

                  {/* 3. LOWER SECTION: INLINE CHAT, INLINE DIRECTORY, OR MAIN CONTROLS MENU */}
                  <div className="flex-1 min-h-0 w-full flex flex-col justify-between pt-0.5">
                    {mobileSidebarTab === "chat" ? (
                      /* ── INLINE COMPACT CHAT VIEW ── */
                      <div className="h-full w-full flex flex-col min-h-0 justify-between">
                        {/* Header: Back Button + Title */}
                        <div className="flex items-center justify-between pb-1 shrink-0 border-b border-white/10">
                          <button
                            onClick={() => setMobileSidebarTab("controls")}
                            className="flex items-center gap-0.5 text-[9px] font-bold text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                            title="Back to Controls Menu"
                          >
                            <ChevronLeft className="w-3 h-3" />
                            <span>Back</span>
                          </button>
                          <div className="flex items-center gap-1 text-[9px] font-semibold text-zinc-300">
                            <MessageSquare className="w-3 h-3 text-blue-400" />
                            <span>Chat</span>
                            <span className="text-zinc-500 text-[8px]">({chatMessages.length})</span>
                          </div>
                        </div>

                        {/* Message Feed (Capped to last 150 for 100-student room performance) */}
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 py-1 px-0.5 select-text">
                          {chatMessages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-2 text-zinc-500 text-[9px]">
                              <span>No messages yet.</span>
                              <span className="text-[8px] text-zinc-600">Ask a question below!</span>
                            </div>
                          ) : (
                            chatMessages.slice(-150).map((msg) => {
                              const isMe = msg.senderId === myUserId;
                              return (
                                <div
                                  key={msg.id || msg.clientMessageId}
                                  className={`flex flex-col text-[9px] leading-tight ${
                                    isMe ? "items-end" : "items-start"
                                  }`}
                                >
                                  <div className="flex items-center gap-1 text-[7px] text-zinc-400 mb-0.5 px-0.5">
                                    <span className={`font-semibold ${msg.isHost ? "text-amber-400" : isMe ? "text-emerald-400" : "text-zinc-300"}`}>
                                      {msg.senderName}
                                      {msg.isHost && " (Tutor)"}
                                    </span>
                                    <span>{msg.timestamp}</span>
                                  </div>
                                  <div
                                    className={`px-2 py-1 rounded-lg break-words max-w-[92%] ${
                                      isMe
                                        ? "bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-tr-none"
                                        : "bg-zinc-800 text-zinc-200 border border-white/10 rounded-tl-none"
                                    }`}
                                  >
                                    {msg.message}
                                  </div>
                                </div>
                              );
                            })
                          )}
                          <div ref={mobileChatBottomRef} />
                        </div>

                        {/* Input Row */}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!mobileChatText.trim()) return;
                            if (isChatLocked && !isHost) {
                              toast.error("Chat is locked by tutor");
                              return;
                            }
                            handleSendMessage(mobileChatText.trim());
                            setMobileChatText("");
                          }}
                          className="flex items-center gap-1 pt-1 shrink-0 border-t border-white/10"
                        >
                          <input
                            type="text"
                            value={mobileChatText}
                            onChange={(e) => setMobileChatText(e.target.value)}
                            disabled={isChatLocked && !isHost}
                            placeholder={isChatLocked && !isHost ? "Chat locked" : "Message..."}
                            className="flex-1 min-w-0 bg-zinc-900 border border-white/10 focus:border-amber-400 text-white placeholder-zinc-500 text-[9px] px-2 py-1 rounded-md focus:outline-none transition"
                          />
                          <button
                            type="submit"
                            disabled={!mobileChatText.trim() || (isChatLocked && !isHost)}
                            className="w-7 h-7 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-md flex items-center justify-center shrink-0 transition cursor-pointer"
                            title="Send Message"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                        </form>
                      </div>
                    ) : mobileSidebarTab === "participants" ? (
                      /* ── INLINE 100-STUDENT PARTICIPANT DIRECTORY VIEW ── */
                      <div className="h-full w-full flex flex-col min-h-0 justify-between">
                        {/* Header: Back + Title */}
                        <div className="flex items-center justify-between pb-1 shrink-0 border-b border-white/10">
                          <button
                            onClick={() => setMobileSidebarTab("controls")}
                            className="flex items-center gap-0.5 text-[9px] font-bold text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                            title="Back to Controls"
                          >
                            <ChevronLeft className="w-3 h-3" />
                            <span>Back</span>
                          </button>
                          <div className="flex items-center gap-1 text-[9px] font-semibold text-zinc-300">
                            <Users className="w-3 h-3 text-emerald-400" />
                            <span>Students ({allParticipants.length})</span>
                          </div>
                        </div>

                        {/* Search Input */}
                        <div className="relative py-1 shrink-0">
                          <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                          <input
                            type="text"
                            value={participantSearch}
                            onChange={(e) => setParticipantSearch(e.target.value)}
                            placeholder={`Search ${allParticipants.length} students...`}
                            className="w-full bg-zinc-900 border border-white/10 focus:border-amber-400 text-white placeholder-zinc-500 text-[8px] sm:text-[9px] pl-5 pr-5 py-1 rounded-md focus:outline-none transition"
                          />
                          {participantSearch && (
                            <button
                              onClick={() => setParticipantSearch("")}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex items-center gap-1 pb-1 shrink-0 text-[8px]">
                          <button
                            onClick={() => setParticipantFilter("all")}
                            className={`px-1.5 py-0.5 rounded-full border transition cursor-pointer ${
                              participantFilter === "all"
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                                : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200"
                            }`}
                          >
                            All ({allParticipants.length})
                          </button>
                          <button
                            onClick={() => setParticipantFilter("cameras")}
                            className={`px-1.5 py-0.5 rounded-full border transition cursor-pointer flex items-center gap-0.5 ${
                              participantFilter === "cameras"
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold"
                                : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200"
                            }`}
                          >
                            <span>Cameras ({allParticipants.filter((p) => p.videoTrack).length})</span>
                          </button>
                          <button
                            onClick={() => setParticipantFilter("hands")}
                            className={`px-1.5 py-0.5 rounded-full border transition cursor-pointer flex items-center gap-0.5 ${
                              participantFilter === "hands"
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                                : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200"
                            }`}
                          >
                            <span>Hands ({totalRaisedHands})</span>
                          </button>
                        </div>

                        {/* Scrollable Students List */}
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 py-0.5 px-0.5">
                          {filteredStudents.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-2 text-zinc-500 text-[8px]">
                              <span>No students found.</span>
                            </div>
                          ) : (
                            filteredStudents.map((p) => {
                              const isCurrent = (selectedCameraPeerId === p.id) || (!selectedCameraPeerId && p.id === tutorPeer?.id);
                              const isP = p.role === "host" || p.role === "tutor";
                              return (
                                <div
                                  key={p.id}
                                  onClick={() => {
                                    setSelectedCameraPeerId(p.id === tutorPeer?.id ? null : p.id);
                                    setMobileSidebarTab("controls");
                                    toast.info(`Viewing ${p.name}'s camera`, { id: "switch-cam" });
                                  }}
                                  className={`w-full flex items-center justify-between p-1 rounded-lg border transition cursor-pointer text-[9px] ${
                                    isCurrent
                                      ? "bg-amber-500/15 border-amber-500/40 text-amber-200 font-semibold"
                                      : "bg-zinc-900/80 hover:bg-zinc-800 border-white/5 text-zinc-300"
                                  }`}
                                  title="Tap to view camera in top box"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${
                                      isP ? "bg-amber-500/20 text-amber-300 border border-amber-400/30" : "bg-zinc-800 text-zinc-300"
                                    }`}>
                                      {isP ? "👑" : p.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <div className="flex items-center gap-1">
                                        <span className="truncate max-w-[70px]">{p.name}</span>
                                        {p.id === myUserId && <span className="text-[7px] text-zinc-500">(You)</span>}
                                        {isP && <span className="text-[7px] text-amber-400 font-mono">TUTOR</span>}
                                      </div>
                                      <span className="text-[7px] text-zinc-500">
                                        {p.videoTrack ? "Camera on" : "Audio only"}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {p.isHandRaised && <Hand className="w-2.5 h-2.5 text-amber-400" />}
                                    {p.videoTrack ? (
                                      <Video className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <VideoOff className="w-3 h-3 text-zinc-600" />
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : (
                      /* ── MAIN MENU: WHITEBOARD TOOLS, 2x2 CONTROLS & STATUS/LEAVE ── */
                      <>
                        {/* Whiteboard Quick Tools Row (Import for Tutor, Fit, Notes PDF, Fullscreen) - SHOWN ONLY IN MAIN MENU */}
                        <div className={`grid ${isHost ? "grid-cols-4" : "grid-cols-3"} gap-1 py-0.5 shrink-0`}>
                          {isHost && (
                            <button
                              onClick={() => whiteboardActionsRef.current?.importFile?.()}
                              title="Import PDF, PPTX or Image"
                              className="h-6 px-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-400/40 flex items-center justify-center gap-0.5 text-[8px] sm:text-[9px] font-semibold transition active:scale-95 cursor-pointer"
                            >
                              <FileUp className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                              <span className="truncate">Import</span>
                            </button>
                          )}
                          <button
                            onClick={() => whiteboardActionsRef.current?.zoomToFit()}
                            title="Fit Drawings to Screen"
                            className="h-6 px-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border border-white/10 flex items-center justify-center gap-1 text-[8px] sm:text-[9px] font-semibold transition active:scale-95 cursor-pointer"
                          >
                            <ZoomIn className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            <span>Fit</span>
                          </button>
                          <button
                            onClick={() => whiteboardActionsRef.current?.exportPdf()}
                            title="Download Classroom Notes as PDF"
                            className="h-6 px-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border border-white/10 flex items-center justify-center gap-1 text-[8px] sm:text-[9px] font-semibold transition active:scale-95 cursor-pointer"
                          >
                            <Download className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            <span className="truncate">{isHost ? "Notes" : "Notes PDF"}</span>
                          </button>
                          <button
                            onClick={toggleFullscreen}
                            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (Hide Browser Bar)"}
                            className={`h-6 px-1 rounded-md border flex items-center justify-center gap-1 text-[8px] sm:text-[9px] font-semibold transition active:scale-95 cursor-pointer ${
                              isFullscreen
                                ? "bg-amber-500/20 text-amber-300 border-amber-400/50"
                                : "bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 border-white/10"
                            }`}
                          >
                            {isFullscreen ? (
                              <Minimize2 className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            ) : (
                              <Maximize2 className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            )}
                            <span>{isFullscreen ? "Exit" : "Full"}</span>
                          </button>
                        </div>

                        {/* 2x2 Circular Buttons Grid */}
                        <div className="grid grid-cols-2 gap-1.5 my-auto justify-items-center py-1">
                          {/* Mic */}
                          <button
                            onClick={handleToggleMic}
                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                              isMicEnabled
                                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                                : unmuteRequestStatus === "requesting"
                                ? "bg-amber-500 text-white animate-pulse"
                                : hasSpeakingPermission
                                ? "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50"
                                : "bg-red-600 hover:bg-red-700 text-white"
                            }`}
                            title={isMicEnabled ? "Mute Microphone" : "Unmute Microphone"}
                          >
                            {isMicEnabled ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4 text-white" />}
                          </button>

                          {/* Camera */}
                          <button
                            onClick={handleCameraToggle}
                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                              isCamEnabled
                                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                                : "bg-red-600 hover:bg-red-700 text-white"
                            }`}
                            title={isCamEnabled ? "Turn off camera" : "Turn on camera"}
                          >
                            {isCamEnabled ? <Video className="w-4 h-4 text-emerald-400" /> : <VideoOff className="w-4 h-4 text-white" />}
                          </button>

                          {/* Raise Hand or Screen Share */}
                          {!isHost ? (
                            <button
                              onClick={handleToggleRaiseHand}
                              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                                isHandRaised
                                  ? "bg-amber-500 text-zinc-950 font-bold shadow-lg shadow-amber-500/30 animate-pulse border border-amber-300"
                                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                              }`}
                              title={isHandRaised ? "Lower Hand" : "Raise Hand"}
                            >
                              <Hand className={`w-4 h-4 ${isHandRaised ? "text-zinc-950" : "text-amber-400"}`} />
                            </button>
                          ) : (
                            <button
                              onClick={handleToggleScreenShare}
                              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                                isScreenSharing
                                  ? "bg-[#1a73e8] text-white border border-[#1a73e8]/30 shadow-lg"
                                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                              }`}
                              title={isScreenSharing ? "Stop sharing" : "Share screen"}
                            >
                              {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                            </button>
                          )}

                          {/* Chat */}
                          <button
                            onClick={() => {
                              setMobileSidebarTab("chat");
                              setUnreadChatCount(0);
                            }}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center border border-white/10 transition shadow-md relative cursor-pointer"
                            title="Class Chat"
                          >
                            <MessageSquare className="w-4 h-4 text-blue-400" />
                            {unreadChatCount > 0 && (
                              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.2 rounded-full border border-black animate-pulse">
                                {unreadChatCount}
                              </span>
                            )}
                          </button>
                        </div>

                        {/* Bottom Status & Leave Button Row */}
                        <div className="flex items-center justify-between gap-1 w-full pt-1 border-t border-white/10 shrink-0">
                          <div className="flex items-center gap-1 text-[8px] font-mono text-zinc-400">
                            <span className="truncate max-w-[60px] font-semibold">{meetingCode}</span>
                            <span>•</span>
                            <span className="text-emerald-400">{formatDuration(elapsedSeconds)}</span>
                          </div>
                          <button
                            onClick={handleLeaveMeeting}
                            className="h-6 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-[9px] sm:text-[10px] flex items-center gap-1 shadow-md shadow-red-600/30 transition cursor-pointer"
                          >
                            <LogOut className="w-2.5 h-2.5" />
                            <span>Leave</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </aside>
              )}
            </div>
          ) : layoutMode === "screenshare" && isAnyoneScreenSharing ? (
            <div className="w-full h-full relative">
              {/* Central Screen Presentation Canvas (Full Stage, Clean & Unobstructed) */}
              <div
                className="w-full h-full relative bg-[#0e0d0b] rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-2xl"
                onDoubleClick={() => setScreenZoom((z) => (z > 1 ? 1 : 2))}
              >
                <div
                  className="w-full h-full flex items-center justify-center transition-transform duration-200"
                  style={{
                    transform: screenZoom > 1 ? `scale(${screenZoom})` : "none",
                    transformOrigin: "center center",
                  }}
                >
                  <VideoTrackPlayer
                    track={activeScreenTrack}
                    audioTrack={localScreenTrack ? null : remoteScreenSharer?.screenAudioTrack}
                    objectFit="contain"
                    className="w-full h-full object-contain select-none"
                  />
                </div>

                {/* Top-Left Presenter Info Banner */}
                <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-[#0e0d0b]/85 backdrop-blur-md px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-white/15 text-xs text-[#f3eee6] flex items-center gap-2 shadow-lg z-20">
                  <Monitor className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span className="font-semibold text-[11px] text-[#f59e0b] truncate max-w-[150px] sm:max-w-none">
                    {localScreenTrack ? "You are presenting" : `${remoteScreenSharer?.name || "Tutor"} is presenting`}
                  </span>
                  {(localScreenAudioTrack || remoteScreenSharer?.screenAudioTrack) && (
                    <span className="flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded-md font-medium" title="Tab / System Audio is live">
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span>Tab Audio</span>
                    </span>
                  )}
                  {isHost && isScreenSharing && (
                    <button
                      onClick={handleToggleScreenShare}
                      className="ml-2 text-[10px] bg-red-600 hover:bg-red-700 text-white font-medium px-2 py-0.5 rounded-md transition cursor-pointer active:scale-95 shadow-sm"
                    >
                      Stop Sharing
                    </button>
                  )}
                  {isScreenSharing && !isPiPActive && (
                    <button
                      onClick={() => openPiP({ width: 340, height: 480 })}
                      title="Pop out floating mini-window (Always on top)"
                      className="flex items-center gap-1 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold px-2 py-0.5 rounded-md transition cursor-pointer active:scale-95 shadow-sm"
                    >
                      <ExternalLink className="w-3 h-3 text-[#f59e0b]" />
                      <span>Pop Out Mini-View</span>
                    </button>
                  )}
                </div>

                {/* Top-Right Focus Mode & Mobile Zoom Toggle */}
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex items-center gap-1.5 z-20">
                  {isMobile && (
                    <button
                      onClick={() => setScreenZoom((z) => (z > 1 ? 1 : 2))}
                      title={screenZoom > 1 ? "Reset Zoom (1x)" : "Zoom In (2x)"}
                      className="px-2.5 py-1 rounded-xl text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center gap-1.5 cursor-pointer transition bg-[#0e0d0b]/80 text-[#f3eee6] border-white/15 hover:bg-[#0e0d0b]"
                    >
                      <ZoomIn className="w-3.5 h-3.5 text-[#f59e0b]" />
                      <span className="font-mono text-[11px]">{screenZoom > 1 ? "1x Fit" : "2x Zoom"}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setIsFocusMode(!isFocusMode)}
                    title={isFocusMode ? "Exit Focus Mode" : "Focus on Presentation"}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold backdrop-blur-md border shadow-lg flex items-center gap-1.5 cursor-pointer transition ${
                      isFocusMode
                        ? "bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/40"
                        : "bg-[#0e0d0b]/80 text-[#f3eee6] border-white/15 hover:bg-[#0e0d0b]"
                    }`}
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[#f59e0b]" />
                    <span className="font-mono text-[11px]">{isFocusMode ? "Normal" : "Focus"}</span>
                  </button>
                </div>

                {/* 1-Tap Mobile Fullscreen / Widescreen Trigger (Rotates to landscape / full screen) */}
                {isMobile && !isFullscreen && !isFocusMode && (
                  <button
                    onClick={toggleFullscreen}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-amber-500/95 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 shadow-2xl shadow-amber-500/30 border border-amber-300/80 backdrop-blur-md cursor-pointer transition-transform active:scale-95 animate-pulse"
                    title="Enter Full Screen Mode (Hide Browser Address Bar & Maximize Screen Share)"
                  >
                    <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Tap for Widescreen</span>
                  </button>
                )}
              </div>
            </div>
          ) : showWhiteboard || layoutMode === "whiteboard" ? (
            /* COLLABORATIVE WHITEBOARD MODE WITH TLDraw & GEOMETRY TOOLS */
            <div className={`w-full h-full relative flex flex-col ${
              isFocusMode
                ? "rounded-none border-0"
                : isMobile
                ? "rounded-2xl border-2 border-zinc-700/80 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/15"
                : "rounded-2xl border border-white/15 shadow-2xl"
            } overflow-hidden`}>
              {/* 1-Tap Mobile Fullscreen Trigger (Hides browser URL bar and status bar) */}
              {isMobile && !isFullscreen && !isFocusMode && (
                <button
                  onClick={toggleFullscreen}
                  className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-amber-500/95 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] sm:text-xs flex items-center gap-1.5 shadow-2xl shadow-amber-500/30 border border-amber-300/80 backdrop-blur-md cursor-pointer transition-transform active:scale-95 animate-pulse"
                  title="Enter Full Screen Mode (Hide Browser Address Bar)"
                >
                  <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Tap for Full Screen</span>
                </button>
              )}
              <Whiteboard
                onClose={() => {
                  setShowWhiteboard(false);
                  setLayoutMode("grid");
                  if (isHost) {
                    engineRef.current?.broadcastWhiteboardState(meetingCode, false, true);
                    dbClient.setWhiteboardState(meetingCode, false);
                  }
                }}
                isHost={isHost || isPenDevice}
                roomCode={meetingCode}
                engine={engineRef.current}
                myUserId={myUserId}
                initialSnapshot={roomWhiteboardSnapshot || initialWhiteboardSnapshot || engineRef.current?.whiteboardSnapshot}
                initialSlides={roomPresentationSlides}
                initialSlideIndex={roomSlideIndex}
                onStateChange={handleWhiteboardStateChange}
                remoteSnapshot={remoteWhiteboardSnapshot}
                letStudentsDraw={letStudentsDraw}
                onToggleStudentDrawing={(allowed) => engineRef.current?.toggleWhiteboardDrawing(allowed)}
                onBroadcast={(data) => engineRef.current?.broadcastWhiteboard(data)}
                onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                isFocusMode={isFocusMode}
                isMobile={isMobile}
                onToggleFullscreen={toggleFullscreen}
                isFullscreen={isFullscreen}
              />
              {/* Floating PIP Camera (Relocated on mobile to top-right to prevent canvas collision, with 1-tap minimize) */}
              {(() => {
                // Determine target participant for this floating box:
                // - If isHost (Tutor): Tutor sees their own camera preview ("Host (You)")
                // - If student (!isHost): Student MUST ONLY see the Tutor's camera in this box!
                const tutorPeer = allParticipants.find((p) => (p.role === "host" || p.role === "tutor") && p.id !== myUserId)
                  || remoteParticipants.find((p) => p.role === "host" || p.role === "tutor")
                  || remoteParticipants.find((p) => p.id !== myUserId);

                const pipTrack = isHost
                  ? (isCamEnabled ? localVideoTrack : null)
                  : (tutorPeer?.videoTrack || null);

                const pipName = isHost
                  ? "Host (You)"
                  : tutorPeer
                  ? (tutorPeer.name ? `${tutorPeer.name} (Tutor)` : "Tutor")
                  : "Tutor";

                // If in focus mode, hide PiP
                if (isFocusMode) return null;
                // If isHost and tutor has camera turned off, hide box so canvas isn't blocked
                if (isHost && !pipTrack) return null;
                // If student is viewing and no remote tutor/peer is present yet, hide box
                if (!isHost && !tutorPeer) return null;

                if (isPipMinimized) {
                  return (
                    <button
                      onClick={() => setIsPipMinimized(false)}
                      title="Expand Video"
                      className="absolute bottom-20 right-3 md:bottom-4 md:right-4 z-30 p-2 rounded-full bg-zinc-900/95 border border-white/20 text-white shadow-2xl hover:bg-zinc-800 transition flex items-center gap-1 cursor-pointer pointer-events-auto"
                    >
                      <Video className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px] font-bold text-zinc-300 pr-0.5">Video</span>
                    </button>
                  );
                }

                return (
                  <div className="absolute bottom-20 right-3 w-20 sm:w-28 md:bottom-4 md:right-4 md:w-44 aspect-video rounded-xl overflow-hidden border border-white/20 bg-zinc-900 shadow-2xl z-30 pointer-events-auto group">
                    {pipTrack ? (
                      <VideoTrackPlayer
                        track={pipTrack}
                        mirror={isHost}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/95 text-zinc-400 gap-0.5 p-1">
                        <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-[10px] sm:text-xs border border-amber-500/30">
                          {(pipName || "T").charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[7px] sm:text-[9px] text-zinc-400 font-medium truncate max-w-[90%]">
                          Camera Off
                        </span>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsPipMinimized(true);
                      }}
                      title="Minimize Video"
                      className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/90 text-white/80 hover:text-white rounded transition cursor-pointer"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold text-white flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${pipTrack ? "bg-emerald-400" : "bg-zinc-500"}`} />
                      <span className="truncate max-w-[70px] sm:max-w-[100px]">{pipName}</span>
                    </div>
                  </div>
                );
              })()}
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
                      avatarUrl={featured.id === myUserId ? profile?.avatarUrl : (featured as any).avatarUrl}
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
                      onLowerHand={() => isHost && handleLowerStudentHand(featured.id)}
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
                        avatarUrl={p.id === myUserId ? profile?.avatarUrl : (p as any).avatarUrl}
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
                        onLowerHand={() => isHost && handleLowerStudentHand(p.id)}
                        onForceMute={() => handleForceMuteStudent(p.id, p.name)}
                        onExpel={() => handleExpelStudent(p.id, p.name)}
                        isCameraPermitted={videoAllowedPeers.has(p.id)}
                        onToggleCamera={() => handleToggleStudentCamera(p.id, !videoAllowedPeers.has(p.id))}
                        className="w-48 md:w-full aspect-video shrink-0"
                      />
                    ))}
                </div>
              )}
            </div>
          ) : (
            /* DYNAMIC RESPONSIVE GRID (GOOGLE MEET STYLE - CAPPED TO 6 TILES MAX) */
            <div className="w-full h-full flex flex-col min-h-0">
              <div
                className={`w-full flex-1 min-h-0 grid gap-3 ${
                  visibleGridParticipants.length === 1
                    ? "grid-cols-1"
                    : visibleGridParticipants.length === 2
                    ? "grid-cols-1 sm:grid-cols-2"
                    : visibleGridParticipants.length <= 4
                    ? "grid-cols-2 grid-rows-2"
                    : "grid-cols-2 md:grid-cols-3 grid-rows-2"
                }`}
              >
                {visibleGridParticipants.map((p) => (
                  <VideoTile
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    avatarUrl={p.id === myUserId ? profile?.avatarUrl : (p as any).avatarUrl}
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
                    onLowerHand={() => isHost && handleLowerStudentHand(p.id)}
                    onForceMute={() => handleForceMuteStudent(p.id, p.name)}
                    onExpel={() => handleExpelStudent(p.id, p.name)}
                    isCameraPermitted={videoAllowedPeers.has(p.id)}
                    onToggleCamera={() => handleToggleStudentCamera(p.id, !videoAllowedPeers.has(p.id))}
                    className="w-full h-full"
                  />
                ))}
              </div>

              {/* Grid Pagination Controls for classrooms with > 6 students */}
              {allParticipants.length > TILES_PER_PAGE && (
                <div className="flex items-center justify-center gap-3 pt-2 shrink-0 z-20">
                  <button
                    onClick={() => setGridPage((prev) => Math.max(0, prev - 1))}
                    disabled={gridPage <= 0}
                    className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none text-xs text-white font-medium flex items-center gap-1 transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev</span>
                  </button>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    Page {gridPage + 1} of {totalGridPages} ({allParticipants.length} students)
                  </span>
                  <button
                    onClick={() => setGridPage((prev) => Math.min(totalGridPages - 1, prev + 1))}
                    disabled={gridPage >= totalGridPages - 1}
                    className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none text-xs text-white font-medium flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
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
          onLowerHand={(uid) => isHost && handleLowerStudentHand(uid)}
          onLowerAllHands={handleLowerAllHands}
          onForceMuteStudent={handleForceMuteStudent}
          onMuteAllStudents={handleMuteAll}
          onExpelStudent={handleExpelStudent}
          unmuteRequests={unmuteRequests}
          onApproveMic={handleApproveMic}
          onDenyMic={handleDenyMic}
          pendingKnocks={pendingKnocks}
          onAdmitKnock={handleAdmitKnock}
          onDenyKnock={handleDenyKnock}
          onAdmitAllKnocks={handleAdmitAllKnocks}
          videoAllowedPeers={videoAllowedPeers}
          onToggleCameraPermission={handleToggleStudentCamera}
        />
      </main>

      {/* ── BOTTOM GOOGLE MEET CONTROLS BAR ── */}
      <footer
        className={`h-16 sm:h-20 shrink-0 bg-[#18191c] border-t border-white/10 flex items-center justify-between px-3 sm:px-6 md:px-8 z-30 select-none pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] ${
          isFocusMode ? "mathsy-focus-mode-dock hidden" : ""
        } ${isMobileLandscapeSplit ? "hidden" : ""}`}
      >
        {/* Desktop / Tablet Controls Bar (>= 768px) */}
        <div className="hidden md:flex items-center justify-between w-full">
          {/* Left Side: Mic, Camera, Raise Hand, Screen Share */}
          <div className="flex items-center gap-2.5">
            {/* Mic Button with speaking request support */}
            <button
              onClick={handleToggleMic}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
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
              className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
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
                className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
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
                className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                  isScreenSharing
                    ? "bg-[#1a73e8] text-white border border-[#1a73e8]/30 shadow-lg shadow-[#1a73e8]/25"
                    : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                }`}
                title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              >
                {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
              </button>
            )}

            {/* Pop Out Mini-View Button (When screen sharing & PiP window was closed) */}
            {isHost && isScreenSharing && !isPiPActive && (
              <button
                onClick={() => openPiP({ width: 340, height: 480 })}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition shadow-md cursor-pointer active:scale-95"
                title="Pop out floating mini-window (Always on top)"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Mini-View</span>
              </button>
            )}
          </div>

          {/* Center: Reactions */}
          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <button
                onClick={() => setShowReactionPicker(!showReactionPicker)}
                className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center border border-white/10 transition shadow-md cursor-pointer"
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
                className="h-10 px-3.5 rounded-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs gap-1.5 shadow-lg shadow-amber-500/25 border border-amber-400/50 animate-pulse cursor-pointer"
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
              className={`h-11 px-4 rounded-full font-bold text-xs border transition relative gap-2 cursor-pointer ${
                isSideDrawerOpen
                  ? "bg-[#1a73e8] text-white border-[#1a73e8]/30"
                  : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Class Feed</span>
              {unreadChatCount > 0 ? (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-md animate-pulse">
                  {unreadChatCount}
                </span>
              ) : isHost && pendingKnocks.length > 0 ? (
                <span className="absolute -top-1 -right-1 flex px-1.5 h-5 items-center justify-center rounded-full bg-[#f59e0b] text-[10px] font-black text-[#0e0d0b] shadow-md animate-pulse">
                  +{pendingKnocks.length}
                </span>
              ) : null}
            </Button>

            {/* Leave / End Class Button */}
            {isHost ? (
              <Button
                variant="destructive"
                onClick={handleEndClassClick}
                className="h-11 px-5 rounded-full font-bold text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Class</span>
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleLeaveMeeting}
                className="h-11 px-5 rounded-full font-bold text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Leave Room</span>
              </Button>
            )}
          </div>
        </div>

        {/* Mobile Google Meet Controls Bar (< 768px) */}
        <div className="flex md:hidden items-center justify-between w-full max-w-md mx-auto gap-1">
          {/* 1. Mic Button */}
          <button
            onClick={handleToggleMic}
            className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
              isMicEnabled
                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                : unmuteRequestStatus === "requesting"
                ? "bg-amber-500 text-white animate-pulse"
                : hasSpeakingPermission
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
            title="Microphone"
          >
            {isMicEnabled ? (
              <Mic className="w-4 h-4" />
            ) : unmuteRequestStatus === "requesting" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MicOff className="w-4 h-4" />
            )}
          </button>

          {/* 2. Camera Button */}
          <button
            onClick={handleCameraToggle}
            className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
              isCamEnabled
                ? "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
                : "bg-red-600 hover:bg-red-700 text-white"
            }`}
            title="Camera"
          >
            {isCamEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          {/* 3. Student: Raise Hand / Tutor: Screen Share */}
          {!isHost ? (
            <button
              onClick={handleToggleRaiseHand}
              className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                isHandRaised
                  ? "bg-amber-500 text-zinc-950 font-bold shadow-lg shadow-amber-500/30 animate-pulse border border-amber-300"
                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
              }`}
              title={isHandRaised ? "Lower Hand" : "Raise Hand"}
            >
              <Hand className={`w-4 h-4 ${isHandRaised ? "text-zinc-950" : "text-amber-400"}`} />
            </button>
          ) : (
            <button
              onClick={handleToggleScreenShare}
              className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                isScreenSharing
                  ? "bg-[#1a73e8] text-white border border-[#1a73e8]/30 shadow-lg shadow-[#1a73e8]/25"
                  : "bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10"
              }`}
              title={isScreenSharing ? "Stop sharing" : "Share screen"}
            >
              {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>
          )}

          {/* 4. Class Feed Button */}
          <button
            onClick={() => {
              setIsSideDrawerOpen(!isSideDrawerOpen);
              if (!isSideDrawerOpen) setIsInfoDrawerOpen(false);
              setUnreadChatCount(0);
            }}
            className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center border transition relative cursor-pointer ${
              isSideDrawerOpen
                ? "bg-[#1a73e8] text-white border-[#1a73e8]/30"
                : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
            }`}
            title="Class Chat & Polls"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadChatCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow-md animate-pulse">
                {unreadChatCount}
              </span>
            ) : isHost && pendingKnocks.length > 0 ? (
              <span className="absolute -top-1 -right-1 flex px-1 h-4 items-center justify-center rounded-full bg-[#f59e0b] text-[9px] font-black text-[#0e0d0b] shadow-md animate-pulse">
                +{pendingKnocks.length}
              </span>
            ) : null}
          </button>

          {/* 5. Mobile "More" Menu Button */}
          <button
            onClick={() => setShowMobileMoreSheet(true)}
            className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center border transition cursor-pointer ${
              showMobileMoreSheet
                ? "bg-[#f59e0b] text-[#0e0d0b] border-[#f59e0b]"
                : "bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700"
            }`}
            title="More Options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* 6. End Call / Leave Room Button */}
          {isHost ? (
            <button
              onClick={handleEndClassClick}
              className="h-10 min-h-[40px] px-3.5 rounded-full font-bold text-xs gap-1 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25 flex items-center justify-center cursor-pointer"
              title="End Class"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>End</span>
            </button>
          ) : (
            <button
              onClick={handleLeaveMeeting}
              className="h-10 min-h-[40px] px-3.5 rounded-full font-bold text-xs gap-1 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/25 flex items-center justify-center cursor-pointer"
              title="Leave Room"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
          )}
        </div>
      </footer>

      {/* ── MOBILE "MORE" ACTION SHEET ── */}
      {showMobileMoreSheet && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowMobileMoreSheet(false)}
          />
          <div className="fixed bottom-0 inset-x-0 z-[70] bg-[#1a1814] border-t border-[#f3eee6]/15 rounded-t-3xl p-5 shadow-2xl animate-in slide-in-from-bottom duration-200 space-y-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] max-h-[85vh] overflow-y-auto font-sans">
            <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto" />

            {/* Quick Reactions Bar */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#a39e94]">
                Send Reaction
              </span>
              <div className="flex items-center justify-around bg-[#0e0d0b] p-2 rounded-2xl border border-white/10">
                {["❤️", "👍", "👏", "💡", "😂", "🎉", "🔥"].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      handleSendReaction(emoji);
                      setShowMobileMoreSheet(false);
                    }}
                    className="text-2xl hover:scale-125 active:scale-95 transition cursor-pointer p-1"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions Grid */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  setShowMobileMoreSheet(false);
                  setIsInfoDrawerOpen(true);
                  setIsSideDrawerOpen(false);
                }}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-[#f3eee6] cursor-pointer"
              >
                <Info className="w-4 h-4 text-[#f59e0b]" />
                <span>Meeting Details</span>
              </button>

              <button
                onClick={() => {
                  toggleFullscreen();
                  setShowMobileMoreSheet(false);
                }}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-[#f3eee6] cursor-pointer"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4 text-[#f59e0b]" /> : <Maximize2 className="w-4 h-4 text-[#f59e0b]" />}
                <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
              </button>

              {isHost && (
                <>
                  <button
                    onClick={() => {
                      setShowMobileMoreSheet(false);
                      setShowTabletModal(true);
                    }}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-[#f3eee6] cursor-pointer"
                  >
                    <Tablet className="w-4 h-4 text-[#f59e0b]" />
                    <span>Pair Tablet</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMobileMoreSheet(false);
                      setIsRecordingModalOpen(true);
                    }}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-[#f3eee6] cursor-pointer"
                  >
                    <Disc className="w-4 h-4 text-red-400" />
                    <span>Record / Live</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMobileMoreSheet(false);
                      handleMuteAll();
                    }}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-rose-300 cursor-pointer"
                  >
                    <MicOff className="w-4 h-4" />
                    <span>Mute All</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMobileMoreSheet(false);
                      handleLowerAllHands();
                    }}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-[#221f1a] hover:bg-[#2a2620] border border-[#f3eee6]/10 text-left text-xs font-semibold text-amber-300 cursor-pointer"
                  >
                    <Hand className="w-4 h-4" />
                    <span>Lower All Hands</span>
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setShowMobileMoreSheet(false)}
              className="w-full py-3 bg-[#221f1a] hover:bg-[#2a2620] text-[#a39e94] hover:text-[#f3eee6] rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </>
      )}

      {/* ── MODALS & DIALOGS ── */}

      {/* Tablet Companion Pairing Modal */}
      <TabletPairingModal
        open={showTabletModal}
        onOpenChange={setShowTabletModal}
        tabletCode={tabletCode}
        classId={meetingCode}
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
        onRequestCameraOff={handleRequestCameraOff}
        onCancel={handleLeaveMeeting}
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
          handleLeaveMeeting();
        }}
      />

      {/* Tutor Camera-Off Request Prompt */}
      {pendingCameraOffRequest && isHost && (
        <div className="fixed bottom-24 right-6 z-50 bg-[#1a1814] border border-[#f59e0b]/40 rounded-2xl p-4 shadow-2xl max-w-sm animate-in slide-in-from-bottom">
          <div className="flex items-center gap-2 mb-2 text-[#f59e0b] font-semibold text-sm">
            <VideoOff className="w-4 h-4" /> Camera-Off Request
          </div>
          <p className="text-xs text-zinc-300 mb-3">
            <strong className="text-white">{pendingCameraOffRequest.studentName || "A student"}</strong> is requesting to join class with camera turned OFF.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleRespondCameraOff(pendingCameraOffRequest.studentId, true)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-xl"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRespondCameraOff(pendingCameraOffRequest.studentId, false)}
              className="flex-1 border-white/20 bg-white/5 hover:bg-white/10 text-white text-xs rounded-xl"
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Expelled Overlay (Blocks Rejoin) */}
      {isExpelled && (
        <div className="fixed inset-0 z-[100000] bg-black/95 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 mb-4">
            <LogOut className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Removed from Classroom</h2>
          <p className="text-sm text-gray-400 max-w-md mb-6">
            {expelledReason || "You were removed from this room by the tutor and cannot rejoin this session."}
          </p>
          <Button
            onClick={handleLeaveMeeting}
            className="bg-white/10 hover:bg-white/20 text-white rounded-xl px-6 py-2.5 text-xs font-semibold"
          >
            Exit to Home
          </Button>
        </div>
      )}

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
          handleLeaveMeeting();
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
        isLiveConnecting={isLiveConnecting}
        liveStreamSeconds={youtubeLiveSeconds}
        liveStreamUrl={youtubeLiveUrl}
        streamStats={streamStats}
        onSessionWatchUrlChange={(url) => setYoutubeLiveUrl(url)}
        onStartYouTubeLive={handleStartYouTubeLive}
        onStopYouTubeLive={handleStopYouTubeLive}
      />

      {/* YouTube Channel Settings Modal */}
      <YouTubeConnectModal
        open={showYouTubeConnectModal}
        onOpenChange={setShowYouTubeConnectModal}
      />

      {/* Floating Always-on-Top Mini-Meet Overlay (Document Picture-in-Picture Portal) */}
      {pipWindow && (
        <FloatingMeetOverlay
          pipWindow={pipWindow}
          remoteParticipants={remoteParticipants}
          localVideoTrack={localVideoTrack}
          localAudioTrack={localAudioTrack}
          isAudioMuted={!isMicEnabled}
          isVideoMuted={!isCamEnabled}
          activeSpeakerId={remoteParticipants.find((p) => !p.isAudioMuted && Boolean(p.audioTrack))?.id || null}
          myUserId={myUserId}
          myName={myName}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
          onToggleMute={handleToggleMic}
          onToggleVideo={handleCameraToggle}
          onStopScreenShare={handleToggleScreenShare}
          onClosePiP={closePiP}
        />
      )}
    </div>
  );
};
