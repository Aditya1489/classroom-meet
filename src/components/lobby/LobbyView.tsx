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
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";
import { getRoomRole } from "../../services/roomService";

interface LobbyViewProps {
  meetingCode: string;
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
  onJoinMeeting,
  onBackToHome,
}) => {
  const { user, profile, session, joinAsGuest, signInWithGoogle } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.name || "");
  const [selectedRole, setSelectedRole] = useState<"tutor" | "student">("student");
  const [isOwner, setIsOwner] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Check room ownership status with server
  useEffect(() => {
    let cancelled = false;
    async function checkRole() {
      try {
        const res = await getRoomRole(meetingCode, session?.access_token);
        if (!cancelled) {
          setIsOwner(res.isOwner);
          if (res.isOwner) {
            setSelectedRole("tutor");
          } else {
            setSelectedRole("student");
          }
        }
      } catch {
        if (!cancelled) {
          setIsOwner(false);
          setSelectedRole("student");
        }
      }
    }
    checkRole();
    return () => {
      cancelled = true;
    };
  }, [meetingCode, session]);

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

  const handleJoinWithRole = (requestedRole: "tutor" | "student", present = false) => {
    // Only verified room owners can join as tutor
    const effectiveRole = isOwner && requestedRole === "tutor" ? "tutor" : "student";
    const fallbackPrefix = effectiveRole === "tutor" ? "Tutor" : "Student";
    const finalName = displayName.trim() || profile?.name || `${fallbackPrefix} ${Math.floor(100 + Math.random() * 900)}`;

    if (!profile) {
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
      role: effectiveRole,
    });
  };

  const copyMeetingLink = () => {
    const url = `${window.location.origin}/meet/${meetingCode}`;
    navigator.clipboard.writeText(url);
    toast.success("Meeting link copied to clipboard!");
  };

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
              <div className="w-5 h-5 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-[10px]">
                {profile?.name?.charAt(0).toUpperCase()}
              </div>
              <span className="text-[#f3eee6] hidden sm:inline text-xs">{profile?.name}</span>
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-3 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Sign in</span>
            </button>
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
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center text-3xl font-bold shadow-xl border border-white/20">
                  {displayName.charAt(0).toUpperCase() || (selectedRole === "tutor" ? "T" : "S")}
                </div>
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
              {isOwner && selectedRole === "tutor" ? (
                <>
                  <GraduationCap className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span className="text-[#f59e0b] font-semibold text-xs font-mono">Tutor (Owner)</span>
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
            <span className="section-label mb-2">LOBBY CHECK-IN</span>
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
              {isOwner ? "Select Your Role" : "Your Role in Classroom"}
            </label>

            {isOwner ? (
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
                      Tutor (Host)
                    </h3>
                    <p className="text-[11px] text-[#a39e94] leading-tight mt-0.5">
                      Room creator: host controls, whiteboard & moderation
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
                      Join as participant without host controls
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Non-owner: only student option shown, with explicit "Joining as student" */
              <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-xl p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#f3eee6] flex items-center gap-2">
                      <span>Joining as student</span>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-mono border border-emerald-500/20">Student</span>
                    </div>
                    <p className="text-[11px] text-[#a39e94]">
                      Interactive audio/video participation, chat, polls & whiteboard viewing
                    </p>
                  </div>
                </div>
                <Check className="w-4 h-4 text-emerald-400 mr-1" />
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
              placeholder={isOwner && selectedRole === "tutor" ? "e.g. Prof. Sharma / Tutor" : "e.g. Rahul / Student"}
              className="w-full bg-[#1a1814] border border-[#f3eee6]/15 rounded-lg px-4 py-3 text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none focus:border-[#f59e0b] transition"
            />
          </div>

          {/* Explicit Join Action Buttons */}
          <div className="w-full space-y-2.5 pt-1">
            {isOwner && selectedRole === "tutor" ? (
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

          {/* Quick link copying */}
          <div className="w-full pt-3 border-t border-[#f3eee6]/10 flex items-center justify-between text-xs text-[#a39e94]">
            <span>Invite link</span>
            <button
              onClick={copyMeetingLink}
              className="text-[#f59e0b] hover:underline flex items-center gap-1 font-mono text-[11px]"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy link
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-[11px] font-mono text-[#a39e94] border-t border-[#f3eee6]/[0.06]">
        Mathsy Meet • Dedicated for Tutors and Students with STEM Geometry Whiteboard
      </footer>
    </div>
  );
};
