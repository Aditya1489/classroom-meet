import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Mail,
  Plus,
  X,
  Sparkles,
  BookOpen,
  GraduationCap,
  Users,
  AlertCircle,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/authContext";

export interface InviteeItem {
  email: string;
  name?: string;
  avatarUrl?: string;
  isRegistered?: boolean;
}

interface ScheduleClassModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClassScheduled?: () => void;
}

export const ScheduleClassModal: React.FC<ScheduleClassModalProps> = ({
  isOpen,
  onClose,
  onClassScheduled,
}) => {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(0); // 0 = Unlimited Duration (No Time Limit)
  const [description, setDescription] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<InviteeItem[]>([]);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduledResult, setScheduledResult] = useState<{
    roomCode: string;
    shareUrl: string;
    inviteCount: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const resetForm = () => {
    setTitle("");
    setSubject("");
    setDate("");
    setTime("");
    setDurationMinutes(0);
    setDescription("");
    setEmailInput("");
    setEmailError(null);
    setInvitees([]);
    setScheduledResult(null);
    setCopied(false);
  };

  // Reset form cleanly whenever the modal is opened afresh
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Support closing modal on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting]);

  const handleClose = () => {
    resetForm();
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
    onClose();
  };

  const inviteeEmails = invitees.map((i) => i.email);

  if (!isOpen) return null;

  // Add & verify Google email tag
  const handleAddEmail = async () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!trimmed.includes("@") || !trimmed.includes(".") || trimmed.length < 5) {
      const msg = "Invalid email ID: Please enter a valid email address (e.g. name@gmail.com).";
      setEmailError(msg);
      toast.error(msg);
      return;
    }
    if (invitees.some((i) => i.email === trimmed)) {
      toast.info("This email is already added");
      setEmailInput("");
      setEmailError(null);
      return;
    }

    setIsVerifyingEmail(true);
    setEmailError(null);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      const res = await fetch("/api/classes/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to verify email");
      }

      const data = await res.json();
      const v = data.verification;

      if (!v || !v.valid) {
        const rawMsg = v?.message || "The Google account does not exist. Please check for typos.";
        const msg = rawMsg.toLowerCase().startsWith("invalid email id")
          ? rawMsg
          : `Invalid email ID: ${rawMsg}`;
        setEmailError(msg);
        toast.error(msg);
        return;
      }

      setEmailError(null);
      setInvitees((prev) => [
        ...prev,
        {
          email: v.email,
          name: v.name,
          avatarUrl: v.avatarUrl,
          isRegistered: v.isRegistered,
        },
      ]);
      setEmailInput("");
      toast.success(
        v.isRegistered
          ? `Verified Mathsy user: ${v.name || v.email}`
          : "Verified Google Account!"
      );
    } catch (err: any) {
      const rawMsg = err.message || "Could not verify email with Google";
      const msg = rawMsg.toLowerCase().startsWith("invalid email id")
        ? rawMsg
        : `Invalid email ID: ${rawMsg}`;
      setEmailError(msg);
      toast.error(msg);
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const handleKeyDownEmail = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddEmail();
    }
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setInvitees(invitees.filter((i) => i.email !== emailToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a class title");
      return;
    }
    if (!date || !time) {
      toast.error("Please select a date and time for the class");
      return;
    }

    const scheduledDateTime = new Date(`${date}T${time}`);
    if (isNaN(scheduledDateTime.getTime())) {
      toast.error("Invalid date or time");
      return;
    }

    // Reject past date or time with a 5-minute grace window for sessions starting immediately
    if (scheduledDateTime.getTime() < Date.now() - 5 * 60000) {
      toast.error("Cannot schedule a class in the past. Please select a future date and time.");
      return;
    }

    let finalInvitees = [...inviteeEmails];

    // If an email is typed in the input without clicking "+ Add", verify and validate it first
    if (emailInput.trim()) {
      const trimmed = emailInput.trim().toLowerCase();
      if (!trimmed.includes("@") || !trimmed.includes(".") || trimmed.length < 5) {
        const msg = "Invalid email ID: Please enter a valid email address (e.g. name@gmail.com).";
        setEmailError(msg);
        toast.error(msg);
        return;
      }

      setIsVerifyingEmail(true);
      try {
        const token = localStorage.getItem("mathsy_meet_token");
        const res = await fetch("/api/classes/verify-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token ? `Bearer ${token}` : "",
          },
          body: JSON.stringify({ email: trimmed }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to verify email");
        }

        const data = await res.json();
        const v = data.verification;

        if (!v || !v.valid) {
          const rawMsg = v?.message || "The Google account does not exist. Please check for typos.";
          const msg = rawMsg.toLowerCase().startsWith("invalid email id")
            ? rawMsg
            : `Invalid email ID: ${rawMsg}`;
          setEmailError(msg);
          toast.error(msg);
          return;
        }

        finalInvitees = Array.from(new Set([...finalInvitees, v.email]));
        setInvitees((prev) => [
          ...prev,
          {
            email: v.email,
            name: v.name,
            avatarUrl: v.avatarUrl,
            isRegistered: v.isRegistered,
          },
        ]);
        setEmailInput("");
        setEmailError(null);
      } catch (err: any) {
        const rawMsg = err.message || "Could not verify email with Google";
        const msg = rawMsg.toLowerCase().startsWith("invalid email id")
          ? rawMsg
          : `Invalid email ID: ${rawMsg}`;
        setEmailError(msg);
        toast.error(msg);
        return;
      } finally {
        setIsVerifyingEmail(false);
      }
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      const res = await fetch("/api/classes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          title: title.trim(),
          subject: subject.trim() || undefined,
          description: description.trim() || undefined,
          scheduledAt: scheduledDateTime.toISOString(),
          durationMinutes,
          inviteeEmails: finalInvitees,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to schedule class");
      }

      const data = await res.json();
      const shareUrl = `${window.location.origin}/meet/${data.schedule.room_code}`;
      setScheduledResult({
        roomCode: data.schedule.room_code,
        shareUrl,
        inviteCount: inviteeEmails.length,
      });

      toast.success(
        inviteeEmails.length > 0
          ? `Class scheduled! Email invites sent to ${inviteeEmails.length} students.`
          : "Class scheduled successfully!"
      );

      // Immediately notify all schedule views to fetch latest schedule in real time
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

      if (onClassScheduled) {
        onClassScheduled();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to schedule class");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyShareUrl = () => {
    if (scheduledResult?.shareUrl) {
      navigator.clipboard.writeText(scheduledResult.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Class link copied to clipboard");
    }
  };

  // Get minimum date (today) for date picker
  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 cursor-pointer select-none"
      onClick={() => {
        if (!isSubmitting) handleClose();
      }}
    >
      <div
        className="relative w-full max-w-lg bg-[#161512] border border-[#f3eee6]/15 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] overflow-hidden text-[#f3eee6] cursor-default select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-[#f3eee6]/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#f3eee6]">Schedule Class & Send Invites</h2>
              <p className="text-xs text-[#a39e94]">Plan upcoming live lessons with calendar sync</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-[#f3eee6]/10 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Confirmation Card */}
        {scheduledResult ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Check className="w-7 h-7 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#f3eee6]">Class Scheduled!</h3>
              <p className="text-xs text-[#a39e94] mt-1 max-w-sm mx-auto">
                {scheduledResult.inviteCount > 0
                  ? `Email invitations with calendar attachments (.ics) and RSVP buttons have been dispatched to ${scheduledResult.inviteCount} invitee(s).`
                  : "Your class room has been created and saved to My Schedule."}
              </p>
            </div>

            {scheduledResult.inviteCount > 0 && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-left max-w-md mx-auto">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-0.5">
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Email Invites Dispatched Automatically</span>
                </div>
                <p className="text-[11px] text-[#a39e94]">
                  Your students have received their invitation email with calendar sync (.ics) and RSVP buttons. No manual sharing required.
                </p>
              </div>
            )}

            {/* Optional Room Link Box */}
            <div className="space-y-1.5 max-w-md mx-auto">
              <span className="text-[11px] text-[#a39e94] block text-left">
                {scheduledResult.inviteCount > 0
                  ? "Optional: Direct classroom link (for WhatsApp / chat)"
                  : "Classroom Join Link"}
              </span>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#221f1a] border border-[#f3eee6]/10">
                <span className="text-xs font-mono text-[#f3eee6] truncate flex-1 text-left px-2">
                  {scheduledResult.shareUrl}
                </span>
                <button
                  onClick={copyShareUrl}
                  className="px-3 py-1.5 rounded-lg bg-[#2c2720] hover:bg-[#383228] border border-[#f3eee6]/15 text-[#f3eee6] hover:text-[#f59e0b] text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            <div className="pt-3 flex flex-col sm:flex-row gap-2">
              <button
                onClick={resetForm}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:from-[#d97706] hover:to-[#b45309] text-[#0e0d0b] text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-[#f59e0b]/20"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Schedule Another Class</span>
              </button>
              <button
                onClick={handleClose}
                className="flex-1 py-3 px-4 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/10 text-xs font-semibold text-[#f3eee6] transition cursor-pointer"
              >
                Done & View My Schedule
              </button>
            </div>
          </div>
        ) : (
          /* Scheduling Form */
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
                Class Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Grade 11 Calculus: Limits & Derivatives"
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#1e1c17] border border-[#f3eee6]/15 focus:border-[#f59e0b] text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition"
              />
            </div>

            {/* Subject (Optional) */}
            <div>
              <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
                Subject / Topic <span className="text-[#a39e94] font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Mathematics, Geometry, Physics"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#1e1c17] border border-[#f3eee6]/15 focus:border-[#f59e0b] text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition"
              />
            </div>

            {/* Date & Time Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
                  Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  min={todayStr}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#1e1c17] border border-[#f3eee6]/15 focus:border-[#f59e0b] text-xs text-[#f3eee6] focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
                  Time <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#1e1c17] border border-[#f3eee6]/15 focus:border-[#f59e0b] text-xs text-[#f3eee6] focus:outline-none transition"
                />
              </div>
            </div>

            {/* Duration Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#f3eee6]">
                  Class Duration
                </label>
                <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Unlimited by default
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={() => setDurationMinutes(0)}
                  className={`col-span-2 py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    durationMinutes === 0
                      ? "bg-[#f59e0b]/20 border-[#f59e0b] text-[#f59e0b] shadow-sm shadow-[#f59e0b]/20"
                      : "bg-[#1e1c17] border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#25221d]"
                  }`}
                >
                  <span className="text-sm">♾️</span>
                  <span>No Limit</span>
                </button>
                {[45, 60, 90].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDurationMinutes(mins)}
                    className={`py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      durationMinutes === mins
                        ? "bg-[#f59e0b]/20 border-[#f59e0b] text-[#f59e0b]"
                        : "bg-[#1e1c17] border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f3eee6] hover:bg-[#25221d]"
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#a39e94] mt-1.5">
                {durationMinutes === 0
                  ? "Classes run until you finish. Zero cutoffs, time limits, or forced endings."
                  : `Estimated calendar slot set to ${durationMinutes} mins (class will still not auto-end).`}
              </p>
            </div>

            {/* Invitee Email Multi-Input with Live Google Account Verification */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#f3eee6] flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span>Invite Students via Email</span>
                </label>
                <span className="text-[11px] text-[#a39e94] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                  Verified Google account required
                </span>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail
                    className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${
                      emailError ? "text-red-400" : "text-[#a39e94]"
                    }`}
                  />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => {
                      setEmailInput(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    onKeyDown={handleKeyDownEmail}
                    disabled={isVerifyingEmail}
                    placeholder="Enter student Gmail or Google Workspace email"
                    className={`w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#1e1c17] text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition disabled:opacity-60 border ${
                      emailError
                        ? "border-red-500/80 ring-1 ring-red-500/30 bg-red-500/[0.04]"
                        : "border-[#f3eee6]/15 focus:border-[#f59e0b]"
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddEmail}
                  disabled={isVerifyingEmail || !emailInput.trim()}
                  className="px-3.5 py-2.5 rounded-xl bg-[#221f1a] hover:bg-[#2c2720] border border-[#f3eee6]/15 text-xs font-semibold text-[#f3eee6] transition flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isVerifyingEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f59e0b]" />
                      <span className="text-[#f59e0b]">Verifying...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </>
                  )}
                </button>
              </div>

              {/* Prominent Inline Invalid Email Alert Banner */}
              {emailError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs text-red-400 mt-2 bg-red-500/10 border border-red-500/30 px-3 py-2.5 rounded-xl animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-red-400 block">Invalid Email ID</span>
                    <span className="text-[11px] text-red-300/90 leading-relaxed block mt-0.5">
                      {emailError.replace(/^Invalid email ID:\s*/i, "")}
                    </span>
                  </div>
                </div>
              )}

              {/* Email Tag Pills */}
              {invitees.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {invitees.map((item) => (
                    <span
                      key={item.email}
                      className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-[#f3eee6] font-medium shadow-sm"
                    >
                      {/* Google G Logo Badge */}
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      {item.avatarUrl && (
                        <img
                          src={item.avatarUrl}
                          alt={item.name || item.email}
                          className="w-3.5 h-3.5 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <span>{item.name ? `${item.name} (${item.email})` : item.email}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEmail(item.email)}
                        className="p-0.5 hover:bg-[#f3eee6]/15 rounded-full transition cursor-pointer text-[#a39e94] hover:text-[#f3eee6]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Description / Agenda */}
            <div>
              <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
                Class Agenda / Notes <span className="text-[#a39e94] font-normal">(Optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="e.g. Please bring geometry compass and graph paper. We will cover exercise 4.2."
                className="w-full px-3.5 py-2 rounded-xl bg-[#1e1c17] border border-[#f3eee6]/15 focus:border-[#f59e0b] text-xs text-[#f3eee6] placeholder-[#a39e94] focus:outline-none transition resize-none"
              />
            </div>

            {/* Submit Action */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:from-[#d97706] hover:to-[#b45309] text-[#0e0d0b] text-xs font-bold shadow-lg shadow-[#f59e0b]/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Scheduling Class & Sending Invites...</span>
                ) : (
                  <>
                    <Calendar className="w-4 h-4 text-[#0e0d0b]" />
                    <span>Schedule Class & Send Invites</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

