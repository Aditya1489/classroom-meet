import React, { useState, useEffect } from "react";
import { LandingView } from "./components/landing/LandingView";
import { LobbyView } from "./components/lobby/LobbyView";
import { MeetingRoom } from "./components/meet/MeetingRoom";
import { PairTabletPage } from "./components/meet/PairTabletPage";
import { sanitizeRoomId } from "./lib/utils";
import { createDemoRoom } from "./services/roomService";
import { Video, ArrowLeft, RefreshCw, Home, Sparkles } from "lucide-react";
import { Toaster, toast } from "sonner";

export default function App() {
  const [currentView, setCurrentView] = useState<"landing" | "lobby" | "room" | "left" | "pair">("landing");
  const [activeMeetingCode, setActiveMeetingCode] = useState<string>("");
  const [joinOptions, setJoinOptions] = useState<{
    micMuted: boolean;
    camOff: boolean;
    displayName: string;
    presentImmediately: boolean;
    role: "tutor" | "student";
  }>({
    micMuted: false,
    camOff: false,
    displayName: "",
    presentImmediately: false,
    role: "tutor",
  });

  const [isHostFromLanding, setIsHostFromLanding] = useState<boolean>(false);
  const [initialRole, setInitialRole] = useState<"tutor" | "student">("tutor");

  // Check URL path on load (e.g. /meet/abc-defg-hij, /demo, /pair)
  useEffect(() => {
    const checkPath = () => {
      const path = window.location.pathname;
      const urlParams = new URLSearchParams(window.location.search);
      const isDemoQuery = urlParams.get("demo") === "1";

      if (path === "/pair" || path.startsWith("/pair")) {
        setCurrentView("pair");
        return;
      }

      if (path === "/demo" || path.startsWith("/demo/") || isDemoQuery) {
        if (path.includes("/meet/")) {
          const code = sanitizeRoomId(path.split("/meet/")[1]);
          if (code) {
            setActiveMeetingCode(code);
            setCurrentView("lobby");
            return;
          }
        }
        toast.info("Starting instant 30-minute demo room...");
        createDemoRoom()
          .then(({ code, token }) => {
            sessionStorage.setItem(`demo_token_${code}`, token);
            setActiveMeetingCode(code);
            window.history.replaceState({}, "", `/meet/${code}?demo=1`);
            setCurrentView("lobby");
          })
          .catch((err) => {
            toast.error(err.message || "Failed to create demo room");
            setCurrentView("landing");
          });
        return;
      }

      if (path.includes("/meet/")) {
        const code = sanitizeRoomId(path.split("/meet/")[1]);
        if (code) {
          setActiveMeetingCode(code);
          localStorage.setItem("mathsy_meet_redirect_url", `/meet/${code}`);
          const wasHost = sessionStorage.getItem(`mathsy_host_${code}`) === "true";
          setIsHostFromLanding(wasHost);
          setInitialRole(wasHost ? "tutor" : "student");

          // Keep user inside the meeting room on page reload
          const activeSession = sessionStorage.getItem(`mathsy_active_meet_${code}`);
          if (activeSession) {
            try {
              const parsedOptions = JSON.parse(activeSession);
              setJoinOptions(parsedOptions);
              setCurrentView("room");
              return;
            } catch (e) {
              console.warn("Failed to parse saved meet session:", e);
            }
          }

          setCurrentView("lobby");
        }
      }
    };

    checkPath();
    window.addEventListener("popstate", checkPath);
    return () => window.removeEventListener("popstate", checkPath);
  }, []);

  const handleTabletPaired = (data: { classId: string; token: string; isPenDevice: boolean }) => {
    sessionStorage.setItem(`pair_token_${data.classId}`, data.token);
    setActiveMeetingCode(data.classId);
    setJoinOptions({
      micMuted: true,
      camOff: true,
      displayName: "Tablet Companion",
      presentImmediately: false,
      role: "tutor",
    });
    window.history.pushState({}, "", `/meet/${data.classId}?pen=1`);
    setCurrentView("room");
  };

  const handleStartMeeting = (code: string, role: "tutor" | "student" = "tutor") => {
    setActiveMeetingCode(code);
    const isHost = role === "tutor";
    setIsHostFromLanding(isHost);
    setInitialRole(role);
    if (isHost) {
      sessionStorage.setItem(`mathsy_host_${code}`, "true");
    } else {
      sessionStorage.removeItem(`mathsy_host_${code}`);
    }
    window.history.pushState({}, "", `/meet/${code}`);
    setCurrentView("lobby");
  };

  const handleJoinMeeting = (options: {
    micMuted: boolean;
    camOff: boolean;
    displayName: string;
    presentImmediately: boolean;
    role: "tutor" | "student";
  }) => {
    setJoinOptions(options);
    if (activeMeetingCode) {
      sessionStorage.setItem(`mathsy_active_meet_${activeMeetingCode}`, JSON.stringify(options));
    }
    setCurrentView("room");
  };

  const handleLeaveMeeting = () => {
    if (activeMeetingCode) {
      sessionStorage.removeItem(`mathsy_active_meet_${activeMeetingCode}`);
    }
    setCurrentView("left");
  };

  const handleRejoin = () => {
    setCurrentView("lobby");
  };

  const handleReturnToHome = () => {
    if (activeMeetingCode) {
      sessionStorage.removeItem(`mathsy_active_meet_${activeMeetingCode}`);
    }
    window.history.pushState({}, "", "/");
    setActiveMeetingCode("");
    setIsHostFromLanding(false);
    setCurrentView("landing");
  };

  return (
    <div className="w-full min-h-screen bg-[#0e0d0b] text-[#f3eee6] selection:bg-[#f59e0b]/30 selection:text-[#f3eee6]">
      <Toaster position="bottom-left" toastOptions={{ duration: 3000 }} richColors closeButton />

      {currentView === "pair" && (
        <PairTabletPage
          onPaired={handleTabletPaired}
          onBackToHome={handleReturnToHome}
        />
      )}

      {currentView === "landing" && (
        <LandingView onStartMeeting={handleStartMeeting} />
      )}

      {currentView === "lobby" && (
        <LobbyView
          meetingCode={activeMeetingCode}
          isHostFromLanding={isHostFromLanding}
          initialRole={initialRole}
          onJoinMeeting={handleJoinMeeting}
          onBackToHome={handleReturnToHome}
        />
      )}

      {currentView === "room" && (
        <MeetingRoom
          meetingCode={activeMeetingCode}
          initialOptions={joinOptions}
          onLeaveMeeting={handleLeaveMeeting}
        />
      )}

      {currentView === "left" && (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center ambient-glow">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1d4ed8] to-[#06b6d4] text-white flex items-center justify-center mb-6 shadow-2xl">
            <Video className="w-8 h-8" />
          </div>

          <div className="section-label mb-3">SESSION COMPLETE</div>
          <h1 className="font-serif text-4xl font-normal text-[#f3eee6] mb-2">You left the meeting</h1>
          <p className="text-xs text-[#a39e94] mb-8 max-w-sm leading-relaxed">
            Thank you for using Mathsy Meet. Your audio, video, and screen sharing have been completely disconnected.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleRejoin}
              className="px-6 py-3 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Rejoin meeting
            </button>

            <button
              onClick={handleReturnToHome}
              className="px-6 py-3 rounded-lg bg-transparent hover:bg-[#1a1814] border border-[#f3eee6]/15 text-[#f3eee6] font-medium text-xs transition flex items-center gap-2"
            >
              <Home className="w-4 h-4 text-[#a39e94]" />
              Return to home screen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
