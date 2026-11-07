import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  GraduationCap,
  Check,
  X,
  AlertCircle,
  Video,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";

interface ClassInviteViewProps {
  token: string;
  onNavigateHome: () => void;
  onEnterMeeting: (roomCode: string, role?: "tutor" | "student") => void;
}

export const ClassInviteView: React.FC<ClassInviteViewProps> = ({
  token,
  onNavigateHome,
  onEnterMeeting,
}) => {
  const { user, profile, isAuthenticated, signInWithGoogle } = useAuth();
  const [inviteData, setInviteData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  const [hasDeclined, setHasDeclined] = useState(false);

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialAction = urlParams?.get("action");
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(initialAction === "decline");

  const handleAcceptInvite = async () => {
    setIsSubmitting(true);
    try {
      const authToken = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`/api/classes/invite/${token}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ status: "accepted" }),
      });

      if (res.ok) {
        setHasAccepted(true);
        setHasDeclined(false);
        setShowDeclineConfirm(false);
        toast.success("Invitation accepted! Added to My Schedule.");
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
        toast.error(err.error || "Failed to accept invitation");
      }
    } catch {
      toast.error("Failed to reach server");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/classes/invite/${token}`);
        if (res.ok) {
          const data = await res.json();
          setInviteData(data.invite);
          if (data.invite.rsvp_status === "accepted") {
            setHasAccepted(true);
          } else if (data.invite.rsvp_status === "declined") {
            setHasDeclined(true);
          } else if (initialAction === "accept") {
            // Auto-accept directly when opened from email "Accept" button
            handleAcceptInvite();
          }
        } else {
          toast.error("Invitation not found or link has expired");
        }
      } catch (err) {
        console.error("[ClassInviteView] Error fetching invite:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleDeclineInvite = async () => {
    setIsSubmitting(true);
    try {
      const authToken = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`/api/classes/invite/${token}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ status: "declined" }),
      });

      if (res.ok) {
        setHasDeclined(true);
        setHasAccepted(false);
        setShowDeclineConfirm(false);
        toast.info("Invitation declined.");
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
        toast.error(err.error || "Failed to decline invitation");
      }
    } catch {
      toast.error("Failed to reach server");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin mx-auto mb-3" />
          <span className="text-xs text-[#a39e94]">Loading class invitation...</span>
        </div>
      </div>
    );
  }

  if (!inviteData) {
    return (
      <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#161512] border border-[#f3eee6]/15 rounded-3xl p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#f3eee6]">Invitation Expired or Invalid</h2>
          <p className="text-xs text-[#a39e94] mt-2 mb-6">
            This invitation link could not be found. It may have been cancelled by the tutor or already used.
          </p>
          <button
            onClick={onNavigateHome}
            className="px-5 py-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition cursor-pointer"
          >
            Go to Mathsy Meet Home
          </button>
        </div>
      </div>
    );
  }

  const scheduledDate = new Date(inviteData.scheduled_at);
  const formattedDate = scheduledDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = scheduledDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex items-center justify-center p-4 selection:bg-[#f59e0b]/30">
      <div className="max-w-md w-full bg-[#161512] border border-[#f3eee6]/15 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* Top Header Badge */}
        <div className="p-6 pb-4 border-b border-[#f3eee6]/10 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-xs font-mono font-bold text-[#f59e0b] mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Class Invitation</span>
          </div>

          <div className="relative w-14 h-14 mx-auto mb-3">
            {inviteData.tutor_avatar ? (
              <img
                src={inviteData.tutor_avatar}
                alt={inviteData.tutor_name || "Tutor"}
                className="w-14 h-14 rounded-full object-cover ring-2 ring-[#f59e0b]/50 mx-auto"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center font-bold text-xl mx-auto">
                {inviteData.tutor_name?.charAt(0) || "T"}
              </div>
            )}
          </div>

          <h2 className="text-lg font-bold text-[#f3eee6]">{inviteData.tutor_name} invited you</h2>
          <p className="text-xs text-[#a39e94] mt-0.5">to join an interactive live math classroom</p>
        </div>

        {/* Class Details Card */}
        <div className="p-6 space-y-4">
          <div className="p-4 rounded-2xl bg-[#1e1c17] border border-[#f3eee6]/10">
            <h3 className="text-base font-bold text-[#f3eee6] mb-1">{inviteData.title}</h3>
            {inviteData.subject && (
              <span className="inline-block px-2 py-0.5 rounded-full bg-[#0284c7]/20 border border-[#0284c7]/40 text-[#38bdf8] text-[10px] font-semibold mb-3">
                {inviteData.subject}
              </span>
            )}

            <div className="space-y-2 pt-2 border-t border-[#f3eee6]/08 text-xs text-[#a39e94]">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span className="text-[#f3eee6] font-medium">{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span className="text-[#f3eee6] font-medium">
                  {inviteData.duration_minutes > 0
                    ? `${formattedTime} (${inviteData.duration_minutes}m)`
                    : `${formattedTime} • Unlimited Duration ♾️`}
                </span>
              </div>
            </div>

            {inviteData.description && (
              <div className="mt-3 pt-3 border-t border-[#f3eee6]/08 text-xs text-[#a39e94] italic">
                "{inviteData.description}"
              </div>
            )}
          </div>

          {/* RSVP Status / Actions */}
          {inviteData.class_status === "cancelled" ? (
            <div className="space-y-3 text-center">
              <div className="p-4 rounded-xl bg-red-500/15 border border-red-500/30">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-red-400 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>Class Has Been Cancelled</span>
                </div>
                <p className="text-[11px] text-[#a39e94]">
                  This scheduled session was cancelled by the host tutor and is no longer active.
                </p>
              </div>
              <button
                onClick={onNavigateHome}
                className="w-full py-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition cursor-pointer"
              >
                Return to Mathsy Meet Home
              </button>
            </div>
          ) : hasAccepted ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-400 mb-1">
                  <Check className="w-4 h-4" />
                  <span>Invitation Accepted!</span>
                </div>
                <p className="text-[11px] text-[#a39e94]">
                  Your attendance has been confirmed with the host tutor.
                </p>
              </div>

              {isAuthenticated ? (
                <button
                  onClick={() => onEnterMeeting(inviteData.room_code, "student")}
                  className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0e0d0b] text-xs font-bold shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Video className="w-4 h-4" />
                  <span>Enter Classroom Now</span>
                </button>
              ) : (
                <button
                  onClick={() =>
                    signInWithGoogle({
                      type: "accept_invite",
                      inviteToken: token,
                      returnUrl: `/invite/${token}?action=accept`,
                    })
                  }
                  className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0e0d0b] text-xs font-bold shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Video className="w-4 h-4" />
                  <span>Sign in with Google & Enter Classroom</span>
                </button>
              )}

              <button
                onClick={onNavigateHome}
                className="w-full py-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition cursor-pointer"
              >
                {isAuthenticated ? "Go to My Schedule" : "Go to Mathsy Meet Home"}
              </button>
            </div>
          ) : hasDeclined ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-red-400 mb-1">
                  <X className="w-4 h-4" />
                  <span>Invitation Declined</span>
                </div>
                <p className="text-[11px] text-[#a39e94]">
                  You have marked yourself as not attending this class.
                </p>
              </div>

              <button
                onClick={handleAcceptInvite}
                disabled={isSubmitting}
                className="w-full py-3 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/15 hover:border-[#f59e0b]/40 text-xs font-semibold text-[#f3eee6] transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Changed your mind? Accept Invitation</span>
              </button>

              <button
                onClick={onNavigateHome}
                className="w-full py-2.5 rounded-xl bg-transparent hover:bg-[#221f1a] text-xs font-semibold text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
              >
                Return to Mathsy Meet Home
              </button>
            </div>
          ) : showDeclineConfirm ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-[#1e1c17] border border-red-500/30 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-red-400 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>Decline Class Invitation?</span>
                </div>
                <p className="text-[11px] text-[#a39e94]">
                  Are you sure you cannot attend? The tutor will be notified.
                </p>
              </div>

              <button
                onClick={handleDeclineInvite}
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                <span>{isSubmitting ? "Declining..." : "Confirm Decline"}</span>
              </button>

              <button
                onClick={() => setShowDeclineConfirm(false)}
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition cursor-pointer"
              >
                Cancel / Keep Invitation
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <button
                onClick={handleAcceptInvite}
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:from-[#d97706] hover:to-[#b45309] text-[#0e0d0b] text-xs font-bold shadow-md shadow-[#f59e0b]/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 rounded-full border-2 border-[#0e0d0b] border-t-transparent animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>{isSubmitting ? "Accepting..." : "Accept Invitation & RSVP"}</span>
              </button>

              <button
                onClick={() => setShowDeclineConfirm(true)}
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-[#1e1c17] hover:bg-red-500/10 border border-[#f3eee6]/10 hover:border-red-500/30 text-xs font-semibold text-[#a39e94] hover:text-red-400 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                <span>Decline Invitation</span>
              </button>

              <button
                onClick={onNavigateHome}
                className="w-full py-1.5 text-center text-[11px] text-[#736e65] hover:text-[#a39e94] transition cursor-pointer"
              >
                Cancel / Return Home
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

