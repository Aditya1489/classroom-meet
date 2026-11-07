import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Copy,
  Monitor,
  UserCheck,
  Shield,
  GraduationCap,
  BookOpen,
  Sparkles,
  Check,
  RefreshCw,
  Play,
  Clock,
  Lock,
  Loader2,
  DoorClosed,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";
import { AuthRoleModal } from "../auth/AuthRoleModal";
import { SignOutConfirmModal } from "../auth/SignOutConfirmModal";
import { dbClient, API_BASE } from "../../lib/dbClient";
import { getRoomRole } from "../../services/roomService";
import { isMobileDevice, enterMobileFullscreenAndLandscape } from "../../lib/mobileFullscreen";

interface LobbyViewProps {
  meetingCode: string;
  isHostFromLanding?: boolean;
  initialRole?: "tutor" | "student";
  onJoinMeeting: (options: {
    micMuted: boolean;
    camOff: boolean;
    displayName: string;
    presentImmediately: boolean;
    role: "tutor" | "student";
    isHost?: boolean;
  }) => void;
  onBackToHome: () => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  meetingCode,
  isHostFromLanding = false,
  initialRole = "tutor",
  onJoinMeeting,
  onBackToHome,
}) => {
  const {
    user,
    profile,
    session,
    loading,
    isAuthenticated,
    joinAsGuest,
    signInWithGoogle,
    signUpWithGoogle,
    updateRole,
    signOut,
    needsOnboardingRole,
    dismissOnboardingRole,
    isAuthenticating,
  } = useAuth();
  const ssoSessionRaw = typeof window !== "undefined" ? sessionStorage.getItem(`mathsy_sso_session_${meetingCode}`) : null;
  let ssoSessionUser: any = null;
  try {
    ssoSessionUser = ssoSessionRaw ? JSON.parse(ssoSessionRaw)?.user : null;
  } catch (e) {
    ssoSessionUser = null;
  }
  const isSsoRoom = Boolean(ssoSessionUser);

  const [displayName, setDisplayName] = useState(profile?.name || ssoSessionUser?.name || "");
  const [copiedLink, setCopiedLink] = useState(false);
  const [roomChecking, setRoomChecking] = useState(true);
  const [roomExists, setRoomExists] = useState<boolean | null>(null);
  const [roomRecord, setRoomRecord] = useState<any>(null);
  const [isReactivating, setIsReactivating] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isRoomHost, setIsRoomHost] = useState<boolean>(() => {
    const fromSession = typeof window !== "undefined" && sessionStorage.getItem(`mathsy_host_${meetingCode}`) === "true";
    return Boolean(isHostFromLanding && fromSession);
  });
  const [isAskingToJoin, setIsAskingToJoin] = useState(false);
  const [activeKnockId, setActiveKnockId] = useState<string | null>(null);
  const [knockStatus, setKnockStatus] = useState<"waiting_for_host" | "pending" | "admitted" | "denied" | null>(null);
  const [isSubmittingKnock, setIsSubmittingKnock] = useState(false);
  const [admissionError, setAdmissionError] = useState<string | null>(null);

  const isDemoRoom = meetingCode.startsWith("demo-") || Boolean(sessionStorage.getItem(`demo_token_${meetingCode}`));

  const isStudentAccount = profile?.role === "student" || ssoSessionUser?.role === "student";
  const isTutorOnly = isRoomHost;
  const [selectedRole, setSelectedRole] = useState<"tutor" | "student">(
    isStudentAccount || !isRoomHost ? "student" : "tutor"
  );
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showRoleSwitchModal, setShowRoleSwitchModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  // Preserve join_room intent and return URL for seamless post-login re-entry
  const handleLobbyGoogleSignIn = (role?: "tutor" | "student") => {
    const action = {
      type: "join_room" as const,
      roomId: meetingCode,
      returnUrl: `/meet/${meetingCode}`,
    };
    if (role) {
      signUpWithGoogle(role, action);
    } else {
      signInWithGoogle(action);
    }
  };

  // Check room existence with backend
  useEffect(() => {
    if (!meetingCode) {
      setRoomExists(false);
      setRoomChecking(false);
      return;
    }
    if (isDemoRoom) {
      setRoomExists(true);
      setRoomChecking(false);
      return;
    }
    dbClient.getRoom(meetingCode).then((r) => {
      setRoomRecord(r);
      // Only mark room as inactive if it has explicitly ended
      if (r && r.is_active === false && r.ended_at) {
        setRoomExists(false);
      } else {
        setRoomExists(true);
      }
      setRoomChecking(false);
      if (r && profile?.id && (r.tutor_id === profile.id || (r.metadata?.tutor_id && r.metadata.tutor_id === profile.id))) {
        setIsOwner(true);
      }
    }).catch(() => {
      setRoomExists(true);
      setRoomChecking(false);
    });
  }, [meetingCode, isDemoRoom, profile?.id]);

  // Periodic background check while room is not active yet (auto-knocks once tutor launches)
  useEffect(() => {
    if (!meetingCode || isDemoRoom) return;
    if (roomRecord && roomRecord.is_active) return;

    const interval = setInterval(async () => {
      try {
        const r = await dbClient.getRoom(meetingCode);
        if (r && r.is_active) {
          setRoomRecord(r);
          setRoomExists(true);
          toast.success("Class has started! Joining lobby...");

          // If student was waiting for tutor, automatically submit admission knock!
          if (knockStatus === "waiting_for_host" || isAskingToJoin) {
            const fallbackPrefix = selectedRole === "tutor" ? "Tutor" : "Student";
            const finalName = displayName.trim() || profile?.name || `${fallbackPrefix} ${Math.floor(100 + Math.random() * 900)}`;
            dbClient.submitKnock(meetingCode, {
              display_name: finalName,
              email: profile?.email || undefined,
              avatar_url: profile?.avatarUrl || undefined,
              role: selectedRole,
            }).then((knockRes) => {
              if (knockRes.status === "admitted" || knockRes.status === "host") {
                setKnockStatus("admitted");
                toast.success("Host admitted you! Entering classroom now...");
                setTimeout(() => {
                  handleJoinDirect(selectedRole, false);
                }, 400);
              } else if (knockRes.knock?.id) {
                setActiveKnockId(knockRes.knock.id);
                setKnockStatus("pending");
              }
            });
          }
        }
      } catch {
        // Silently retry on next tick
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [meetingCode, isDemoRoom, roomRecord?.is_active, knockStatus, isAskingToJoin, selectedRole, displayName, profile]);

  // Students join muted by default to honor speaking permission policy
  const [isMicMuted, setIsMicMuted] = useState(() => {
    const isHostRole = isHostFromLanding || initialRole === "tutor";
    return !isHostRole;
  });
  const [isCamOff, setIsCamOff] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Authoritatively check whether the current user is the Room Host
  useEffect(() => {
    if (!meetingCode || isDemoRoom) return;
    const checkRole = async () => {
      try {
        const token =
          session?.access_token ||
          sessionStorage.getItem(`mathsy_token_${meetingCode}`) ||
          sessionStorage.getItem("mathsy_meet_embed_token") ||
          localStorage.getItem("mathsy_meet_token");
        const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(meetingCode)}/role`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.isOwner) {
            setIsRoomHost(true);
            setIsOwner(true);
            setSelectedRole("tutor");
            sessionStorage.setItem(`mathsy_host_${meetingCode}`, "true");
          } else {
            setIsRoomHost(false);
            setIsOwner(false);
            setSelectedRole("student");
            sessionStorage.removeItem(`mathsy_host_${meetingCode}`);
          }
        }
      } catch (err) {
        console.warn("[Lobby] Failed to check room role:", err);
      }
    };
    checkRole();
  }, [meetingCode, isDemoRoom, profile?.id, session?.access_token]);

  const handleAskToJoin = async () => {
    const fallbackPrefix = selectedRole === "tutor" ? "Tutor" : "Student";
    const finalName = displayName.trim() || profile?.name || `${fallbackPrefix} ${Math.floor(100 + Math.random() * 900)}`;

    setIsSubmittingKnock(true);
    setAdmissionError(null);

    try {
      // If room is known to not be active yet, keep student waiting gracefully in lobby
      if (roomRecord && !roomRecord.is_active) {
        setKnockStatus("waiting_for_host");
        setIsAskingToJoin(true);
        toast.info("Class hasn't started yet. Waiting for tutor to start...");
        return;
      }

      const res = await dbClient.submitKnock(meetingCode, {
        display_name: finalName,
        email: profile?.email || undefined,
        avatar_url: profile?.avatarUrl || undefined,
        role: selectedRole,
      });

      if (res.status === "host" || res.status === "admitted") {
        toast.success("Admission confirmed! Joining classroom...");
        handleJoinDirect(selectedRole, false);
        return;
      }

      if (res.status === "waiting_for_host" || (res as any).isWaitingForHost) {
        setKnockStatus("waiting_for_host");
        setIsAskingToJoin(true);
        toast.info("Class hasn't started yet. Waiting for tutor to start...");
        return;
      }

      if (res.error) {
        // If room is inactive, keep waiting instead of kicking out
        if (res.code === "ROOM_NOT_ACTIVE" || res.error.toLowerCase().includes("not active")) {
          setKnockStatus("waiting_for_host");
          setIsAskingToJoin(true);
          toast.info("Class hasn't started yet. Waiting for tutor to start...");
          return;
        }
        setAdmissionError(res.error);
        setKnockStatus("denied");
        setIsAskingToJoin(true);
        toast.error(res.error);
        return;
      }

      if (res.knock?.id) {
        setActiveKnockId(res.knock.id);
        setKnockStatus("pending");
        setIsAskingToJoin(true);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to submit admission request");
    } finally {
      setIsSubmittingKnock(false);
    }
  };

  const handleCancelKnock = async () => {
    if (activeKnockId) {
      await dbClient.cancelKnock(meetingCode, activeKnockId);
    }
    setIsAskingToJoin(false);
    setActiveKnockId(null);
    setKnockStatus(null);
  };

  // Poll knock status while waiting for host admission (Google Meet style)
  useEffect(() => {
    if (!isAskingToJoin || !activeKnockId || knockStatus !== "pending") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await dbClient.getKnockStatus(meetingCode, activeKnockId);
        if (!res) return;

        if (res.status === "admitted") {
          clearInterval(pollInterval);
          setKnockStatus("admitted");
          toast.success("Host admitted you! Entering classroom now...");
          setTimeout(() => {
            handleJoinDirect(selectedRole, false);
          }, 400);
        } else if (res.status === "denied") {
          clearInterval(pollInterval);
          setKnockStatus("denied");
          setAdmissionError("The meeting host declined your request to join this class session.");
          toast.error("The meeting host declined your request to join.");
        }
      } catch (e) {
        // Continue polling silently
      }
    }, 1200);

    return () => clearInterval(pollInterval);
  }, [isAskingToJoin, activeKnockId, knockStatus, meetingCode, selectedRole]);

  // Initialize display name from profile if available
  useEffect(() => {
    if (profile?.name && !displayName) {
      setDisplayName(profile.name);
    }
  }, [profile]);

  // Request camera and microphone for lobby preview
  useEffect(() => {
    let localStream: MediaStream | null = null;

    async function initMedia() {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setStream(localStream);

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
        }

        // Setup audio level meter
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(localStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const checkAudio = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.round(avg * 1.5)));
          animFrameRef.current = requestAnimationFrame(checkAudio);
        };
        checkAudio();
      } catch (err: any) {
        console.warn("[Lobby] Media access notice:", err.message);
      }
    }

    initMedia();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const toggleMic = () => {
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = isMicMuted;
      });
    }
    setIsMicMuted(!isMicMuted);
  };

  const toggleCam = () => {
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = isCamOff;
      });
    }
    setIsCamOff(!isCamOff);
  };

  const handleJoinDirect = (role: "tutor" | "student", present = false) => {
    const fallbackPrefix = role === "tutor" ? "Tutor" : "Student";
    const finalName = displayName.trim() || profile?.name || `${fallbackPrefix} ${Math.floor(100 + Math.random() * 900)}`;

    if (!profile) {
      sessionStorage.setItem("mathsy_meet_guest_name", finalName);
    }

    // Stop lobby preview tracks before transferring to in-call engine
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    // Non-hosts always enter as student/attendee with isHost: false
    const finalRole: "tutor" | "student" = isRoomHost ? "tutor" : "student";

    // When student joins on mobile devices, trigger full screen mode and landscape orientation
    if (!isRoomHost && isMobileDevice()) {
      enterMobileFullscreenAndLandscape().catch(() => {});
    }

    onJoinMeeting({
      micMuted: isMicMuted,
      camOff: isCamOff,
      displayName: finalName,
      presentImmediately: present,
      role: finalRole,
      isHost: isRoomHost,
    });
  };

  const handleJoinWithRole = (role: "tutor" | "student", present = false) => {
    // If not room host and not demo, require host admission via knocking
    if (!isRoomHost && !isDemoRoom && knockStatus !== "admitted") {
      handleAskToJoin();
      return;
    }
    handleJoinDirect(isRoomHost ? "tutor" : "student", present);
  };

  const copyMeetingLink = () => {
    const url = `${window.location.origin}/meet/${meetingCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleStartOrReopenRoom = async () => {
    if (!isAuthenticated) {
      toast.error("Please sign in as a tutor to start this class.");
      setShowSignUpModal(true);
      return;
    }

    if (profile?.role !== "tutor") {
      try {
        await updateRole("tutor");
        setSelectedRole("tutor");
      } catch (e) {
        toast.error("You need tutor privileges to start a class. Please switch to tutor role.");
        return;
      }
    }

    setIsReactivating(true);
    try {
      let activeRoom: any = null;
      if (roomRecord && !roomRecord.is_active) {
        activeRoom = await dbClient.reactivateRoom(meetingCode);
      }
      if (!activeRoom) {
        activeRoom = await dbClient.upsertRoom({
          room_code: meetingCode,
          title: roomRecord?.title || `Class ${meetingCode}`,
          is_active: true,
        });
      }

      if (activeRoom) {
        setRoomRecord(activeRoom);
        setRoomExists(true);
        setIsOwner(true);
        toast.success("Class started successfully! Setting up your session...");
      } else {
        toast.error("Failed to start class. Please verify your tutor credentials.");
      }
    } catch (err: any) {
      toast.error("Error starting class: " + (err.message || "Unknown error"));
    } finally {
      setIsReactivating(false);
    }
  };

  const handleManualRefresh = async () => {
    setRoomChecking(true);
    try {
      const r = await dbClient.getRoom(meetingCode);
      setRoomRecord(r);
      const active = Boolean(r && r.is_active);
      setRoomExists(active);
      if (active) {
        toast.success("Class is live! Welcome.");
      } else {
        toast.info("Class has not started yet. Waiting for tutor...");
      }
    } catch {
      toast.error("Could not check class status.");
    } finally {
      setRoomChecking(false);
    }
  };

  if (!roomChecking && roomExists === false) {
    const isTutorUser = Boolean(isRoomHost || isHostFromLanding);

    return (
      <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden bg-[#0e0d0b] text-[#f3eee6] flex flex-col justify-between selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
        {/* Top Header */}
        <header className="flex items-center justify-between px-3 sm:px-6 md:px-12 py-3 sm:py-4 border-b border-[#f3eee6]/[0.08] bg-[#0e0d0b]/85 backdrop-blur-md">
          <div className="flex items-center gap-2 sm:gap-3 cursor-pointer shrink-0" onClick={onBackToHome}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md shrink-0">
              <Video className="w-4 h-4 text-white" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight text-[#f3eee6]">
              Mathsy<span className="text-[#f59e0b]">Meet</span>
            </span>
          </div>

          {/* User Status / Google Sign-in */}
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <div className="flex items-center gap-2 sm:gap-2.5 bg-[#1a1814] border border-[#f3eee6]/10 px-2.5 sm:px-3 py-1.5 rounded-full text-xs">
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile?.name || "User"}
                    className="w-5 h-5 rounded-full object-cover border border-[#f59e0b]/40 shadow-sm"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-[10px]">
                    {profile?.name?.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-[#f3eee6] hidden sm:inline text-xs">{profile?.name}</span>
                <button
                  onClick={() => setShowRoleSwitchModal(true)}
                  title="Click to switch role"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] font-mono uppercase font-semibold hover:bg-[#f59e0b]/30 transition cursor-pointer"
                >
                  {profile?.role === "student" ? "Student" : "Tutor"}
                </button>
                <button
                  onClick={() => setShowSignOutModal(true)}
                  className="text-[11px] text-[#a39e94] hover:text-[#f3eee6] transition ml-1 cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => handleLobbyGoogleSignIn()}
                  title="Sign in directly"
                  className="flex items-center gap-1.5 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Sign in</span>
                </button>
                <button
                  onClick={() => setShowSignUpModal(true)}
                  className="hidden sm:inline-flex px-3.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition cursor-pointer"
                >
                  Sign up
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Center Dynamic Content */}
        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-xl mx-auto w-full">
          {isTutorUser ? (
            /* TUTOR VIEW: Ready to start / Reopen */
            <div className="w-full flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] flex items-center justify-center mb-6 shadow-2xl">
                <Play className="w-8 h-8 fill-current" />
              </div>
              <div className="section-label mb-2 text-[#f59e0b] tracking-widest font-mono text-xs">
                {roomRecord ? "CLASS SESSION ENDED" : "CLASS READY TO START"}
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-[#f3eee6] mb-3">
                {roomRecord ? "Reopen Class Session" : "Start Class as Tutor"}
              </h1>
              <p className="text-sm text-[#a39e94] max-w-md mb-8 leading-relaxed">
                {roomRecord ? (
                  <>The classroom for <code className="text-[#f59e0b] px-2 py-0.5 bg-[#1a1814] rounded font-mono">{meetingCode}</code> was closed. As the tutor, you can reopen it now for your students.</>
                ) : (
                  <>Room code <code className="text-[#f59e0b] px-2 py-0.5 bg-[#1a1814] rounded font-mono">{meetingCode}</code> is assigned to you. Launch the classroom now so students can join.</>
                )}
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
                <button
                  onClick={handleStartOrReopenRoom}
                  disabled={isReactivating}
                  className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:brightness-110 text-[#0e0d0b] font-bold text-sm transition shadow-lg shadow-[#f59e0b]/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isReactivating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting Class...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>{roomRecord ? "Reopen Class" : "Start Class Now"}</span>
                    </>
                  )}
                </button>
                <button
                  onClick={onBackToHome}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 text-[#f3eee6] font-medium text-sm transition cursor-pointer"
                >
                  Return to Home
                </button>
              </div>
            </div>
          ) : isAuthenticated ? (
            /* STUDENT VIEW: Waiting for Tutor */
            <div className="w-full flex flex-col items-center">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shadow-2xl">
                  <Clock className="w-8 h-8" />
                </div>
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
                </span>
              </div>

              <div className="section-label mb-2 text-cyan-400 tracking-widest font-mono text-xs">
                WAITING ROOM
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-[#f3eee6] mb-3">
                Waiting for Tutor to Start
              </h1>
              <p className="text-sm text-[#a39e94] max-w-md mb-6 leading-relaxed">
                The tutor hasn't started class <code className="text-cyan-400 px-2 py-0.5 bg-[#1a1814] rounded font-mono">{meetingCode}</code> yet. Please wait here — you will enter automatically when the tutor begins.
              </p>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1814] border border-[#f3eee6]/10 text-xs text-[#a39e94] mb-8 font-mono">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                Listening for tutor broadcast...
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
                <button
                  onClick={handleManualRefresh}
                  disabled={roomChecking}
                  className="w-full py-3.5 px-6 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm transition shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${roomChecking ? "animate-spin" : ""}`} />
                  <span>Check Status</span>
                </button>
                <button
                  onClick={onBackToHome}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 text-[#f3eee6] font-medium text-sm transition cursor-pointer"
                >
                  Return to Home
                </button>
              </div>

              <div className="mt-8 text-xs text-[#716c61]">
                Are you the tutor?{" "}
                <button
                  onClick={() => {
                    updateRole("tutor");
                    setSelectedRole("tutor");
                  }}
                  className="text-[#f59e0b] hover:underline font-medium cursor-pointer"
                >
                  Switch to Tutor Mode
                </button>
              </div>
            </div>
          ) : (
            /* UNAUTHENTICATED VIEW */
            <div className="w-full flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mb-6 shadow-2xl">
                <Lock className="w-8 h-8" />
              </div>

              <div className="section-label mb-2 text-amber-400 tracking-widest font-mono text-xs">
                CLASS NOT STARTED
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-[#f3eee6] mb-3">
                Class Has Not Started
              </h1>
              <p className="text-sm text-[#a39e94] max-w-md mb-8 leading-relaxed">
                Class <code className="text-[#f59e0b] px-2 py-0.5 bg-[#1a1814] rounded font-mono">{meetingCode}</code> is waiting to begin. Sign in as a tutor to launch it, or sign in as a student to wait.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
                <button
                  onClick={() => handleLobbyGoogleSignIn()}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-sm transition shadow-lg shadow-[#f59e0b]/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Sign In with Google</span>
                </button>
                <button
                  onClick={onBackToHome}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 text-[#f3eee6] font-medium text-sm transition cursor-pointer"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center py-4 text-xs text-[#716c61] border-t border-[#f3eee6]/[0.05]">
          Mathsy Meet Secure Live Classroom &copy; {new Date().getFullYear()}
        </footer>

        {/* Modals */}
        <AuthRoleModal
          isOpen={showSignUpModal}
          onClose={() => setShowSignUpModal(false)}
          isLoggedIn={false}
          title="Sign In to Join Class"
          subtitle={`Please sign in with Google to enter or start class ${meetingCode}.`}
          defaultRole="student"
          onDirectSignIn={() => {
            setShowSignUpModal(false);
            handleLobbyGoogleSignIn();
          }}
          onContinueWithGoogle={(role) => {
            setShowSignUpModal(false);
            handleLobbyGoogleSignIn(role);
          }}
        />
        <AuthRoleModal
          isOpen={showRoleSwitchModal}
          onClose={() => setShowRoleSwitchModal(false)}
          isLoggedIn={true}
          defaultRole={profile?.role || selectedRole}
          onUpdateRole={async (newRole) => {
            setShowRoleSwitchModal(false);
            await updateRole(newRole);
            setSelectedRole(newRole);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden bg-[#0e0d0b] text-[#f3eee6] flex flex-col justify-between selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
      {/* Top Header */}
      <header className="flex items-center justify-between px-3 sm:px-6 md:px-12 py-3 sm:py-4 border-b border-[#f3eee6]/[0.08] bg-[#0e0d0b]/85 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer shrink-0" onClick={onBackToHome}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md shrink-0">
            <Video className="w-4 h-4 text-white" />
          </div>
          <span className="text-base sm:text-lg font-bold tracking-tight text-[#f3eee6]">
            Mathsy<span className="text-[#f59e0b]">Meet</span>
          </span>
        </div>

        {/* User Status / Google Sign-in */}
        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <div className="flex items-center gap-2 sm:gap-2.5 bg-[#1a1814] border border-[#f3eee6]/10 px-2.5 sm:px-3 py-1.5 rounded-full text-xs">
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile?.name || "User"}
                  className="w-5 h-5 rounded-full object-cover border border-[#f59e0b]/40 shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-[10px]">
                  {profile?.name?.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-[#f3eee6] hidden sm:inline text-xs">{profile?.name}</span>
              <button
                onClick={() => setShowRoleSwitchModal(true)}
                title="Click to switch role"
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] font-mono uppercase font-semibold hover:bg-[#f59e0b]/30 transition cursor-pointer"
              >
                {profile?.role === "student" ? "Student" : "Tutor"}
              </button>
              <button
                onClick={() => setShowSignOutModal(true)}
                className="text-[11px] text-[#a39e94] hover:text-[#f3eee6] transition ml-1 cursor-pointer"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => handleLobbyGoogleSignIn()}
                title="Sign in directly"
                className="flex items-center gap-1.5 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Sign in</span>
              </button>
              <button
                onClick={() => setShowSignUpModal(true)}
                className="hidden sm:inline-flex px-3.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition cursor-pointer"
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Lobby Section */}
      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center p-4 sm:p-6 md:p-12 gap-6 md:gap-14 max-w-6xl mx-auto w-full ambient-glow pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        {/* Left: Camera Preview Window in Techiitfly Bezel Style */}
        <div className="w-full max-w-lg flex flex-col items-center">
          <div className="relative w-full aspect-video bg-[#1a1814] rounded-2xl overflow-hidden border border-[#f3eee6]/10 shadow-2xl flex items-center justify-center">
            {/* Live Camera Stream */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                !isCamOff ? "opacity-100" : "opacity-0 absolute pointer-events-none"
              }`}
            />

            {/* Avatar Fallback */}
            {isCamOff && (
              <div className="flex flex-col items-center gap-3">
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={displayName || "User"}
                    className="w-20 h-20 rounded-full object-cover shadow-2xl border-2 border-[#f59e0b]/40"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center text-3xl font-bold shadow-xl border border-white/20">
                    {displayName.charAt(0).toUpperCase() || (selectedRole === "tutor" ? "T" : "S")}
                  </div>
                )}
                <span className="text-xs font-medium text-[#a39e94]">Camera is off</span>
              </div>
            )}

            {/* In-Preview Mic Level Meter */}
            <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-[#0e0d0b]/80 backdrop-blur-md px-3 py-1 rounded-full border border-[#f3eee6]/10 text-xs">
              <div className="flex items-center gap-1 h-3">
                <span
                  className="w-1 bg-[#f59e0b] rounded-full transition-all duration-75"
                  style={{ height: isMicMuted ? "3px" : `${Math.max(3, audioLevel * 0.25)}px` }}
                />
                <span
                  className="w-1 bg-[#f59e0b] rounded-full transition-all duration-75"
                  style={{ height: isMicMuted ? "3px" : `${Math.max(3, audioLevel * 0.45)}px` }}
                />
                <span
                  className="w-1 bg-[#f59e0b] rounded-full transition-all duration-75"
                  style={{ height: isMicMuted ? "3px" : `${Math.max(3, audioLevel * 0.3)}px` }}
                />
              </div>
              <span className="text-xs font-mono text-[#f3eee6]">
                {isMicMuted ? "Muted" : audioLevel > 10 ? "Speaking" : "Ready"}
              </span>
            </div>

            {/* Role Badge in Preview */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-[#0e0d0b]/80 backdrop-blur-md px-3 py-1 rounded-full border border-[#f3eee6]/10 text-xs">
              {selectedRole === "tutor" ? (
                <>
                  <GraduationCap className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span className="text-[#f59e0b] font-semibold text-xs font-mono">Tutor (Host)</span>
                </>
              ) : (
                <>
                  <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold text-xs font-mono">Student</span>
                </>
              )}
            </div>

            {/* Bottom Controls Pill */}
            <div className="absolute bottom-4 flex items-center gap-3 bg-[#0e0d0b]/85 backdrop-blur-md p-1.5 rounded-full border border-[#f3eee6]/15">
              <button
                onClick={toggleMic}
                className={`p-2.5 rounded-full transition ${
                  isMicMuted
                    ? "bg-[#dc2626] text-white"
                    : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6]"
                }`}
                title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <button
                onClick={toggleCam}
                className={`p-2.5 rounded-full transition ${
                  isCamOff
                    ? "bg-[#dc2626] text-white"
                    : "bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6]"
                }`}
                title={isCamOff ? "Turn on camera" : "Turn off camera"}
              >
                {isCamOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Join Action Panel */}
        <div className="w-full max-w-md flex flex-col items-center lg:items-start text-center lg:text-left space-y-5">
          {isAskingToJoin ? (
            <div className="w-full bg-[#161513] border border-[#f3eee6]/15 rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6 shadow-2xl relative overflow-hidden">
              {knockStatus === "denied" ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                    <DoorClosed className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#f3eee6] mb-2">Request Declined by Host</h2>
                    <p className="text-xs text-[#a39e94] max-w-xs leading-relaxed">
                      {admissionError || "The meeting host declined your request to join this class session."}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5 w-full">
                    <button
                      onClick={() => {
                        setIsAskingToJoin(false);
                        setKnockStatus(null);
                        setActiveKnockId(null);
                        setAdmissionError(null);
                      }}
                      className="flex-1 py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-xl text-xs font-bold transition cursor-pointer shadow-lg shadow-[#f59e0b]/20"
                    >
                      Ask to join again
                    </button>
                    <button
                      onClick={() => {
                        setIsAskingToJoin(false);
                        setKnockStatus(null);
                        onBackToHome();
                      }}
                      className="flex-1 py-3 bg-[#1a1814] hover:bg-[#25221d] border border-[#f3eee6]/15 text-[#f3eee6] rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      Return to home screen
                    </button>
                  </div>
                </>
              ) : knockStatus === "waiting_for_host" ? (
                <>
                  <div className="relative my-2">
                    {/* Animated radar rings in cyan/amber */}
                    <div className="absolute -inset-4 rounded-full bg-cyan-500/20 animate-ping opacity-75" />
                    <div className="absolute -inset-8 rounded-full bg-cyan-500/10 animate-pulse" />
                    <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-cyan-500 shadow-xl shadow-cyan-500/20 bg-[#25221d] flex items-center justify-center">
                      {profile?.avatarUrl ? (
                        <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <Clock className="w-10 h-10 text-cyan-400" />
                      )}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-serif text-[#f3eee6] mb-1.5 font-normal">Waiting for host to start the class...</h2>
                    <p className="text-xs text-[#a39e94] max-w-xs leading-relaxed">
                      The class will start as soon as the tutor joins. You'll enter automatically.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1a1814] border border-cyan-500/30 text-xs text-cyan-400 font-medium shadow-inner">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      Waiting for tutor (Host)
                    </div>
                  </div>

                  <button
                    onClick={handleCancelKnock}
                    className="w-full py-2.5 bg-[#1a1814] hover:bg-[#25221d] border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f3eee6] rounded-xl text-xs font-medium transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="relative my-2">
                    {/* Animated radar rings */}
                    <div className="absolute -inset-4 rounded-full bg-[#f59e0b]/20 animate-ping opacity-75" />
                    <div className="absolute -inset-8 rounded-full bg-[#f59e0b]/10 animate-pulse" />
                    <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-[#f59e0b] shadow-xl shadow-[#f59e0b]/30 bg-[#25221d] flex items-center justify-center">
                      {profile?.avatarUrl ? (
                        <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl font-bold text-[#f59e0b]">
                          {(displayName || profile?.name || "P")[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-serif text-[#f3eee6] mb-1.5 font-normal">Asking to join...</h2>
                    <p className="text-xs text-[#a39e94] max-w-xs leading-relaxed">
                      You'll join the call when the host lets you in.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1a1814] border border-[#f59e0b]/30 text-xs text-[#f59e0b] font-medium shadow-inner">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f59e0b]" />
                      Waiting for meeting host
                    </div>
                  </div>

                  <button
                    onClick={handleCancelKnock}
                    className="w-full py-2.5 bg-[#1a1814] hover:bg-[#25221d] border border-[#f3eee6]/15 hover:border-red-500/40 text-[#a39e94] hover:text-red-400 rounded-xl text-xs font-medium transition cursor-pointer"
                  >
                    Cancel request
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div>
                <span className="section-label mb-2">
                  {isDemoRoom ? "🌟 DEMO ROOM (30 MIN LIMIT)" : "LOBBY CHECK-IN"}
                </span>
                <h1 className="font-serif text-3xl md:text-4xl font-normal text-[#f3eee6] mb-1">
                  Ready to enter class?
                </h1>
                <p className="text-xs text-[#a39e94]">
                  Meeting code: <span className="font-mono text-[#f59e0b] font-semibold">{meetingCode}</span>
                </p>
              </div>

              {/* Role Selection Cards */}
              <div className="w-full space-y-2 text-left">
                <label className="text-[11px] font-mono font-semibold text-[#a39e94] block uppercase tracking-wider">
                  {isStudentAccount || isTutorOnly ? "Your Meeting Role" : "Select Your Role"}
                </label>

                {isStudentAccount ? (
                  <div className="p-4 rounded-xl border bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/10 flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-emerald-500 text-[#0e0d0b] shrink-0 mt-0.5">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
                          Student / Learner
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono font-bold uppercase tracking-wider">
                            Learner Active
                          </span>
                        </h3>
                        <Check className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xs text-[#a39e94] leading-relaxed mt-1">
                        Entering this classroom as a student with live math whiteboard viewing, hand raising, quizzes & real-time chat.
                      </p>
                    </div>
                  </div>
                ) : isTutorOnly ? (
                  <div className="p-4 rounded-xl border bg-[#f59e0b]/10 border-[#f59e0b] shadow-lg shadow-[#f59e0b]/15 flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-[#f59e0b] text-[#0e0d0b] shrink-0 mt-0.5">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
                          Tutor / Teacher (Host)
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f59e0b] text-[#0e0d0b] font-mono font-bold uppercase tracking-wider">
                            Host Controls Active
                          </span>
                        </h3>
                        <Check className="w-4 h-4 text-[#f59e0b]" />
                      </div>
                      <p className="text-xs text-[#a39e94] leading-relaxed mt-1">
                        Hosting this classroom with interactive STEM whiteboard, geometric tools (ruler & compass), and live participant moderation.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1a1814] border border-[#f3eee6]/10 p-3.5 rounded-xl flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 mt-0.5">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-[#f3eee6] flex items-center gap-1.5">
                          <span>Participant / Student</span>
                          <span className="text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-500/30">
                            Attendee
                          </span>
                        </h3>
                        <Check className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xs text-[#a39e94] leading-relaxed mt-1">
                        Joining live classroom with real-time STEM whiteboard, raise hand, live polls, and interactive audio/video.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Name Input */}
              <div className="w-full space-y-1.5 text-left">
                <label className="text-xs font-medium text-[#a39e94]">Your Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={selectedRole === "tutor" ? "e.g. Prof. Sharma / Tutor" : "e.g. Rahul / Student"}
                  className="w-full bg-[#1a1814] border border-[#f3eee6]/15 rounded-lg px-4 py-3 text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none focus:border-[#f59e0b] transition"
                />
              </div>

              {/* Explicit Join Action Buttons */}
              <div className="w-full space-y-2.5 pt-1">
                {isRoomHost ? (
                  <>
                    <button
                      onClick={async () => {
                        if (roomRecord && !roomRecord.is_active) {
                          try {
                            await dbClient.reactivateRoom(meetingCode);
                          } catch (e) {
                            console.warn("Could not reactivate room:", e);
                          }
                        }
                        handleJoinDirect("tutor", false);
                      }}
                      className="w-full py-3.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {roomRecord && !roomRecord.is_active ? (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          Start Class as Host
                        </>
                      ) : (
                        <>
                          <GraduationCap className="w-4 h-4" />
                          Join as Tutor (Host Meeting)
                        </>
                      )}
                    </button>

                    <button
                      onClick={async () => {
                        if (roomRecord && !roomRecord.is_active) {
                          try {
                            await dbClient.reactivateRoom(meetingCode);
                          } catch (e) {
                            console.warn("Could not reactivate room:", e);
                          }
                        }
                        handleJoinDirect("tutor", true);
                      }}
                      className="w-full py-2.5 bg-transparent hover:bg-[#1a1814] border border-[#f3eee6]/15 text-[#f3eee6] rounded-lg font-medium text-xs transition flex items-center justify-center gap-2"
                    >
                      <Monitor className="w-3.5 h-3.5 text-[#f59e0b]" />
                      Present Screen as Tutor
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleAskToJoin}
                    disabled={isSubmittingKnock}
                    className="w-full py-3.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                  >
                    {isSubmittingKnock ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Asking to join...
                      </>
                    ) : roomRecord && !roomRecord.is_active ? (
                      <>
                        <Clock className="w-4 h-4" />
                        Ask to join (Wait for host)
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Ask to join
                      </>
                    )}
                  </button>
                )}

                {!isAuthenticated && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleLobbyGoogleSignIn()}
                      className="text-xs text-[#a39e94] hover:text-[#f3eee6] transition inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Sign in with Google (optional)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Quick link copying */}
              <div className="w-full pt-3 border-t border-[#f3eee6]/10 flex items-center justify-between text-xs text-[#a39e94]">
                <span>Invite link</span>
                <button
                  onClick={copyMeetingLink}
                  className="text-[#f59e0b] hover:underline flex items-center gap-1 font-mono text-[11px]"
                >
                  {copiedLink ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Copied!
                    </span>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy link
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-[11px] font-mono text-[#a39e94] border-t border-[#f3eee6]/[0.06]">
        Mathsy Meet • Dedicated for Tutors and Students with STEM Geometry Whiteboard
      </footer>

      {/* Sign Up Modal: for new users choosing role once */}
      <AuthRoleModal
        isOpen={showSignUpModal}
        onClose={() => setShowSignUpModal(false)}
        title={!isAuthenticated ? "Sign in to Join Class" : undefined}
        subtitle={
          !isAuthenticated
            ? `The tutor requires all participants to be signed in with Google to enter meeting ${meetingCode}.`
            : undefined
        }
        defaultRole="student"
        onDirectSignIn={() => {
          setShowSignUpModal(false);
          handleLobbyGoogleSignIn();
        }}
        onContinueWithGoogle={(role) => {
          setShowSignUpModal(false);
          handleLobbyGoogleSignIn(role);
        }}
      />

      {/* Role Switch Modal: for logged-in user changing active role */}
      <AuthRoleModal
        isOpen={showRoleSwitchModal}
        onClose={() => setShowRoleSwitchModal(false)}
        isLoggedIn={true}
        defaultRole={profile?.role || selectedRole}
        onUpdateRole={async (newRole) => {
          setShowRoleSwitchModal(false);
          await updateRole(newRole);
          setSelectedRole(newRole);
        }}
      />

      {/* Visual Authenticating Indicator */}
      {isAuthenticating && !needsOnboardingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-[#1a1814] border border-[#f3eee6]/15 shadow-2xl text-center max-w-xs w-full">
            <div className="w-9 h-9 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#f3eee6]">Connecting Google Account...</h3>
              <p className="text-xs text-[#a39e94]">Setting up your Mathsy Meet session</p>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal: if new user used direct Sign In without role */}
      <AuthRoleModal
        isOpen={needsOnboardingRole}
        isOnboarding={true}
        onClose={() => dismissOnboardingRole()}
        defaultRole="student"
        onUpdateRole={async (newRole) => {
          await updateRole(newRole);
          setSelectedRole(newRole);
        }}
      />

      {/* Sign Out Confirmation Modal */}
      <SignOutConfirmModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={async () => {
          await signOut();
          setShowSignOutModal(false);
        }}
        userName={profile?.name}
        userRole={profile?.role || selectedRole}
        avatarUrl={profile?.avatarUrl}
      />
    </div>
  );
};
