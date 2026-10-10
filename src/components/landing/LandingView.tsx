import React, { useState } from "react";
import {
  Video,
  Plus,
  Keyboard,
  Link2,
  Calendar,
  Sparkles,
  ShieldCheck,
  CheckCircle,
  Copy,
  ArrowRight,
  BarChart3,
  Ruler,
  Compass,
  Radio,
  Users,
  Lock,
  ChevronDown,
  Layers,
  HelpCircle,
  Check,
  GraduationCap,
  BookOpen,
  ArrowUpRight
} from "lucide-react";
import { sanitizeRoomId } from "../../lib/utils";
import { useAuth } from "../../auth/authContext";
import { createRoom, createDemoRoom } from "../../services/roomService";
import { toast } from "sonner";

interface LandingViewProps {
  onStartMeeting: (code: string) => void;
}

export const LandingView: React.FC<LandingViewProps> = ({ onStartMeeting }) => {
  const { user, profile, session, signInWithGoogle, signOut } = useAuth();
  const [meetingInput, setMeetingInput] = useState("");
  const [showNewMeetingDropdown, setShowNewMeetingDropdown] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState<string | null>(null);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Resume pending action after OAuth redirect or notify on cancel
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errorParam = urlParams.get("error") || hashParams.get("error") || urlParams.get("error_description");
    if (errorParam) {
      sessionStorage.removeItem("pendingAction");
      toast.error("Sign-in was cancelled. No meeting created.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const pending = sessionStorage.getItem("pendingAction");
    if (!pending) return;

    if (session?.access_token && user) {
      sessionStorage.removeItem("pendingAction");
      setIsCreatingRoom(true);
      if (pending === "new-meeting") {
        createRoom(session.access_token)
          .then(({ code }) => {
            toast.success("Signed in! Starting your class as tutor...");
            onStartMeeting(code);
          })
          .catch((err) => {
            toast.error(err.message || "Failed to start meeting");
          })
          .finally(() => setIsCreatingRoom(false));
      } else if (pending === "create-link") {
        createRoom(session.access_token)
          .then(({ code }) => {
            const url = `${window.location.origin}/meet/${code}`;
            setGeneratedLink(url);
            setShowLinkModal(true);
            toast.success("Meeting link generated!");
          })
          .catch((err) => {
            toast.error(err.message || "Failed to create meeting link");
          })
          .finally(() => setIsCreatingRoom(false));
      }
    }
  }, [session, user, onStartMeeting]);

  const handleStartDemo = async () => {
    setShowNewMeetingDropdown(false);
    setIsCreatingRoom(true);
    try {
      toast.info("Launching instant 30-minute demo room...");
      const { code, token } = await createDemoRoom();
      sessionStorage.setItem(`demo_token_${code}`, token);
      window.history.pushState({}, "", `/meet/${code}?demo=1`);
      onStartMeeting(code);
    } catch (err: any) {
      toast.error(err.message || "Failed to start demo room");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleStartInstant = async () => {
    setShowNewMeetingDropdown(false);
    if (!user || !session?.access_token) {
      toast.info("Sign in with Google to start a meeting");
      sessionStorage.setItem("pendingAction", "new-meeting");
      try {
        await signInWithGoogle();
      } catch (err: any) {
        sessionStorage.removeItem("pendingAction");
        toast.error("Failed to start Google sign-in");
      }
      return;
    }

    setIsCreatingRoom(true);
    try {
      const { code } = await createRoom(session.access_token);
      onStartMeeting(code);
    } catch (err: any) {
      toast.error(err.message || "Failed to start meeting");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleCreateForLater = async () => {
    setShowNewMeetingDropdown(false);
    if (!user || !session?.access_token) {
      toast.info("Sign in with Google to start a meeting");
      sessionStorage.setItem("pendingAction", "create-link");
      try {
        await signInWithGoogle();
      } catch (err: any) {
        sessionStorage.removeItem("pendingAction");
        toast.error("Failed to start Google sign-in");
      }
      return;
    }

    setIsCreatingRoom(true);
    try {
      const { code } = await createRoom(session.access_token);
      const url = `${window.location.origin}/meet/${code}`;
      setGeneratedLink(url);
      setShowLinkModal(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate meeting link");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeRoomId(meetingInput);
    if (!sanitized) {
      toast.error("Please enter a valid meeting code or link");
      return;
    }
    onStartMeeting(sanitized);
  };

  const copyGeneratedLink = () => {
    navigator.clipboard.writeText(generatedLink);
    toast.success("Meeting link copied to clipboard!");
  };

  const faqs = [
    {
      q: "How does Mathsy Meet compare to Zoom or Google Meet?",
      a: "Mathsy Meet includes an integrated collaborative math whiteboard with real-time geometric instruments (ruler, compass, 360° protractor, set square), live in-call polls, and zero per-minute cloud fees using self-hosted Mediasoup SFU."
    },
    {
      q: "Do students need to install software or make an account?",
      a: "No. Students can join instantly via browser on desktop, iPad, tablet, or mobile phone with a simple shareable link without downloading software or registering an account."
    },
    {
      q: "Can I use an iPad or graphic tablet as a companion pen?",
      a: "Yes! Mathsy Meet features Companion Mode. Join with your camera and mic on your laptop, and pair your iPad or drawing tablet as a silent digital pen on the same whiteboard without audio feedback."
    },
    {
      q: "Can I record sessions or stream live to YouTube?",
      a: "Yes. Both local high-resolution recording directly to your device and 1-click RTMP streaming to YouTube Live are supported out of the box."
    }
  ];

  return (
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
      {/* Top Header Navigation */}
      <header className="sticky top-0 z-50 px-6 md:px-12 h-16 flex items-center justify-between bg-[#0e0d0b]/85 backdrop-blur-md border-b border-[#f3eee6]/[0.08]">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md">
            <Video className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tracking-tight text-[#f3eee6]">
              Mathsy<span className="text-[#f59e0b]">Meet</span>
            </span>
          </div>
        </div>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-[#a39e94]">
          <a href="#how-it-works" className="hover:text-[#f3eee6] transition">How It Works</a>
          <a href="#features" className="hover:text-[#f3eee6] transition">Features</a>
          <a href="#comparison" className="hover:text-[#f3eee6] transition">Comparison</a>
          <a href="#pricing" className="hover:text-[#f3eee6] transition">Pricing</a>
          <a href="#faq" className="hover:text-[#f3eee6] transition">FAQ</a>
        </nav>

        {/* Auth / Action Button */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2.5 bg-[#1a1814] border border-[#f3eee6]/10 px-3 py-1.5 rounded-full text-xs">
              <div className="w-5 h-5 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-[10px]">
                {profile?.name?.charAt(0).toUpperCase()}
              </div>
              <span className="text-[#f3eee6] hidden sm:inline text-xs">{profile?.name}</span>
              <button
                onClick={() => signOut()}
                className="text-[11px] text-[#a39e94] hover:text-[#f3eee6] transition ml-1"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#f3eee6] transition"
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

          <button
            onClick={handleStartInstant}
            className="px-4 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-semibold shadow-md shadow-[#f59e0b]/20 transition"
          >
            Start Class
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 md:pt-24 md:pb-28 border-b border-[#f3eee6]/[0.08] ambient-glow">
        <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Heading, description, actions */}
          <div className="lg:col-span-7 space-y-6 text-left">
            <div className="section-label">
              <span>●</span>
              <span>MATHSY MEET · LIVE INSTRUCTION & COLLABORATION</span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[4.2rem] font-normal leading-[1.08] tracking-tight text-[#f3eee6]">
              Virtual classrooms that bring math to life. <span className="italic text-[#f59e0b]">Effortlessly.</span>
            </h1>

            <p className="text-base sm:text-lg text-[#a39e94] max-w-xl leading-relaxed">
              Crystal-clear video conferencing purpose-built for tutors and students. Complete with interactive math whiteboard, real-time ruler and compass, live quizzes, and Google Meet ease of use.
            </p>

            {/* Meeting Controls: New Meeting Dropdown + Join Input */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              {/* New Meeting Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowNewMeetingDropdown(!showNewMeetingDropdown)}
                  disabled={isCreatingRoom}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-sm font-semibold shadow-lg shadow-[#f59e0b]/25 transition hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isCreatingRoom ? "Starting..." : "New Meeting"}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                </button>

                {!user && (
                  <div className="text-[11px] text-[#a39e94] mt-1.5 flex items-center gap-1 font-mono">
                    <span>Sign in to start a class</span>
                  </div>
                )}

                {showNewMeetingDropdown && (
                  <div className="absolute top-14 left-0 w-72 bg-[#1a1814] border border-[#f3eee6]/15 rounded-xl shadow-2xl p-2 z-50 text-left">
                    <button
                      onClick={handleStartInstant}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#221f1a] text-xs font-semibold text-[#f3eee6] transition"
                    >
                      <GraduationCap className="w-4 h-4 text-[#f59e0b]" />
                      <div>
                        <div>Start Class as Tutor</div>
                        <div className="text-[10px] text-[#a39e94] font-normal">Instant room with whiteboard & host tools</div>
                      </div>
                    </button>
                    <button
                      onClick={handleCreateForLater}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#221f1a] text-xs font-semibold text-[#f3eee6] transition"
                    >
                      <Link2 className="w-4 h-4 text-emerald-400" />
                      <div>
                        <div>Create Link for Later</div>
                        <div className="text-[10px] text-[#a39e94] font-normal">Generate shareable class link</div>
                      </div>
                    </button>
                    <button
                      onClick={handleStartDemo}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#221f1a] text-xs font-semibold text-[#f3eee6] transition border-t border-[#f3eee6]/10 pt-2"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="text-amber-300">Try 30-Min Demo</div>
                        <div className="text-[10px] text-[#a39e94] font-normal">Instant room, no sign-in required</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Enter code input */}
              <form onSubmit={handleJoinByCode} className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Keyboard className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a39e94]" />
                  <input
                    type="text"
                    value={meetingInput}
                    onChange={(e) => setMeetingInput(e.target.value)}
                    placeholder="Enter code or link"
                    className="w-full bg-[#1a1814] border border-[#f3eee6]/15 focus:border-[#f59e0b] rounded-lg pl-10 pr-3 py-3 text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!meetingInput.trim()}
                  className="px-5 py-3 rounded-lg bg-transparent hover:bg-[#1a1814] disabled:opacity-40 border border-[#f3eee6]/15 hover:border-[#f59e0b]/50 text-xs font-medium text-[#f3eee6] transition disabled:cursor-not-allowed"
                >
                  Join
                </button>
              </form>
            </div>

            {/* Quick Demo CTA */}
            <div>
              <button
                onClick={handleStartDemo}
                disabled={isCreatingRoom}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold transition shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Try Instant 30-Minute Demo (No Sign-in)</span>
              </button>
            </div>

            {/* Sub-bullets in Geist Mono style */}
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[#a39e94] pt-2">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                50ms SFU Latency
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                Interactive Ruler & Compass
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                Up to 1,000 Peers
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                Zero Downloads
              </span>
            </div>
          </div>

          {/* Right Column: 3D Bezel Showcase Card */}
          <div className="lg:col-span-5">
            <div className="relative rounded-2xl bg-[#1a1814] border border-[#f3eee6]/10 p-4 shadow-2xl space-y-3">
              {/* Bezel Window Top */}
              <div className="flex items-center justify-between pb-3 border-b border-[#f3eee6]/[0.08]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                  <span className="font-mono text-[11px] text-[#a39e94] ml-2">mathsy-meet / room-preview</span>
                </div>
                <span className="font-mono text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-2 py-0.5 rounded-full">
                  ● Mediasoup 4K
                </span>
              </div>

              {/* Classroom screen simulation */}
              <div className="grid grid-cols-2 gap-3 aspect-video bg-[#0e0d0b] rounded-xl p-3 border border-[#f3eee6]/[0.08]">
                {/* Tile 1: Tutor Video Preview */}
                <div className="relative rounded-lg bg-[#221f1a] border border-[#f3eee6]/10 flex flex-col items-center justify-center overflow-hidden">
                  <div className="w-12 h-12 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-lg shadow-md">
                    T
                  </div>
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-[#0e0d0b]/80 backdrop-blur-sm px-2 py-0.5 rounded-md text-[10px] text-[#f3eee6]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span>Tutor (Host)</span>
                  </div>
                  <div className="absolute top-2 right-2 font-mono text-[9px] text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded border border-[#f59e0b]/20">
                    Host Active
                  </div>
                </div>

                {/* Tile 2: Live Math Whiteboard Preview */}
                <div className="relative rounded-lg bg-[#16130f] border border-[#f59e0b]/30 p-2 flex flex-col justify-between overflow-hidden">
                  <div className="flex items-center justify-between font-mono text-[9px] text-[#a39e94]">
                    <span>Geometry Canvas</span>
                    <span className="text-[#f59e0b]">Ruler Active</span>
                  </div>

                  {/* Math geometry illustration */}
                  <div className="flex-1 flex items-center justify-center">
                    <svg className="w-20 h-20 stroke-[#f59e0b] fill-none" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="34" strokeWidth="1.5" strokeDasharray="3 3" />
                      <line x1="50" y1="50" x2="80" y2="25" stroke="#ef4444" strokeWidth="2" />
                      <polygon points="50,16 82,78 18,78" stroke="#10b981" strokeWidth="1.5" />
                      <circle cx="50" cy="50" r="2.5" fill="#f59e0b" />
                    </svg>
                  </div>

                  <div className="flex items-center justify-between text-[9px] font-mono text-[#a39e94]">
                    <span className="text-[#f59e0b]">∠ABC = 45°</span>
                    <span className="text-emerald-400">r = 6 cm</span>
                  </div>
                </div>
              </div>

              {/* Bottom Dock simulation */}
              <div className="flex items-center justify-center gap-2 pt-2 text-[#a39e94]">
                <span className="w-7 h-7 rounded-full bg-[#221f1a] flex items-center justify-center text-xs">🎙️</span>
                <span className="w-7 h-7 rounded-full bg-[#221f1a] flex items-center justify-center text-xs">📹</span>
                <span className="w-7 h-7 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center text-xs font-bold">📐</span>
                <span className="w-7 h-7 rounded-full bg-[#221f1a] flex items-center justify-center text-xs">📊</span>
                <span className="w-7 h-7 rounded-full bg-[#dc2626] text-white flex items-center justify-center text-xs">📞</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS Section (Techiitfly 3-Step Structure) */}
      <section id="how-it-works" className="py-20 px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-14 space-y-3">
            <span className="section-label">HOW IT WORKS</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#f3eee6]">
              Host your classroom in 3 simple steps
            </h2>
            <p className="text-sm text-[#a39e94]">
              A frictionless workflow from instant room creation to interactive teaching.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
              <span className="font-mono text-2xl font-bold text-[#f59e0b]">01</span>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Instant Room Setup</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Click "New Meeting" and choose your role as Tutor. Your 4K WebRTC room is instantly provisioned with zero delay.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
              <span className="font-mono text-2xl font-bold text-[#f59e0b]">02</span>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Share Meeting Link</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Send the 1-click URL to your students. They can join immediately from browser on laptop, iPad, or mobile phone without downloading software.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
              <span className="font-mono text-2xl font-bold text-[#f59e0b]">03</span>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Teach & Collaborate</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Draw geometric shapes with ruler & compass, launch instant live quizzes, share your screen, or stream live to YouTube.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CORE FEATURES Section */}
      <section id="features" className="py-20 px-6 md:px-12 bg-[#0e0d0b] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto space-y-14">
          <div className="text-center max-w-xl mx-auto space-y-3">
            <span className="section-label">PLATFORM FEATURES</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#f3eee6]">
              Engineered for seamless live instruction
            </h2>
            <p className="text-sm text-[#a39e94]">
              Combines Google Meet simplicity with purpose-built mathematical tutoring superpowers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Video className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Mediasoup SFU Protocol</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Ultra-low 50ms latency video conferencing without expensive third-party per-minute cloud bills. Delivers crystal-clear feeds even on low bandwidth.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Ruler className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Geometry Instruments</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Interactive Ruler with cm markings, 360° Protractor with angle display, Compass for circles, and Set Squares on an infinite collaborative canvas.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Real-Time Quizzes & Polls</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Launch live MCQ questions directly in meeting. Students vote with 1 click, and results update live with animated percentage bars.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Local HD & YouTube Live</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Record directly to your Mac or Windows PC in full 1080p, or stream your class live to your academy's YouTube channel via RTMP.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Companion Tablet Mode</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Teach from your laptop webcam and link your iPad or graphics tablet as a silent pen drawing surface without audio echoes.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Tutor Moderation & Gates</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Enforce mandatory camera rules, force-mute students, lower hands, and expel disruptive participants with complete host oversight.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON TABLE Section (Like Techiitfly Comparison) */}
      <section id="comparison" className="py-20 px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-5xl mx-auto space-y-12">
          <div className="text-center max-w-xl mx-auto space-y-3">
            <span className="section-label">COMPARISON</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#f3eee6]">
              Why educators choose Mathsy Meet
            </h2>
            <p className="text-sm text-[#a39e94]">
              See how Mathsy Meet compares to generic video tools like Zoom, Teams, and Google Meet.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#f3eee6]/10 bg-[#0e0d0b]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#f3eee6]/10 bg-[#221f1a]">
                  <th className="p-4 text-[#a39e94] font-semibold w-1/4">Feature</th>
                  <th className="p-4 text-[#a39e94] font-medium w-1/4">Zoom / Teams</th>
                  <th className="p-4 text-[#a39e94] font-medium w-1/4">Google Meet</th>
                  <th className="p-4 text-[#f59e0b] font-bold w-1/4 bg-[#f59e0b]/10 border-l border-[#f59e0b]/30">Mathsy Meet ★</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3eee6]/[0.08]">
                <tr>
                  <td className="p-4 font-semibold text-[#f3eee6]">Math Geometry Instruments</td>
                  <td className="p-4 text-[#a39e94]">No</td>
                  <td className="p-4 text-[#a39e94]">No</td>
                  <td className="p-4 text-[#f59e0b] font-semibold bg-[#f59e0b]/5 border-l border-[#f59e0b]/30">Yes (Ruler, Compass, Protractor)</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#f3eee6]">Interactive Live Quizzes</td>
                  <td className="p-4 text-[#a39e94]">Paid Add-on</td>
                  <td className="p-4 text-[#a39e94]">Enterprise Only</td>
                  <td className="p-4 text-[#f59e0b] font-semibold bg-[#f59e0b]/5 border-l border-[#f59e0b]/30">Built-in & Free</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#f3eee6]">Companion Pen Tablet Mode</td>
                  <td className="p-4 text-[#a39e94]">Requires 2 accounts</td>
                  <td className="p-4 text-[#a39e94]">Complex setup</td>
                  <td className="p-4 text-[#f59e0b] font-semibold bg-[#f59e0b]/5 border-l border-[#f59e0b]/30">1-Click Silent Companion</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#f3eee6]">YouTube Live RTMP</td>
                  <td className="p-4 text-[#a39e94]">Pro plan only</td>
                  <td className="p-4 text-[#a39e94]">Workspace only</td>
                  <td className="p-4 text-[#f59e0b] font-semibold bg-[#f59e0b]/5 border-l border-[#f59e0b]/30">Direct 1-Click Stream</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-[#f3eee6]">Student Camera Enforcement Gate</td>
                  <td className="p-4 text-[#a39e94]">Manual checking</td>
                  <td className="p-4 text-[#a39e94]">No</td>
                  <td className="p-4 text-[#f59e0b] font-semibold bg-[#f59e0b]/5 border-l border-[#f59e0b]/30">Automated Discipline Gate</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* PRICING Section (Techiitfly Warm Card Style) */}
      <section id="pricing" className="py-20 px-6 md:px-12 bg-[#0e0d0b] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto space-y-14">
          <div className="text-center max-w-xl mx-auto space-y-3">
            <span className="section-label">PRICING TIERS</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#f3eee6]">
              Simple, transparent pricing
            </h2>
            <p className="text-sm text-[#a39e94]">
              Start free today or upgrade to unlocked enterprise streaming and geometry instruments.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
            {/* Tier 1: Free */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h3 className="font-serif text-2xl text-[#f3eee6]">Starter</h3>
                <p className="text-xs text-[#a39e94]">For casual meetings and trial 1-on-1 tutoring sessions.</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-[#f3eee6] font-mono">$0</span>
                  <span className="text-xs text-[#a39e94]">/ forever</span>
                </div>

                <div className="space-y-3 pt-4 border-t border-[#f3eee6]/10 text-xs text-[#a39e94]">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Up to 50 participants per call</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>60 minutes per meeting session</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Full collaborative math whiteboard</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Screen sharing & in-call chat</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleStartInstant}
                className="w-full py-3 rounded-lg bg-transparent hover:bg-[#221f1a] text-[#f3eee6] border border-[#f3eee6]/15 font-semibold text-xs transition"
              >
                Start Free
              </button>
            </div>

            {/* Tier 2: Pro Educator (Featured in Amber) */}
            <div className="relative bg-[#1a1814] border-2 border-[#f59e0b] rounded-2xl p-8 flex flex-col justify-between space-y-6 shadow-2xl shadow-[#f59e0b]/15">
              <span className="absolute -top-3 left-6 font-mono text-[10px] font-bold text-[#0e0d0b] bg-[#f59e0b] px-3 py-0.5 rounded-full uppercase tracking-wider">
                MOST POPULAR
              </span>

              <div className="space-y-4">
                <h3 className="font-serif text-2xl text-[#f3eee6]">Pro Educator</h3>
                <p className="text-xs text-[#a39e94]">For independent tutors, academies, and professional teachers.</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-[#f3eee6] font-mono">$15</span>
                  <span className="text-xs text-[#a39e94]">/ month (or ₹999/mo)</span>
                </div>

                <div className="space-y-3 pt-4 border-t border-[#f3eee6]/10 text-xs text-[#f3eee6]">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Up to 250 participants</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Unlimited meeting duration</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Math geometry tools (Ruler, Compass, Protractor)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Interactive live quizzes & instant polls</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Local HD & YouTube Live streaming</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Custom branded meeting room links</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowCheckoutModal("Pro Educator ($15/mo)")}
                className="w-full py-3.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs shadow-lg shadow-[#f59e0b]/25 transition"
              >
                Upgrade to Pro →
              </button>
            </div>

            {/* Tier 3: Enterprise */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h3 className="font-serif text-2xl text-[#f3eee6]">Academy & Enterprise</h3>
                <p className="text-xs text-[#a39e94]">For schools, coaching franchises, and large university programs.</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-[#f3eee6] font-mono">$49</span>
                  <span className="text-xs text-[#a39e94]">/ month (or ₹3,499/mo)</span>
                </div>

                <div className="space-y-3 pt-4 border-t border-[#f3eee6]/10 text-xs text-[#a39e94]">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Up to 1,000 participants</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Dedicated high-capacity Mediasoup media node</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>Multi-tutor administration dashboard</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#f59e0b]" />
                    <span>LMS webhook integrations & student analytics</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowCheckoutModal("Academy & Enterprise ($49/mo)")}
                className="w-full py-3 rounded-lg bg-transparent hover:bg-[#221f1a] text-[#f3eee6] border border-[#f3eee6]/15 font-semibold text-xs transition"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-3xl mx-auto space-y-10">
          <div className="text-center space-y-3">
            <span className="section-label">FREQUENTLY ASKED QUESTIONS</span>
            <h2 className="font-serif text-3xl sm:text-4xl font-normal text-[#f3eee6]">
              Got questions? We've got answers.
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl overflow-hidden transition"
              >
                <button
                  onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between text-sm font-semibold text-[#f3eee6] hover:text-[#f59e0b] transition"
                >
                  <span>{faq.q}</span>
                  <span className="font-mono text-[#f59e0b] ml-4 text-base">
                    {activeFaq === idx ? "−" : "+"}
                  </span>
                </button>
                {activeFaq === idx && (
                  <div className="px-5 pb-5 text-xs text-[#a39e94] leading-relaxed border-t border-[#f3eee6]/[0.06] pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Share Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl text-[#f3eee6]">Classroom Link Ready</h3>
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-[#a39e94] hover:text-[#f3eee6]"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#a39e94]">
              Copy this link and send it to your students or co-teachers. They can join immediately from any browser.
            </p>
            <div className="flex items-center gap-2 bg-[#0e0d0b] p-3 rounded-xl border border-[#f3eee6]/10">
              <span className="flex-1 font-mono text-xs text-[#f3eee6] truncate select-all">
                {generatedLink}
              </span>
              <button
                onClick={copyGeneratedLink}
                className="p-1.5 text-[#f59e0b] hover:text-white rounded-lg transition"
                title="Copy link"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => {
                setShowLinkModal(false);
                const code = sanitizeRoomId(generatedLink);
                onStartMeeting(code);
              }}
              className="w-full py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition"
            >
              Enter Classroom Now →
            </button>
          </div>
        </div>
      )}

      {/* Checkout Simulator Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif text-2xl text-[#f3eee6]">Subscribe to {showCheckoutModal}</h3>
              <p className="text-xs text-[#a39e94] mt-1">
                Deploy your dedicated Mathsy Meet environment for your academy or tutoring brand.
              </p>
            </div>
            <div className="p-4 bg-[#0e0d0b] rounded-xl border border-[#f3eee6]/10 text-xs text-[#a39e94] space-y-2 text-left">
              <p className="font-semibold text-[#f3eee6]">Plan Includes:</p>
              <p>• Dedicated Mediasoup SFU WebRTC media instance</p>
              <p>• Infinite collaborative whiteboard & math geometry tools</p>
              <p>• Google Authentication & custom academy subdomain</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  toast.success("Checkout initialized for " + showCheckoutModal);
                  setShowCheckoutModal(null);
                }}
                className="flex-1 py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition"
              >
                Proceed to Payment
              </button>
              <button
                onClick={() => setShowCheckoutModal(null)}
                className="px-5 py-3 bg-transparent border border-[#f3eee6]/15 text-[#f3eee6] rounded-lg font-medium text-xs transition hover:bg-[#221f1a]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-[#a39e94]">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center">
            <Video className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-[#f3eee6]">Mathsy<span className="text-[#f59e0b]">Meet</span></span>
          <span>© {new Date().getFullYear()} Mathsy Technologies. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[11px]">
          <a href="#how-it-works" className="hover:text-[#f3eee6] transition">How It Works</a>
          <a href="#features" className="hover:text-[#f3eee6] transition">Features</a>
          <a href="#pricing" className="hover:text-[#f3eee6] transition">Pricing</a>
          <a href="#faq" className="hover:text-[#f3eee6] transition">FAQ</a>
        </div>
      </footer>
    </div>
  );
};
