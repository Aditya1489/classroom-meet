import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Video,
  Plus,
  Users,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  ChevronRight,
  BookOpen,
  GraduationCap,
  Sparkles,
  AlertCircle,
  Mail,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";

interface Attendee {
  email: string;
  rsvp_status: "pending" | "accepted" | "declined";
  rsvp_at?: string;
  user_name?: string;
  user_avatar?: string;
}

interface ScheduledClass {
  id: string;
  room_code: string;
  title: string;
  subject?: string;
  description?: string;
  tutor_id: string;
  tutor_name?: string;
  tutor_avatar?: string;
  scheduled_at: string;
  duration_minutes: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  created_at: string;
  attendees?: Attendee[];
  my_rsvp_status?: "pending" | "accepted" | "declined";
  invite_token?: string;
}

interface MyScheduleViewProps {
  onStartMeeting: (code: string, role?: "tutor" | "student") => void;
  onOpenScheduleModal: () => void;
  onPendingCountChange?: (count: number) => void;
  onScheduleUpdated?: () => void;
  refreshTrigger?: number;
}

export const MyScheduleView: React.FC<MyScheduleViewProps> = ({
  onStartMeeting,
  onOpenScheduleModal,
  onPendingCountChange,
  onScheduleUpdated,
  refreshTrigger,
}) => {
  const { profile } = useAuth();
  const [hostedClasses, setHostedClasses] = useState<ScheduledClass[]>([]);
  const [attendingClasses, setAttendingClasses] = useState<ScheduledClass[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"upcoming" | "invites" | "past">("upcoming");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [respondingToken, setRespondingToken] = useState<string | null>(null);

  const fetchSchedule = async (isBackground = false) => {
    if (!isBackground) setIsLoading(true);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      if (!token) return;

      const res = await fetch(`/api/classes/my-schedule?_t=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        const attending: ScheduledClass[] = data.attendingClasses || [];
        setHostedClasses(data.hostedClasses || []);
        setAttendingClasses(attending);
        const pendingCount = attending.filter(
          (c) => c.my_rsvp_status === "pending" && c.status !== "cancelled"
        ).length;
        onPendingCountChange?.(pendingCount);
      }
    } catch (err) {
      console.error("[MyScheduleView] Failed to load schedule:", err);
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  };

  // Immediate refresh when parent increments refreshTrigger
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchSchedule(true);
    }
  }, [refreshTrigger]);

  useEffect(() => {
    fetchSchedule();

    // Auto-refresh when user switches back from email app, mobile, or another browser tab
    const handleFocusSync = () => {
      fetchSchedule(true);
    };

    // Live custom event sync when schedule changes anywhere in the current window
    const handleScheduleUpdatedEvent = () => {
      fetchSchedule(true);
    };

    // Cross-tab broadcast channel sync
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("mathsy_schedule_sync");
        channel.onmessage = (event) => {
          if (event.data?.type === "SCHEDULE_UPDATED") {
            fetchSchedule(true);
          }
        };
      }
    } catch {
      // BroadcastChannel not available in environment
    }

    // Live background polling every 3 seconds to immediately reflect student RSVP changes from email
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchSchedule(true);
      }
    }, 3000);

    window.addEventListener("focus", handleFocusSync);
    document.addEventListener("visibilitychange", handleFocusSync);
    window.addEventListener("mathsy:schedule-updated", handleScheduleUpdatedEvent);

    return () => {
      window.removeEventListener("focus", handleFocusSync);
      document.removeEventListener("visibilitychange", handleFocusSync);
      window.removeEventListener("mathsy:schedule-updated", handleScheduleUpdatedEvent);
      clearInterval(interval);
      if (channel) {
        channel.close();
      }
    };
  }, []);

  const handleCopyLink = (roomCode: string) => {
    const url = `${window.location.origin}/meet/${roomCode}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(roomCode);
    setTimeout(() => setCopiedCode(null), 2000);
    toast.success("Class link copied to clipboard");
  };

  const handleCancelClass = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to cancel "${title}"?`)) return;

    try {
      const token = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`/api/classes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        toast.success("Class cancelled successfully");
        fetchSchedule(true);
        onScheduleUpdated?.();
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
      } else {
        toast.error("Failed to cancel class");
      }
    } catch {
      toast.error("Failed to reach server");
    }
  };

  const handleRespondInvite = async (token: string, status: "accepted" | "declined") => {
    setRespondingToken(token);
    try {
      const authToken = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`/api/classes/invite/${token}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken ? `Bearer ${authToken}` : "",
        },
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        toast.success(
          status === "accepted"
            ? "Class invitation accepted! Added to My Schedule."
            : "Invitation declined"
        );
        await fetchSchedule(true);
        onScheduleUpdated?.();
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
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update RSVP");
      }
    } catch {
      toast.error("Failed to reach server");
    } finally {
      setRespondingToken(null);
    }
  };

  const now = new Date();

  const isClassUpcomingOrActive = (c: ScheduledClass) => {
    if (c.status === "cancelled" || c.status === "completed") return false;
    const classTime = new Date(c.scheduled_at);
    // If unlimited duration (duration_minutes === 0 or undefined), class stays active for 24 hours after start time
    const effectiveWindowMs = (c.duration_minutes > 0 ? c.duration_minutes : 24 * 60) * 60000;
    return classTime.getTime() + effectiveWindowMs >= now.getTime();
  };

  const acceptedAttendingClasses = attendingClasses.filter(
    (c) => c.my_rsvp_status === "accepted" && c.status !== "cancelled"
  );

  // Upcoming classes MUST ONLY contain classes hosted by the user OR invitations they have explicitly accepted
  const allUpcoming = [...hostedClasses, ...acceptedAttendingClasses]
    .filter(isClassUpcomingOrActive)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  // Pending invitations waiting for tutor/student action
  const pendingInvites = attendingClasses.filter(
    (c) => c.my_rsvp_status === "pending" && c.status !== "cancelled"
  );

  // All invitations received (pending, accepted, or declined) sorted by urgency: pending -> accepted -> declined
  const allInvites = attendingClasses
    .filter((c) => c.status !== "cancelled")
    .sort((a, b) => {
      const statusWeight: Record<string, number> = {
        pending: 1,
        accepted: 2,
        declined: 3,
      };
      const weightA = statusWeight[a.my_rsvp_status || "pending"] || 99;
      const weightB = statusWeight[b.my_rsvp_status || "pending"] || 99;
      if (weightA !== weightB) {
        return weightA - weightB;
      }
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

  const pastClasses = [...hostedClasses, ...acceptedAttendingClasses]
    .filter((c) => !isClassUpcomingOrActive(c))
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  const formatScheduleTime = (isoString: string, durationMinutes: number) => {
    const d = new Date(isoString);
    const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (!durationMinutes || durationMinutes === 0) {
      return `${dateStr} • Starts at ${timeStr} • Unlimited Duration ♾️`;
    }
    const endTime = new Date(d.getTime() + durationMinutes * 60000).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr} • ${timeStr} – ${endTime} (${durationMinutes}m)`;
  };

  const getTimeRelativeBadge = (isoString: string, durationMinutes: number) => {
    const d = new Date(isoString);
    const diffMs = d.getTime() - Date.now();
    const diffMins = Math.round(diffMs / 60000);
    const isUnlimited = !durationMinutes || durationMinutes === 0;
    const windowMins = isUnlimited ? 24 * 60 : durationMinutes;

    if (diffMins <= 0 && diffMins >= -windowMins) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono text-[10px] font-bold uppercase tracking-wider animate-pulse">
          ● {isUnlimited ? "Live / Active" : "Live Now"}
        </span>
      );
    }
    if (diffMins > 0 && diffMins <= 60) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#f59e0b] font-mono text-[10px] font-bold">
          In {diffMins} mins
        </span>
      );
    }
    if (diffMins > 60 && diffMins <= 1440) {
      const hours = Math.round(diffMins / 60);
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-[#1e1c17] border border-[#f3eee6]/15 text-[#a39e94] font-mono text-[10px]">
          In {hours} hrs
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full bg-[#1e1c17] border border-[#f3eee6]/15 text-[#a39e94] font-mono text-[10px]">
        Scheduled
      </span>
    );
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-[#f3eee6]">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#f3eee6]/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f3eee6]">My Schedule</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-[#0284c7]/20 border border-[#0284c7]/40 text-[#38bdf8] text-xs font-mono font-semibold">
              Live Agenda
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#a39e94]">
            Manage your scheduled live classes, student invitations, and calendar sessions.
          </p>
        </div>

        {/* Schedule Class CTA (for Tutors) */}
        {profile?.role === "tutor" && (
          <button
            onClick={onOpenScheduleModal}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:from-[#d97706] hover:to-[#b45309] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Schedule Class</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-[#f3eee6]/10 pb-3 flex-wrap">
        <button
          onClick={() => setActiveFilter("upcoming")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
            activeFilter === "upcoming"
              ? "bg-[#0284c7]/20 text-[#38bdf8] border border-[#0284c7]/40"
              : "text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#161512]"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Upcoming Classes</span>
          <span className="px-1.5 py-0.2 rounded-full bg-[#161512] text-[10px] font-mono">
            {allUpcoming.length}
          </span>
        </button>

        {/* Invitations Tab: Strictly displays Pending invitations requiring user action */}
        <button
          onClick={() => setActiveFilter("invites")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
            activeFilter === "invites"
              ? "bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40"
              : "text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#161512]"
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>Invitations</span>
          {pendingInvites.length > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full bg-[#f59e0b] text-[#0e0d0b] text-[10px] font-bold animate-pulse">
              {pendingInvites.length}
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full bg-[#161512] text-[10px] font-mono text-[#a39e94]">
              0
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveFilter("past")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
            activeFilter === "past"
              ? "bg-[#1e1c17] text-[#f3eee6] border border-[#f3eee6]/25"
              : "text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#161512]"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Past Classes</span>
          <span className="px-1.5 py-0.2 rounded-full bg-[#161512] text-[10px] font-mono">
            {pastClasses.length}
          </span>
        </button>
      </div>

      {/* Content Rendering */}
      {isLoading ? (
        <div className="py-16 text-center text-xs text-[#a39e94]">
          <div className="w-8 h-8 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin mx-auto mb-3" />
          <span>Loading your schedule...</span>
        </div>
      ) : activeFilter === "upcoming" ? (
        allUpcoming.length === 0 ? (
          <div className="py-16 text-center bg-[#161512]/60 border border-[#f3eee6]/10 rounded-3xl p-8 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-[#0284c7]/15 text-[#38bdf8] border border-[#0284c7]/30 flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#f3eee6]">No Upcoming Classes</h3>
            <p className="text-xs text-[#a39e94] mt-1.5 mb-5">
              {profile?.role === "tutor"
                ? "You don't have any classes scheduled yet. Create your first live class session and invite students."
                : "You don't have any classes scheduled. When a tutor invites you to a class, it will appear here."}
            </p>
            {profile?.role === "tutor" && (
              <button
                onClick={onOpenScheduleModal}
                className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold transition cursor-pointer shadow-md shadow-[#f59e0b]/20"
              >
                Schedule First Class
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {allUpcoming.map((c) => {
              const isTutor = c.tutor_id === profile?.id;
              return (
                <div
                  key={c.id}
                  className="p-5 rounded-2xl bg-[#161512] border border-[#f3eee6]/10 hover:border-[#f3eee6]/20 transition-all shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-bold text-base text-[#f3eee6] truncate">{c.title}</span>
                      {c.subject && (
                        <span className="px-2 py-0.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 text-[10px] font-semibold">
                          {c.subject}
                        </span>
                      )}
                      {getTimeRelativeBadge(c.scheduled_at, c.duration_minutes)}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[#a39e94] flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#f59e0b]" />
                        <span>{formatScheduleTime(c.scheduled_at, c.duration_minutes)}</span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1.5">
                        <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
                        <span>Host: {isTutor ? "You" : c.tutor_name || "Tutor"}</span>
                      </div>
                    </div>

                    {c.description && (
                      <p className="text-xs text-[#a39e94] mt-2 line-clamp-1 italic">{c.description}</p>
                    )}

                    {/* Attendee Badges for Tutor */}
                    {isTutor && c.attendees && c.attendees.length > 0 && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#f3eee6]/08 flex-wrap">
                        <span className="text-[11px] font-medium text-[#a39e94] flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span>Students ({c.attendees.length}):</span>
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {c.attendees.map((att) => {
                            const isAcc = att.rsvp_status === "accepted";
                            const isDec = att.rsvp_status === "declined";
                            return (
                              <span
                                key={att.email}
                                title={`${att.email} • ${att.rsvp_status.toUpperCase()}`}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                                  isAcc
                                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                                    : isDec
                                    ? "bg-red-500/15 border-red-500/30 text-red-400"
                                    : "bg-[#221f1a] border-amber-500/30 text-amber-400"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isAcc
                                      ? "bg-emerald-400"
                                      : isDec
                                      ? "bg-red-400"
                                      : "bg-amber-400 animate-pulse"
                                  }`}
                                />
                                <span className="truncate max-w-[120px]">{att.user_name || att.email}</span>
                                <span className="text-[9px] font-mono opacity-80">
                                  {isAcc ? "✓" : isDec ? "✕" : "?"}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#f3eee6]/08 flex-wrap">
                    <button
                      onClick={() => handleCopyLink(c.room_code)}
                      title="Copy Class Invite Link"
                      className="p-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                    >
                      {copiedCode === c.room_code ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>

                    {isTutor && (
                      <button
                        onClick={() => handleCancelClass(c.id, c.title)}
                        title="Cancel Class"
                        className="p-2.5 rounded-xl bg-[#221f1a] hover:bg-red-500/15 border border-[#f3eee6]/10 text-[#a39e94] hover:text-red-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    {!isTutor && c.invite_token && (
                      <button
                        onClick={() => handleRespondInvite(c.invite_token!, "declined")}
                        disabled={respondingToken === c.invite_token}
                        title="Decline / Can't Attend"
                        className="px-3 py-2.5 rounded-xl bg-[#221f1a] hover:bg-red-500/15 border border-[#f3eee6]/10 text-xs font-semibold text-[#a39e94] hover:text-red-400 transition cursor-pointer disabled:opacity-50"
                      >
                        Decline
                      </button>
                    )}

                    <button
                      onClick={() => onStartMeeting(c.room_code, isTutor ? "tutor" : "student")}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md ${
                        isTutor
                          ? "bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] shadow-[#f59e0b]/20"
                          : "bg-emerald-500 hover:bg-emerald-400 text-[#0e0d0b] shadow-emerald-500/20"
                      }`}
                    >
                      <Video className="w-4 h-4" />
                      <span>{isTutor ? "Start Class" : "Join Class"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeFilter === "invites" ? (
        /* Invitations Tab: Strictly displays Pending invitations awaiting response */
        pendingInvites.length === 0 ? (
          <div className="py-16 text-center bg-[#161512]/60 border border-[#f3eee6]/10 rounded-3xl p-8 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#f3eee6]">No Pending Invitations</h3>
            <p className="text-xs text-[#a39e94] mt-1.5">
              All caught up! Accepted classes appear directly under your Upcoming Classes tab.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingInvites.map((c) => {
              const isBusy = respondingToken === c.invite_token;

              return (
                <div
                  key={c.id}
                  className="p-5 rounded-2xl bg-[#161512] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 border border-[#f59e0b]/40 shadow-lg shadow-[#f59e0b]/05"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#f59e0b] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-ping" />
                        Action Required: Pending Invitation
                      </span>

                      {c.subject && (
                        <span className="px-2 py-0.5 rounded-full bg-[#1e1c17] text-[#f59e0b] border border-[#f59e0b]/20 text-[10px] font-semibold">
                          {c.subject}
                        </span>
                      )}
                      {getTimeRelativeBadge(c.scheduled_at, c.duration_minutes)}
                    </div>

                    <h3 className="text-base font-bold text-[#f3eee6] mb-1 truncate">{c.title}</h3>

                    <div className="flex items-center gap-3 text-xs text-[#a39e94] flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#f59e0b]" />
                        <span>{formatScheduleTime(c.scheduled_at, c.duration_minutes)}</span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1.5">
                        <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
                        <span>Host: {c.tutor_name || "Tutor"}</span>
                      </div>
                    </div>

                    {c.description && (
                      <p className="text-xs text-[#a39e94] mt-2 line-clamp-1 italic">{c.description}</p>
                    )}
                  </div>

                  {/* Actions: Decline or Accept */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#f3eee6]/08 flex-wrap">
                    <button
                      onClick={() => c.invite_token && handleRespondInvite(c.invite_token, "declined")}
                      disabled={isBusy}
                      className="px-4 py-2 rounded-xl bg-[#221f1a] hover:bg-red-500/15 border border-[#f3eee6]/15 hover:border-red-500/30 text-xs font-semibold text-[#a39e94] hover:text-red-400 transition cursor-pointer disabled:opacity-50"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => c.invite_token && handleRespondInvite(c.invite_token, "accepted")}
                      disabled={isBusy}
                      className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0e0d0b] text-xs font-bold transition cursor-pointer shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isBusy ? (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-[#0e0d0b] border-t-transparent animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      )}
                      <span>Accept & Add to Schedule</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Past Classes Tab */
        <div className="space-y-3">
          {pastClasses.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#a39e94]">No past classes recorded.</div>
          ) : (
            pastClasses.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-xl bg-[#161512]/60 border border-[#f3eee6]/08 flex items-center justify-between opacity-75"
              >
                <div>
                  <h4 className="text-sm font-semibold text-[#f3eee6] line-through decoration-[#a39e94]/50">
                    {c.title}
                  </h4>
                  <p className="text-xs text-[#a39e94]">
                    {formatScheduleTime(c.scheduled_at, c.duration_minutes)}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-[#1e1c17] text-[10px] font-mono text-[#a39e94]">
                  {c.status === "cancelled" ? "Cancelled" : "Completed"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

