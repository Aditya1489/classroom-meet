import React from "react";
import { Video, Calendar, Sparkles, Terminal } from "lucide-react";

export type WorkspaceTab = "meetings" | "schedule";

interface GoogleMeetLeftRailProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  upcomingCount?: number;
  onOpenDashboard?: () => void;
}

export const GoogleMeetLeftRail: React.FC<GoogleMeetLeftRailProps> = ({
  activeTab,
  onTabChange,
  upcomingCount = 0,
  onOpenDashboard,
}) => {
  return (
    <>
      {/* Desktop Vertical Left Rail (Fixed w-20, docked underneath top header with zero duplicate logo) */}
      <aside className="hidden md:flex flex-col items-center justify-between fixed top-16 bottom-0 left-0 w-20 bg-[#12110e] border-r border-[#f3eee6]/[0.08] z-40 py-4 select-none">
        {/* Navigation Items */}
        <nav className="flex flex-col items-center gap-3 w-full px-2 pt-2">
          {/* Meetings Tab */}
          <button
            onClick={() => onTabChange("meetings")}
            title="Meetings"
            aria-label="Meetings"
            className={`flex flex-col items-center justify-center w-full py-2.5 rounded-2xl transition-all duration-150 cursor-pointer group ${
              activeTab === "meetings"
                ? "text-[#38bdf8]"
                : "text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#f3eee6]/[0.05]"
            }`}
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                activeTab === "meetings"
                  ? "bg-[#0284c7]/25 text-[#38bdf8] shadow-sm shadow-[#0284c7]/20"
                  : "group-hover:bg-[#f3eee6]/10"
              }`}
            >
              <Video className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[11px] font-medium mt-1 tracking-tight">Meetings</span>
          </button>

          {/* My Schedule Tab */}
          <button
            onClick={() => onTabChange("schedule")}
            title="My Schedule"
            aria-label="My Schedule"
            className={`flex flex-col items-center justify-center w-full py-2.5 rounded-2xl transition-all duration-150 cursor-pointer relative group ${
              activeTab === "schedule"
                ? "text-[#38bdf8]"
                : "text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#f3eee6]/[0.05]"
            }`}
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                activeTab === "schedule"
                  ? "bg-[#0284c7]/25 text-[#38bdf8] shadow-sm shadow-[#0284c7]/20"
                  : "group-hover:bg-[#f3eee6]/10"
              }`}
            >
              <Calendar className="w-4 h-4 stroke-[2.2]" />
              {upcomingCount > 0 && (
                <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold flex items-center justify-center shadow-md shadow-[#f59e0b]/40 ring-2 ring-[#12110e] animate-pulse">
                  {upcomingCount > 99 ? "99+" : upcomingCount}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium mt-1 tracking-tight text-center leading-tight">
              My Schedule
            </span>
          </button>
        </nav>

        {/* Bottom Rail Actions */}
        <div className="flex flex-col items-center gap-2">
          {onOpenDashboard && (
            <button
              onClick={onOpenDashboard}
              title="Developer Console"
              className="w-10 h-10 rounded-xl hover:bg-[#f3eee6]/10 text-[#a39e94] hover:text-[#f59e0b] flex items-center justify-center transition cursor-pointer"
            >
              <Terminal className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Responsive Bottom Dock (< 768px) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#12110e]/95 backdrop-blur-xl border-t border-[#f3eee6]/10 z-40 flex items-center justify-around px-4 select-none">
        <button
          onClick={() => onTabChange("meetings")}
          className={`flex flex-col items-center justify-center py-1 px-4 rounded-xl transition cursor-pointer ${
            activeTab === "meetings" ? "text-[#38bdf8]" : "text-[#a39e94]"
          }`}
        >
          <div
            className={`px-4 py-1 rounded-full transition ${
              activeTab === "meetings" ? "bg-[#0284c7]/25 text-[#38bdf8]" : ""
            }`}
          >
            <Video className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-medium mt-0.5">Meetings</span>
        </button>

        <button
          onClick={() => onTabChange("schedule")}
          className={`flex flex-col items-center justify-center py-1 px-4 rounded-xl transition cursor-pointer relative ${
            activeTab === "schedule" ? "text-[#38bdf8]" : "text-[#a39e94]"
          }`}
        >
          <div
            className={`px-4 py-1 rounded-full transition relative ${
              activeTab === "schedule" ? "bg-[#0284c7]/25 text-[#38bdf8]" : ""
            }`}
          >
            <Calendar className="w-5 h-5" />
            {upcomingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[9px] font-bold flex items-center justify-center shadow-md ring-1 ring-[#12110e] animate-pulse">
                {upcomingCount > 99 ? "99+" : upcomingCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium mt-0.5">My Schedule</span>
        </button>
      </nav>
    </>
  );
};

