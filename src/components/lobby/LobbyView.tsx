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
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";
import { AuthRoleModal } from "../auth/AuthRoleModal";
import { dbClient } from "../../lib/dbClient";
import { getRoomRole } from "../../services/roomService";

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
    needsOnboardingRole,
    dismissOnboardingRole,
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
  const isDemoRoom = meetingCode.startsWith("demo-") || Boolean(sessionStorage.getItem(`demo_token_${meetingCode}`));

  const isStudentAccount = profile?.role === "student" || ssoSessionUser?.role === "student";
  const isTutorOnly = !isStudentAccount && (isHostFromLanding || profile?.role === "tutor" || ssoSessionUser?.role === "tutor");
  const [selectedRole, setSelectedRole] = useState<"tutor" | "student">(
    isStudentAccount ? "student" : isTutorOnly ? "tutor" : (ssoSessionUser?.role as any) || initialRole || "student"
  );
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showRoleSwitchModal, setShowRoleSwitchModal] = useState(false);

  // Auto-prompt sign up / sign in modal when entering lobby unauthenticated (unless demo room or SSO)
  useEffect(() => {
    if (!loading && !isAuthenticated && !isDemoRoom && !isSsoRoom) {
      setShowSignUpModal(true);
    }
  }, [loading, isAuthenticated, isDemoRoom, isSsoRoom]);

  useEffect(() => {
    if (isStudentAccount) {
      setSelectedRole("student");
      setIsMicMuted(true);
    } else if (isTutorOnly) {
      setSelectedRole("tutor");
    } else if (profile?.role) {
      setSelectedRole(profile.role);
      if (profile.role === "student") {
        setIsMicMuted(true);
      }
    }
  }, [isStudentAccount, isTutorOnly, profile?.role]);

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
      setRoomExists(Boolean(r && r.is_active));
      setRoomChecking(false);
      if (r && profile?.id && (r.tutor_id === profile.id || profile.role === "tutor")) {
        setIsOwner(true);
      }
    }).catch(() => {
      setRoomChecking(false);
    });
  }, [meetingCode, isDemoRoom, profile?.id]);

  // Periodic background check if room hasn't started yet (auto-enters student once tutor launches)
  useEffect(() => {
    if (roomExists !== false || !meetingCode || isDemoRoom) return;

    const interval = setInterval(async () => {
      try {
        const r = await dbClient.getRoom(meetingCode);
        if (r && r.is_active) {
          setRoomRecord(r);
          setRoomExists(true);
          if (profile?.id && (r.tutor_id === profile.id || profile.role === "tutor")) {
            setIsOwner(true);
          }
          toast.success("Class has started! Preparing your classroom lobby...");
        }
      } catch {
        // Silently retry on next tick
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [roomExists, meetingCode, isDemoRoom, profile?.id]);

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

  const handleJoinWithRole = (role: "tutor" | "student", present = false) => {
    if (!isAuthenticated && !isDemoRoom) {
      toast.error("Please sign in or create an account with Google to enter this class.");
      localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
      setShowSignUpModal(true);
      return;
    }

    const fallbackPrefix = role === "tutor" ? "Tutor" : "Student";
    const finalName = displayName.trim() || profile?.name || `${fallbackPrefix} ${Math.floor(100 + Math.random() * 900)}`;

    if (!profile && isDemoRoom) {
      joinAsGuest(finalName);
    }

    // Stop lobby preview tracks before transferring to in-call engine
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    onJoinMeeting({
      micMuted: isMicMuted,
      camOff: isCamOff,
      displayName: finalName,
      presentImmediately: present,
      role: role,
    });
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
      localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
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
    const isTutorUser = profile?.role === "tutor" || isHostFromLanding || selectedRole === "tutor";

    return (
      <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col justify-between selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
        {/* Top Header */}
        <header className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-[#f3eee6]/[0.08] bg-[#0e0d0b]/85 backdrop-blur-md">
          <div className="flex items-center gap-3 cursor-pointer" onClick={onBackToHome}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md">
              <Video className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-[#f3eee6]">
              Mathsy<span className="text-[#f59e0b]">Meet</span>
            </span>
          </div>

          {/* User Status / Google Sign-in */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2.5 bg-[#1a1814] border border-[#f3eee6]/10 px-3 py-1.5 rounded-full text-xs">
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
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => signInWithGoogle()}
                  title="Sign in directly"
                  className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Sign in</span>
                </button>
                <button
                  onClick={() => setShowSignUpModal(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition cursor-pointer"
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
                  onClick={() => signInWithGoogle()}
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
            localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
            setShowSignUpModal(false);
            signInWithGoogle();
          }}
          onContinueWithGoogle={(role) => {
            localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
            setShowSignUpModal(false);
            signUpWithGoogle(role);
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
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col justify-between selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
      {/* Top Header */}
      <header className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-[#f3eee6]/[0.08] bg-[#0e0d0b]/85 backdrop-blur-md">
        <div className="flex items-center gap-3 cursor-pointer" onClick={onBackToHome}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md">
            <Video className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-[#f3eee6]">
            Mathsy<span className="text-[#f59e0b]">Meet</span>
          </span>
        </div>

        {/* User Status / Google Sign-in */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2.5 bg-[#1a1814] border border-[#f3eee6]/10 px-3 py-1.5 rounded-full text-xs">
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
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => signInWithGoogle()}
                title="Sign in directly"
                className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Sign in</span>
              </button>
              <button
                onClick={() => setShowSignUpModal(true)}
                className="px-3.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition cursor-pointer"
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Lobby Section */}
      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center p-6 md:p-12 gap-8 md:gap-14 max-w-6xl mx-auto w-full ambient-glow">
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
              <div className="grid grid-cols-2 gap-2.5">
                {/* Tutor Option */}
                <div
                  onClick={() => setSelectedRole("tutor")}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    selectedRole === "tutor"
                      ? "bg-[#f59e0b]/10 border-[#f59e0b] ring-1 ring-[#f59e0b] shadow-lg shadow-[#f59e0b]/15"
                      : "bg-[#1a1814] border-[#f3eee6]/10 hover:border-[#f3eee6]/20 text-[#a39e94]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className={`p-2 rounded-lg ${selectedRole === "tutor" ? "bg-[#f59e0b] text-[#0e0d0b]" : "bg-white/5 text-[#a39e94]"}`}>
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    {selectedRole === "tutor" && <Check className="w-4 h-4 text-[#f59e0b]" />}
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${selectedRole === "tutor" ? "text-[#f3eee6]" : "text-[#a39e94]"}`}>
                      Tutor / Teacher
                    </h3>
                    <p className="text-[11px] text-[#a39e94] leading-tight mt-0.5">
                      Host controls, math whiteboard, live polls & moderation
                    </p>
                  </div>
                </div>

                {/* Student Option */}
                <div
                  onClick={() => setSelectedRole("student")}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    selectedRole === "student"
                      ? "bg-[#f59e0b]/10 border-[#f59e0b] ring-1 ring-[#f59e0b] shadow-lg shadow-[#f59e0b]/15"
                      : "bg-[#1a1814] border-[#f3eee6]/10 hover:border-[#f3eee6]/20 text-[#a39e94]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className={`p-2 rounded-lg ${selectedRole === "student" ? "bg-[#f59e0b] text-[#0e0d0b]" : "bg-white/5 text-[#a39e94]"}`}>
                      <BookOpen className="w-4 h-4" />
                    </div>
                    {selectedRole === "student" && <Check className="w-4 h-4 text-[#f59e0b]" />}
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${selectedRole === "student" ? "text-[#f3eee6]" : "text-[#a39e94]"}`}>
                      Student / Learner
                    </h3>
                    <p className="text-[11px] text-[#a39e94] leading-tight mt-0.5">
                      Live classroom, raise hand, answer polls & interactive chat
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isAuthenticated && !isDemoRoom ? (
            <div className="w-full bg-[#1a1814] border border-[#f59e0b]/30 rounded-2xl p-5 shadow-2xl text-left space-y-4 animate-in fade-in duration-300">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-[#f59e0b]/15 text-[#f59e0b] shrink-0 mt-0.5">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#f3eee6]">Sign in required to enter class</h3>
                  <p className="text-xs text-[#a39e94] leading-relaxed mt-0.5">
                    The tutor requires all students to be signed in. Please sign in or register with your Google account to enter.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 pt-1">
                {/* 1-Click Sign In */}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
                    signInWithGoogle();
                  }}
                  className="w-full py-3.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-xl font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#0e0d0b" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#0e0d0b" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#0e0d0b" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#0e0d0b" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Sign in with Google to Enter Class</span>
                </button>

                {/* Sign Up as Student */}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
                    signUpWithGoogle("student");
                  }}
                  className="w-full py-2.5 bg-transparent hover:bg-white/5 border border-[#f3eee6]/15 text-[#f3eee6] rounded-xl font-medium text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  <span>New Student? Sign up with Google</span>
                </button>
              </div>

              <p className="text-[11px] text-[#a39e94] text-center font-mono">
                Class: <span className="text-[#f59e0b] font-semibold">{meetingCode}</span> • Verified Students Only
              </p>
            </div>
          ) : (
            <>
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
                {selectedRole === "tutor" ? (
                  <>
                    <button
                      onClick={() => handleJoinWithRole("tutor", false)}
                      className="w-full py-3.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                    >
                      <GraduationCap className="w-4 h-4" />
                      Join as Tutor (Host Meeting)
                    </button>

                    <button
                      onClick={() => handleJoinWithRole("tutor", true)}
                      className="w-full py-2.5 bg-transparent hover:bg-[#1a1814] border border-[#f3eee6]/15 text-[#f3eee6] rounded-lg font-medium text-xs transition flex items-center justify-center gap-2"
                    >
                      <Monitor className="w-3.5 h-3.5 text-[#f59e0b]" />
                      Present Screen as Tutor
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleJoinWithRole("student", false)}
                    className="w-full py-3.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <BookOpen className="w-4 h-4" />
                    Join as Student
                  </button>
                )}
              </div>
            </>
          )}

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
          localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
          setShowSignUpModal(false);
          signInWithGoogle();
        }}
        onContinueWithGoogle={(role) => {
          localStorage.setItem("mathsy_meet_redirect_url", `/meet/${meetingCode}`);
          setShowSignUpModal(false);
          signUpWithGoogle(role);
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
    </div>
  );
};
