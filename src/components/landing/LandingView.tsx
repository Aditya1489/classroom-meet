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
  ArrowUpRight,
  Key,
  Menu,
  X,
  CreditCard,
  LogOut,
  ChevronRight
} from "lucide-react";
import { sanitizeRoomId, generateMeetingCode } from "../../lib/utils";
import { useAuth } from "../../auth/authContext";
import { AuthRoleModal } from "../auth/AuthRoleModal";
import { SignOutConfirmModal } from "../auth/SignOutConfirmModal";
import { createDemoRoom } from "../../services/roomService";
import { toast } from "sonner";
import { dbClient } from "../../lib/dbClient";
import { GoogleMeetLeftRail, WorkspaceTab } from "../navigation/GoogleMeetLeftRail";
import { ScheduleClassModal } from "../schedule/ScheduleClassModal";
import { MyScheduleView } from "../schedule/MyScheduleView";
import { ClassInviteView } from "../schedule/ClassInviteView";

interface LandingViewProps {
  onStartMeeting: (code: string, role?: "tutor" | "student") => void;
  onOpenDashboard?: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({ onStartMeeting, onOpenDashboard }) => {
  const {
    user,
    profile,
    isAuthenticated,
    signInWithGoogle,
    signUpWithGoogle,
    updateRole,
    signOut,
    needsOnboardingRole,
    dismissOnboardingRole,
    isAuthenticating,
  } = useAuth();
  const [meetingInput, setMeetingInput] = useState("");
  const [showNewMeetingDropdown, setShowNewMeetingDropdown] = useState(false);
  const [isAppsMenuOpen, setIsAppsMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  // Alias for compatibility
  const isMobileMenuOpen = isAppsMenuOpen;
  const setIsMobileMenuOpen = setIsAppsMenuOpen;

  const appsMenuRef = React.useRef<HTMLDivElement>(null);
  const accountMenuRef = React.useRef<HTMLDivElement>(null);

  const [currentDateTime, setCurrentDateTime] = useState(() => {
    const now = new Date();
    return (
      now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
      " • " +
      now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    );
  });

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showRoleSwitchModal, setShowRoleSwitchModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("meetings");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleNotificationCount, setScheduleNotificationCount] = useState<number>(0);
  const [scheduleRefreshTrigger, setScheduleRefreshTrigger] = useState<number>(0);
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/invite/")) {
      const parts = window.location.pathname.split("/invite/")[1];
      return parts ? parts.split("/")[0].trim() : null;
    }
    return null;
  });

  const isStudent = profile?.role === "student";

  // Post-Login Intent Continuation Handler:
  // Automatically resumes user's pending action (Start Instant Class, Open Scheduler, View Schedule)
  // after returning from Google authentication, instead of stranding them on the home page.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const rawAction = localStorage.getItem("mathsy_meet_pending_action");
    if (!rawAction) return;

    try {
      const action = JSON.parse(rawAction);
      localStorage.removeItem("mathsy_meet_pending_action");

      if (action.type === "start_instant_class") {
        toast.success("Welcome back! Launching your instant class now...");
        handleStartInstant();
      } else if (action.type === "open_schedule_modal") {
        toast.success("Welcome back! Opening class scheduler...");
        setShowScheduleModal(true);
      } else if (action.type === "view_schedule") {
        setWorkspaceTab("schedule");
      }
    } catch (e) {
      console.warn("[Auth] Failed to resume pending action:", e);
      localStorage.removeItem("mathsy_meet_pending_action");
    }
  }, [isAuthenticated]);

  // Guard: if user is logged out or unauthenticated, immediately reset workspaceTab to "meetings"
  React.useEffect(() => {
    if (!isAuthenticated && workspaceTab !== "meetings") {
      setWorkspaceTab("meetings");
    }
  }, [isAuthenticated, workspaceTab]);

  // Sync pending class invitations count for navigation badges
  const fetchScheduleNotificationCount = React.useCallback(async () => {
    if (!isAuthenticated) {
      setScheduleNotificationCount(0);
      return;
    }
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      if (!token) return;
      const res = await fetch("/api/classes/my-schedule", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const attending: any[] = data.attendingClasses || [];
        const pendingCount = attending.filter(
          (c) => c.my_rsvp_status === "pending" && c.status !== "cancelled"
        ).length;
        setScheduleNotificationCount(pendingCount);
      }
    } catch (e) {
      console.warn("[LandingView] Failed to fetch schedule count:", e);
    }
  }, [isAuthenticated]);

  // Synchronize all schedule views, agendas, and badges across the current tab and background tabs
  const refreshAllScheduleData = React.useCallback(() => {
    setScheduleRefreshTrigger((prev) => prev + 1);
    fetchScheduleNotificationCount();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mathsy:schedule-updated"));
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel("mathsy_schedule_sync");
          ch.postMessage({ type: "SCHEDULE_UPDATED" });
          ch.close();
        }
      } catch {}
    }
  }, [fetchScheduleNotificationCount]);

  React.useEffect(() => {
    fetchScheduleNotificationCount();
    const interval = setInterval(fetchScheduleNotificationCount, 15000);

    const handleFocusSync = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchScheduleNotificationCount();
      }
    };
    window.addEventListener("focus", handleFocusSync);
    document.addEventListener("visibilitychange", handleFocusSync);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocusSync);
      document.removeEventListener("visibilitychange", handleFocusSync);
    };
  }, [fetchScheduleNotificationCount]);

  // Update Google Meet live clock every 15 seconds
  React.useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentDateTime(
        now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
        " • " +
        now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      );
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Click outside and Escape key handling for Google Meet popovers + scroll lock on small screens
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (appsMenuRef.current && !appsMenuRef.current.contains(e.target as Node)) {
        setIsAppsMenuOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsAppsMenuOpen(false);
        setIsAccountMenuOpen(false);
      }
    };

    if (isAppsMenuOpen && typeof window !== "undefined" && window.innerWidth < 768) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAppsMenuOpen]);

  const handleStartDemo = async () => {
    setShowNewMeetingDropdown(false);
    setIsCreatingRoom(true);
    try {
      toast.info("Launching instant 30-minute demo room...");
      const { code, token } = await createDemoRoom();
      sessionStorage.setItem(`demo_token_${code}`, token);
      window.history.pushState({}, "", `/meet/${code}?demo=1`);
      onStartMeeting(code, "tutor");
    } catch (err: any) {
      toast.error(err.message || "Failed to start demo room");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleStartInstant = async () => {
    if (!isAuthenticated) {
      toast.info("Please sign in with Google to start or host a meeting.");
      signInWithGoogle({ type: "start_instant_class", returnUrl: "/" });
      return;
    }
    if (isStudent) {
      toast.info("Student accounts cannot host meetings. Switch to Tutor role in settings if you want to host a class.");
      setShowRoleSwitchModal(true);
      return;
    }
    const code = generateMeetingCode();
    setShowNewMeetingDropdown(false);

    // Persist room in PostgreSQL backend before entering
    const createdRoom = await dbClient.upsertRoom({
      room_code: code,
      title: "Instant Class",
      tutor_id: profile?.id,
      tutor_name: profile?.name,
      is_active: true,
    });

    if (!createdRoom) {
      toast.error("Failed to initialize meeting on server. Please try again.");
      return;
    }

    onStartMeeting(createdRoom.room_code, "tutor");
  };

  const handleCreateForLater = async () => {
    if (!isAuthenticated) {
      toast.info("Please sign in with Google to create meeting links.");
      signInWithGoogle({ type: "open_schedule_modal", returnUrl: "/" });
      return;
    }
    if (isStudent) {
      toast.info("Student accounts cannot create meeting links. Switch to Tutor role to host.");
      setShowRoleSwitchModal(true);
      return;
    }
    const code = generateMeetingCode();
    setShowNewMeetingDropdown(false);

    // Persist room in PostgreSQL backend before generating shareable link
    const createdRoom = await dbClient.upsertRoom({
      room_code: code,
      title: "Scheduled Class",
      tutor_id: profile?.id,
      tutor_name: profile?.name,
      is_active: true,
    });

    if (!createdRoom) {
      toast.error("Failed to generate meeting link. Please check server connection.");
      return;
    }

    const url = `${window.location.origin}/meet/${createdRoom.room_code}`;
    setGeneratedLink(url);
    setShowLinkModal(true);
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeRoomId(meetingInput);
    if (!sanitized) {
      toast.error("Please enter a valid meeting code or link");
      return;
    }

    try {
      const room = await dbClient.getRoom(sanitized);
      const isOwner = Boolean(room && profile?.id && room.tutor_id === profile.id);
      onStartMeeting(sanitized, isOwner ? "tutor" : "student");
    } catch {
      onStartMeeting(sanitized, "student");
    }
  };

  const copyGeneratedLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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

  if (inviteToken) {
    return (
      <ClassInviteView
        token={inviteToken}
        onNavigateHome={() => {
          window.history.pushState({}, "", "/");
          setInviteToken(null);
          setWorkspaceTab("schedule");
        }}
        onEnterMeeting={(code, role) => onStartMeeting(code, role)}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden bg-[#0e0d0b] text-[#f3eee6] flex flex-col selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
      {/* Google Meet Style Left Navigation Rail (Authenticated Mode - Docked under Header) */}
      {isAuthenticated && (
        <GoogleMeetLeftRail
          activeTab={workspaceTab}
          onTabChange={setWorkspaceTab}
          upcomingCount={scheduleNotificationCount}
          onOpenDashboard={onOpenDashboard}
        />
      )}

      {/* Top Header Navigation (Full Width Master Header) */}
      <header className="sticky top-0 z-50 px-3 sm:px-6 md:px-8 h-16 flex items-center justify-between bg-[#0e0d0b]/90 backdrop-blur-md border-b border-[#f3eee6]/[0.08] min-w-0 w-full">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shadow-md shrink-0">
            <Video className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base sm:text-lg font-bold tracking-tight text-[#f3eee6]">
              Mathsy<span className="text-[#f59e0b]">Meet</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-400 font-mono font-bold tracking-wider uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
        </div>

        {/* Center: Google Meet Live Clock & Date */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-[#a39e94] select-none tracking-wide bg-[#161512]/60 px-3.5 py-1.5 rounded-full border border-[#f3eee6]/[0.06]">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b]/80" />
          <span>{currentDateTime}</span>
        </div>

        {/* Right: Google Meet Style Action Cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 relative">
          {/* Primary CTA (Positioned to the LEFT of utilities and avatar so Avatar remains the terminal right anchor) */}
          <div className="hidden sm:block">
            {isStudent ? (
              <button
                onClick={() => {
                  const el = document.getElementById("meeting-code-input");
                  el?.focus();
                }}
                className="px-3.5 py-1.5 rounded-full bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/15 hover:border-[#f3eee6]/30 text-[#f3eee6] text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                <span>Join Class</span>
              </button>
            ) : (
              <button
                onClick={handleStartInstant}
                className="px-3.5 py-1.5 rounded-full bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 border border-[#f59e0b]/30 hover:border-[#f59e0b]/60 text-[#f59e0b] text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <GraduationCap className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Start Class</span>
              </button>
            )}
          </div>

          {/* Desktop Auth & Help Cluster */}
          <div className="hidden md:flex items-center">
            <a
              href="#faq"
              title="Help & FAQ"
              className="p-2 rounded-full hover:bg-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
            >
              <HelpCircle className="w-5 h-5" />
            </a>
          </div>

          {/* Google Apps 9-Dot Waffle Button (Menu) */}
          <div className="relative" ref={appsMenuRef}>
            <button
              onClick={() => {
                setIsAppsMenuOpen(!isAppsMenuOpen);
                setIsAccountMenuOpen(false);
              }}
              title="Google Meet style Apps Menu"
              aria-label="Open platform menu"
              className={`p-2 sm:p-2.5 rounded-full transition cursor-pointer flex items-center justify-center group ${
                isAppsMenuOpen
                  ? "bg-[#f59e0b]/20 text-[#f59e0b] ring-2 ring-[#f59e0b]/40"
                  : "hover:bg-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6]"
              }`}
            >
              <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="5" r="2" />
                <circle cx="12" cy="5" r="2" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="12" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
              </svg>
            </button>

            {/* Google Apps Floating Bento Dropdown (No Screen Blackout, Smooth Spring) */}
            {isAppsMenuOpen && (
              <div className="absolute right-0 top-12 sm:top-14 z-50 w-[300px] sm:w-[350px] bg-[#161512]/95 backdrop-blur-2xl border border-[#f3eee6]/15 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] p-4 text-[#f3eee6] animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150 origin-top-right">
                <div className="flex items-center justify-between pb-3 mb-2 border-b border-[#f3eee6]/10">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#a39e94]">Platform Menu</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30">
                    Mathsy Suite
                  </span>
                </div>

                {/* 3x2 Matrix of Google App Icons */}
                <div className="grid grid-cols-3 gap-2 py-1">
                  {/* How It Works */}
                  <a
                    href="#how-it-works"
                    onClick={() => setIsAppsMenuOpen(false)}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-blue-500/20 transition-all duration-200">
                      <Compass className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f3eee6] mt-2 group-hover:text-blue-300 transition-colors">How It Works</span>
                  </a>

                  {/* Features */}
                  <a
                    href="#features"
                    onClick={() => setIsAppsMenuOpen(false)}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-purple-500/20 transition-all duration-200">
                      <Layers className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f3eee6] mt-2 group-hover:text-purple-300 transition-colors">Features</span>
                  </a>

                  {/* Comparison */}
                  <a
                    href="#comparison"
                    onClick={() => setIsAppsMenuOpen(false)}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all duration-200">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f3eee6] mt-2 group-hover:text-emerald-300 transition-colors">Comparison</span>
                  </a>

                  {/* Pricing */}
                  <a
                    href="#pricing"
                    onClick={() => setIsAppsMenuOpen(false)}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-amber-500/20 transition-all duration-200">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f3eee6] mt-2 group-hover:text-amber-300 transition-colors">Pricing</span>
                  </a>

                  {/* FAQ */}
                  <a
                    href="#faq"
                    onClick={() => setIsAppsMenuOpen(false)}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-cyan-500/20 transition-all duration-200">
                      <HelpCircle className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f3eee6] mt-2 group-hover:text-cyan-300 transition-colors">FAQ</span>
                  </a>

                  {/* Developer Console */}
                  <button
                    onClick={() => {
                      setIsAppsMenuOpen(false);
                      if (onOpenDashboard) {
                        onOpenDashboard();
                      } else {
                        window.history.pushState({}, "", "/dashboard");
                        window.dispatchEvent(new PopStateEvent("popstate"));
                      }
                    }}
                    className="flex flex-col items-center justify-center p-2 rounded-2xl hover:bg-[#f3eee6]/10 transition-all group text-center cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 flex items-center justify-center group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-yellow-500/20 transition-all duration-200 relative">
                      <Key className="w-5 h-5" />
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#f59e0b] rounded-full animate-ping" />
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#f59e0b] rounded-full" />
                    </div>
                    <span className="text-[11px] font-medium text-[#f59e0b] mt-2 group-hover:text-yellow-300 transition-colors">Console</span>
                  </button>
                </div>

                {/* My Schedule Quick Action */}
                {isAuthenticated && (
                  <div className="mt-2 pt-2 border-t border-[#f3eee6]/10">
                    <button
                      onClick={() => {
                        setIsAppsMenuOpen(false);
                        setWorkspaceTab("schedule");
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-[#0284c7]/15 hover:bg-[#0284c7]/25 border border-[#0284c7]/30 text-xs font-semibold text-[#38bdf8] flex items-center justify-between transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-[#38bdf8]" />
                        <span>My Schedule</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {scheduleNotificationCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold shadow-sm">
                            {scheduleNotificationCount}
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-[#38bdf8]" />
                      </div>
                    </button>
                  </div>
                )}

                {/* Instant 30-Min Demo Bottom Pill */}
                <div className="mt-3 pt-3 border-t border-[#f3eee6]/10">
                  <button
                    onClick={() => {
                      setIsAppsMenuOpen(false);
                      handleStartDemo();
                    }}
                    className="w-full py-2.5 px-3 rounded-2xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 hover:border-[#f59e0b]/40 text-xs font-medium text-[#f3eee6] flex items-center justify-between transition group cursor-pointer shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#f59e0b]" />
                      <span>Instant 30-Min Demo</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-[#a39e94] group-hover:text-[#f59e0b] group-hover:translate-x-0.5 transition" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Avatar / Google Account Popover */}
          {user ? (
            <div className="relative" ref={accountMenuRef}>
              <button
                onClick={() => {
                  setIsAccountMenuOpen(!isAccountMenuOpen);
                  setIsAppsMenuOpen(false);
                }}
                title={profile?.name || "Google Account"}
                className="w-9 h-9 rounded-full ring-2 ring-[#f59e0b]/70 hover:ring-[#f59e0b] transition cursor-pointer relative shadow-sm overflow-hidden flex items-center justify-center"
              >
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile?.name || "User"}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center font-bold text-xs">
                    {profile?.name?.charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              {/* Google Meet Style Account Card with Spring Animation */}
              {isAccountMenuOpen && (
                <div className="absolute right-0 top-12 sm:top-14 z-50 w-80 bg-[#161512]/95 backdrop-blur-2xl border border-[#f3eee6]/15 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] p-5 text-center text-[#f3eee6] animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150 origin-top-right">
                  <div className="text-xs text-[#a39e94] font-mono truncate max-w-[260px] mx-auto mb-3">
                    {profile?.email}
                  </div>

                  <div className="relative w-16 h-16 mx-auto mb-3">
                    {profile?.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile?.name || "User"}
                        className="w-16 h-16 rounded-full object-cover ring-3 ring-[#f59e0b] shadow-[0_0_20px_rgba(245,158,11,0.35)] mx-auto"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center font-bold text-2xl ring-3 ring-[#f59e0b] shadow-[0_0_20px_rgba(245,158,11,0.35)] mx-auto">
                        {profile?.name?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-[#f3eee6] truncate">
                    Hi, {profile?.name?.split(" ")[0] || profile?.name}!
                  </h3>

                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                        profile?.role === "student"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/30"
                      }`}
                    >
                      {profile?.role === "student" ? (
                        <>
                          <BookOpen className="w-3 h-3" />
                          <span>Student</span>
                        </>
                      ) : (
                        <>
                          <GraduationCap className="w-3 h-3" />
                          <span>Tutor</span>
                        </>
                      )}
                    </span>
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setShowRoleSwitchModal(true);
                      }}
                      className="text-[11px] text-[#f59e0b] hover:text-[#fbbf24] underline underline-offset-2 transition cursor-pointer font-medium"
                    >
                      Switch
                    </button>
                  </div>

                  <div className="mt-5 pt-4 border-t border-[#f3eee6]/10 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setWorkspaceTab("schedule");
                      }}
                      className="w-full py-2.5 px-3.5 rounded-2xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 hover:border-[#0284c7]/40 text-xs font-semibold text-[#38bdf8] flex items-center justify-between transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-[#38bdf8]" />
                        <span>My Schedule</span>
                      </div>
                      {scheduleNotificationCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold">
                          {scheduleNotificationCount} new
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setShowSignOutModal(true);
                      }}
                      className="w-full py-2.5 px-3 rounded-2xl bg-[#221f1a] hover:bg-red-500/15 border border-[#f3eee6]/10 hover:border-red-500/30 text-xs font-semibold text-[#f3eee6] hover:text-red-400 flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign out of Mathsy Meet</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle(workspaceTab === "schedule" ? { type: "view_schedule" } : undefined)}
              title="Sign in with Google"
              className="flex items-center gap-2 bg-[#1a1814] hover:bg-[#221f1a] border border-[#f3eee6]/10 hover:border-[#f3eee6]/25 px-3.5 py-2 rounded-full text-xs font-semibold text-[#f3eee6] transition cursor-pointer shadow-sm shrink-0"
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

          {/* Responsive Mobile Cluster Helper */}
          <div className="flex md:hidden items-center">
            {/* Kept for test compatibility */}
          </div>
        </div>
      </header>

      {/* Main Content Shell (Padded left when Left Rail is docked) */}
      <div className={`flex-1 flex flex-col ${isAuthenticated ? "md:pl-20 pb-16 md:pb-0" : ""}`}>
        {/* Main Content: Meetings view vs My Schedule view */}
        {workspaceTab === "schedule" ? (
          <MyScheduleView
            onStartMeeting={onStartMeeting}
            onOpenScheduleModal={() => setShowScheduleModal(true)}
            onPendingCountChange={setScheduleNotificationCount}
            onScheduleUpdated={refreshAllScheduleData}
            refreshTrigger={scheduleRefreshTrigger}
          />
        ) : (
        <>
          {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-16 md:pt-24 md:pb-28 border-b border-[#f3eee6]/[0.08] ambient-glow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Heading, description, actions */}
          <div className="lg:col-span-7 space-y-6 text-left min-w-0">
            <div className="section-label">
              <span>●</span>
              <span>MATHSY MEET · LIVE INSTRUCTION & COLLABORATION</span>
            </div>

            <h1 className="font-serif text-3xl sm:text-5xl lg:text-[4.2rem] font-normal leading-[1.12] sm:leading-[1.08] tracking-tight text-[#f3eee6] break-words">
              Virtual classrooms that bring math to life. <span className="italic text-[#f59e0b]">Effortlessly.</span>
            </h1>

            <p className="text-sm sm:text-lg text-[#a39e94] max-w-xl leading-relaxed">
              Crystal-clear video conferencing purpose-built for tutors and students. Complete with interactive math whiteboard, real-time ruler and compass, live quizzes, and Google Meet ease of use.
            </p>

            {/* Meeting Controls: Adapted for Tutor vs Student account */}
            <div className="pt-2">
              {isStudent ? (
                <div className="space-y-3 max-w-lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      Student Account
                    </span>
                    <span className="text-xs text-[#a39e94]">
                      Enter class code or link provided by your teacher
                    </span>
                  </div>

                  <form onSubmit={handleJoinByCode} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                    <div className="relative flex-1 min-w-0">
                      <Keyboard className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a39e94]" />
                      <input
                        id="meeting-code-input"
                        type="text"
                        value={meetingInput}
                        onChange={(e) => setMeetingInput(e.target.value)}
                        placeholder="Enter class code or link to join"
                        className="w-full bg-[#1a1814] border border-[#f3eee6]/15 focus:border-emerald-500 rounded-lg pl-10 pr-3 py-3 text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition min-w-0"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!meetingInput.trim()}
                      className="px-6 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-[#0e0d0b] text-xs font-bold shadow-md shadow-emerald-500/20 transition disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0 cursor-pointer min-h-[44px]"
                    >
                      <BookOpen className="w-4 h-4 text-[#0e0d0b]" />
                      <span>Join Class</span>
                    </button>
                  </form>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
                  {/* New Meeting Dropdown for Tutors */}
                  <div className="relative w-full sm:w-auto shrink-0">
                    <button
                      onClick={() => setShowNewMeetingDropdown(!showNewMeetingDropdown)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-sm font-semibold shadow-lg shadow-[#f59e0b]/25 transition hover:scale-[1.01] active:scale-[0.99] cursor-pointer min-h-[44px]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>New Meeting</span>
                      <ChevronDown className={`w-3.5 h-3.5 opacity-80 transition-transform ${showNewMeetingDropdown ? "rotate-180" : ""}`} />
                    </button>

                    {showNewMeetingDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowNewMeetingDropdown(false)}
                        />
                        <div className="absolute top-14 left-0 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-[#1a1814] border border-[#f3eee6]/15 rounded-xl shadow-2xl p-2 z-50 text-left backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                          <button
                            onClick={handleStartInstant}
                            className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-[#221f1a] transition cursor-pointer text-left group"
                          >
                            <div className="p-2 rounded-lg bg-[#f59e0b]/15 text-[#f59e0b] shrink-0 mt-0.5 group-hover:bg-[#f59e0b] group-hover:text-[#0e0d0b] transition">
                              <GraduationCap className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <div className="text-xs font-semibold text-[#f3eee6] text-left">Start Class as Tutor</div>
                              <div className="text-[11px] text-[#a39e94] font-normal leading-relaxed text-left mt-0.5">
                                Instant room with whiteboard & host tools
                              </div>
                            </div>
                          </button>

                          <button
                            onClick={() => {
                              setShowNewMeetingDropdown(false);
                              if (!isAuthenticated) {
                                toast.info("Please sign in with Google to schedule classes.");
                                signInWithGoogle({ type: "open_schedule_modal", returnUrl: "/" });
                                return;
                              }
                              if (isStudent) {
                                toast.info("Student accounts cannot schedule classes. Switch to Tutor role in settings.");
                                setShowRoleSwitchModal(true);
                                return;
                              }
                              setShowScheduleModal(true);
                            }}
                            className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-[#221f1a] transition cursor-pointer text-left group"
                          >
                            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0 mt-0.5 group-hover:bg-emerald-500 group-hover:text-[#0e0d0b] transition">
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <div className="text-xs font-semibold text-[#f3eee6] text-left">Schedule Class & Send Invites</div>
                              <div className="text-[11px] text-[#a39e94] font-normal leading-relaxed text-left mt-0.5">
                                Plan upcoming session with email calendar invites (.ics)
                              </div>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Enter code input - strictly starts/joins as Tutor */}
                  <form onSubmit={handleJoinByCode} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 w-full max-w-md">
                    <div className="relative flex-1 min-w-0">
                      <Keyboard className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a39e94]" />
                      <input
                        id="meeting-code-input"
                        type="text"
                        value={meetingInput}
                        onChange={(e) => setMeetingInput(e.target.value)}
                        placeholder="Enter class code or link"
                        className="w-full bg-[#1a1814] border border-[#f3eee6]/15 focus:border-[#f59e0b] rounded-lg pl-10 pr-3 py-3 text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition min-w-0"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!meetingInput.trim()}
                      className="px-5 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-40 text-[#0e0d0b] text-xs font-semibold shadow-md shadow-[#f59e0b]/20 transition disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0 cursor-pointer min-h-[44px]"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Join Class</span>
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Quick Demo CTA */}
            <div>
              <button
                onClick={handleStartDemo}
                disabled={isCreatingRoom}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold transition shadow-sm cursor-pointer min-h-[44px]"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Try Instant 30-Minute Demo (No Sign-in)</span>
              </button>
            </div>

            {/* Sub-bullets in Geist Mono style */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-mono text-[#a39e94] pt-2">
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
          <div className="lg:col-span-5 w-full min-w-0">
            <div className="relative rounded-2xl bg-[#1a1814] border border-[#f3eee6]/10 p-3 sm:p-4 shadow-2xl space-y-3 w-full">
              {/* Bezel Window Top */}
              <div className="flex items-center justify-between pb-3 border-b border-[#f3eee6]/[0.08]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444] shrink-0" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] shrink-0" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] shrink-0" />
                  <span className="font-mono text-[10px] sm:text-[11px] text-[#a39e94] ml-1 sm:ml-2 truncate max-w-[130px] sm:max-w-none">
                    mathsy-meet / preview
                  </span>
                </div>
                <span className="font-mono text-[9px] sm:text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-2 py-0.5 rounded-full shrink-0">
                  ● Mediasoup 4K
                </span>
              </div>

              {/* Classroom screen simulation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 aspect-auto sm:aspect-video bg-[#0e0d0b] rounded-xl p-2 sm:p-3 border border-[#f3eee6]/[0.08]">
                {/* Tile 1: Tutor Video Preview */}
                <div className="relative h-28 sm:h-auto rounded-lg bg-[#221f1a] border border-[#f3eee6]/10 flex flex-col items-center justify-center overflow-hidden">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-base sm:text-lg shadow-md">
                    T
                  </div>
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-[#0e0d0b]/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] text-[#f3eee6]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span>Tutor (Host)</span>
                  </div>
                  <div className="absolute top-2 right-2 font-mono text-[8px] sm:text-[9px] text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded border border-[#f59e0b]/20">
                    Host Active
                  </div>
                </div>

                {/* Tile 2: Live Math Whiteboard Preview */}
                <div className="relative h-28 sm:h-auto rounded-lg bg-[#16130f] border border-[#f59e0b]/30 p-2 flex flex-col justify-between overflow-hidden">
                  <div className="flex items-center justify-between font-mono text-[8px] sm:text-[9px] text-[#a39e94]">
                    <span>Geometry Canvas</span>
                    <span className="text-[#f59e0b]">Ruler Active</span>
                  </div>

                  {/* Math geometry illustration */}
                  <div className="flex-1 flex items-center justify-center">
                    <svg className="w-14 h-14 sm:w-20 sm:h-20 stroke-[#f59e0b] fill-none" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="34" strokeWidth="1.5" strokeDasharray="3 3" />
                      <line x1="50" y1="50" x2="80" y2="25" stroke="#ef4444" strokeWidth="2" />
                      <polygon points="50,16 82,78 18,78" stroke="#10b981" strokeWidth="1.5" />
                      <circle cx="50" cy="50" r="2.5" fill="#f59e0b" />
                    </svg>
                  </div>

                  <div className="flex items-center justify-between text-[8px] sm:text-[9px] font-mono text-[#a39e94]">
                    <span className="text-[#f59e0b]">∠ABC = 45°</span>
                    <span className="text-emerald-400">r = 6 cm</span>
                  </div>
                </div>
              </div>

              {/* Bottom Dock simulation */}
              <div className="flex items-center justify-center gap-2 pt-1 sm:pt-2 text-[#a39e94]">
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
      <section id="how-it-works" className="scroll-mt-16 py-16 sm:py-20 px-4 sm:px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-10 sm:mb-14 space-y-3">
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
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-6 sm:p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
              <span className="font-mono text-2xl font-bold text-[#f59e0b]">01</span>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Instant Room Setup</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Click "New Meeting" and choose your role as Tutor. Your 4K WebRTC room is instantly provisioned with zero delay.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-6 sm:p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
              <span className="font-mono text-2xl font-bold text-[#f59e0b]">02</span>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Share Meeting Link</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Send the 1-click URL to your students. They can join immediately from browser on laptop, iPad, or mobile phone without downloading software.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-6 sm:p-8 space-y-4 hover:border-[#f59e0b]/40 transition">
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
      <section id="features" className="scroll-mt-16 py-16 sm:py-20 px-4 sm:px-6 md:px-12 bg-[#0e0d0b] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto space-y-12 sm:space-y-14">
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
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Video className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Mediasoup SFU Protocol</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Ultra-low 50ms latency video conferencing without expensive third-party per-minute cloud bills. Delivers crystal-clear feeds even on low bandwidth.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Ruler className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Geometry Instruments</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Interactive Ruler with cm markings, 360° Protractor with angle display, Compass for circles, and Set Squares on an infinite collaborative canvas.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Real-Time Quizzes & Polls</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Launch live MCQ questions directly in meeting. Students vote with 1 click, and results update live with animated percentage bars.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Local HD & YouTube Live</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Record directly to your Mac or Windows PC in full 1080p, or stream your class live to your academy's YouTube channel via RTMP.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-2xl font-normal text-[#f3eee6]">Companion Tablet Mode</h3>
              <p className="text-xs text-[#a39e94] leading-relaxed">
                Teach from your laptop webcam and link your iPad or graphics tablet as a silent pen drawing surface without audio echoes.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-7 space-y-4 hover:border-[#f59e0b]/50 transition shadow-lg">
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
      <section id="comparison" className="scroll-mt-16 py-16 sm:py-20 px-4 sm:px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
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
            <table className="w-full min-w-[580px] text-left border-collapse text-xs">
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
      <section id="pricing" className="scroll-mt-16 py-16 sm:py-20 px-4 sm:px-6 md:px-12 bg-[#0e0d0b] border-b border-[#f3eee6]/[0.08]">
        <div className="max-w-7xl mx-auto space-y-12 sm:space-y-14">
          <div className="text-center max-w-xl mx-auto space-y-3">
            <span className="section-label">PRICING TIERS</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-[#f3eee6]">
              Simple, transparent pricing
            </h2>
            <p className="text-sm text-[#a39e94]">
              Start free today or upgrade to unlocked enterprise streaming and geometry instruments.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 items-stretch">
            {/* Tier 1: Free */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-8 flex flex-col justify-between space-y-6">
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
                onClick={() => {
                  if (isStudent) {
                    const el = document.getElementById("meeting-code-input");
                    el?.focus();
                  } else {
                    handleStartInstant();
                  }
                }}
                className="w-full py-3 rounded-lg bg-transparent hover:bg-[#221f1a] text-[#f3eee6] border border-[#f3eee6]/15 font-semibold text-xs transition cursor-pointer"
              >
                {isStudent ? "Join a Class" : "Start Free"}
              </button>
            </div>

            {/* Tier 2: Pro Educator (Featured in Amber) */}
            <div className="relative bg-[#1a1814] border-2 border-[#f59e0b] rounded-2xl p-5 sm:p-8 flex flex-col justify-between space-y-6 shadow-2xl shadow-[#f59e0b]/15">
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
                className="w-full py-3.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs shadow-lg shadow-[#f59e0b]/25 transition cursor-pointer"
              >
                Upgrade to Pro →
              </button>
            </div>

            {/* Tier 3: Enterprise */}
            <div className="bg-[#1a1814] border border-[#f3eee6]/10 rounded-2xl p-5 sm:p-8 flex flex-col justify-between space-y-6">
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
                className="w-full py-3 rounded-lg bg-transparent hover:bg-[#221f1a] text-[#f3eee6] border border-[#f3eee6]/15 font-semibold text-xs transition cursor-pointer"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="scroll-mt-16 py-16 sm:py-20 px-4 sm:px-6 md:px-12 bg-[#1a1814] border-b border-[#f3eee6]/[0.08]">
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
                  className="w-full p-4 sm:p-5 text-left flex items-center justify-between text-sm font-semibold text-[#f3eee6] hover:text-[#f59e0b] transition cursor-pointer"
                >
                  <span className="pr-2">{faq.q}</span>
                  <span className="font-mono text-[#f59e0b] text-base shrink-0">
                    {activeFaq === idx ? "−" : "+"}
                  </span>
                </button>
                {activeFaq === idx && (
                  <div className="px-4 sm:px-5 pb-5 text-xs text-[#a39e94] leading-relaxed border-t border-[#f3eee6]/[0.06] pt-3">
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
          <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl text-[#f3eee6]">Classroom Link Ready</h3>
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-[#a39e94] hover:text-[#f3eee6] p-1.5 rounded-lg hover:bg-white/5 transition cursor-pointer"
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
                className="p-1.5 text-[#f59e0b] hover:text-white rounded-lg transition cursor-pointer"
                title="Copy link"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={() => {
                setShowLinkModal(false);
                const code = sanitizeRoomId(generatedLink);
                onStartMeeting(code, "tutor");
              }}
              className="w-full py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <GraduationCap className="w-4 h-4" />
              <span>Enter Classroom as Tutor →</span>
            </button>
          </div>
        </div>
      )}

      {/* Checkout Simulator Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl text-center">
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
                  toast.info("Online subscription checkout isn't available yet.", { id: "checkout" });
                  setShowCheckoutModal(null);
                }}
                className="flex-1 py-3 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] rounded-lg font-bold text-xs transition cursor-pointer"
              >
                Proceed to Payment
              </button>
              <button
                onClick={() => setShowCheckoutModal(null)}
                className="px-5 py-3 bg-transparent border border-[#f3eee6]/15 text-[#f3eee6] rounded-lg font-medium text-xs transition hover:bg-[#221f1a] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-10 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto w-full flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-[#a39e94]">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 sm:gap-3 text-center md:text-left">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] flex items-center justify-center shrink-0">
            <Video className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-[#f3eee6]">Mathsy<span className="text-[#f59e0b]">Meet</span></span>
          <span>© {new Date().getFullYear()} Mathsy Technologies. All rights reserved.</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px]">
          <a href="#how-it-works" className="hover:text-[#f3eee6] transition">How It Works</a>
          <a href="#features" className="hover:text-[#f3eee6] transition">Features</a>
          <a href="#pricing" className="hover:text-[#f3eee6] transition">Pricing</a>
          <a href="#faq" className="hover:text-[#f3eee6] transition">FAQ</a>
        </div>
      </footer>
        </>
      )}
      </div>

      {/* Schedule Class Modal */}
      <ScheduleClassModal
        isOpen={showScheduleModal}
        onClose={() => {
          setShowScheduleModal(false);
          refreshAllScheduleData();
        }}
        onClassScheduled={() => {
          setWorkspaceTab("schedule");
          refreshAllScheduleData();
        }}
      />

      {/* Sign Up Modal: for new users choosing role once */}
      <AuthRoleModal
        isOpen={showSignUpModal}
        onClose={() => setShowSignUpModal(false)}
        onContinueWithGoogle={(role) => {
          setShowSignUpModal(false);
          signUpWithGoogle(role);
        }}
      />

      {/* Role Switch Modal: for logged-in user changing active role */}
      <AuthRoleModal
        isOpen={showRoleSwitchModal}
        onClose={() => setShowRoleSwitchModal(false)}
        isLoggedIn={true}
        defaultRole={profile?.role || "tutor"}
        onUpdateRole={async (newRole) => {
          setShowRoleSwitchModal(false);
          await updateRole(newRole);
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
        defaultRole="tutor"
        onUpdateRole={async (newRole) => {
          await updateRole(newRole);
        }}
      />

      {/* Sign Out Confirmation Modal */}
      <SignOutConfirmModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={async () => {
          setShowSignOutModal(false);
          setWorkspaceTab("meetings");
          await signOut();
        }}
        userName={profile?.name}
        userRole={profile?.role}
        avatarUrl={profile?.avatarUrl}
      />
    </div>
  );
};
