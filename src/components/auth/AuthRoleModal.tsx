import React, { useState } from "react";
import { GraduationCap, BookOpen, X, Check, ShieldCheck, Sparkles } from "lucide-react";

interface AuthRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinueWithGoogle?: (role: "tutor" | "student") => void;
  onDirectSignIn?: () => void;
  onUpdateRole?: (role: "tutor" | "student") => void;
  isLoggedIn?: boolean;
  isOnboarding?: boolean;
  defaultRole?: "tutor" | "student";
  title?: string;
  subtitle?: string;
}

export const AuthRoleModal: React.FC<AuthRoleModalProps> = ({
  isOpen,
  onClose,
  onContinueWithGoogle,
  onDirectSignIn,
  onUpdateRole,
  isLoggedIn = false,
  isOnboarding = false,
  defaultRole = "tutor",
  title,
  subtitle,
}) => {
  const [selectedRole, setSelectedRole] = useState<"tutor" | "student">(defaultRole);

  React.useEffect(() => {
    setSelectedRole(defaultRole);
  }, [defaultRole, isOpen]);

  if (!isOpen) return null;

  const modalTitle =
    title ||
    (isLoggedIn && !isOnboarding
      ? "Switch Your Active Role"
      : isOnboarding
      ? "Choose Your Role to Complete Setup"
      : "Create your Mathsy Meet Account");

  const modalSubtitle =
    subtitle ||
    (isLoggedIn && !isOnboarding
      ? "Update your default role between Tutor and Student for your session."
      : isOnboarding
      ? "Welcome to Mathsy Meet! Pick how you will use the platform. Your choice is remembered so you won't be asked on future logins."
      : "Select your role to sign up. Once created, your role is saved permanently—when you log in next time, you will never be asked again.");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl text-[#f3eee6]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f3eee6]/[0.08]">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
            <h2 className="font-serif text-xl font-normal text-[#f3eee6]">
              {modalTitle}
            </h2>
          </div>
          {!isOnboarding && (
            <button
              onClick={onClose}
              className="p-1.5 text-[#a39e94] hover:text-[#f3eee6] rounded-full hover:bg-white/5 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="text-center sm:text-left space-y-1">
            <span className="section-label">
              {isOnboarding ? "FIRST-TIME ONBOARDING" : isLoggedIn ? "ACCOUNT SETTINGS" : "SIGN UP · ONE-TIME ROLE SELECTION"}
            </span>
            <h3 className="text-base font-semibold text-[#f3eee6]">
              {isOnboarding ? "Select your primary role" : "Choose how you'll use Mathsy Meet"}
            </h3>
            <p className="text-xs text-[#a39e94] leading-relaxed">
              {modalSubtitle}
            </p>
          </div>

          {/* Role Cards */}
          <div className="space-y-3">
            {/* Tutor Option */}
            <div
              onClick={() => setSelectedRole("tutor")}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                selectedRole === "tutor"
                  ? "bg-[#f59e0b]/15 border-[#f59e0b] ring-1 ring-[#f59e0b] shadow-lg shadow-[#f59e0b]/15"
                  : "bg-[#0e0d0b] border-[#f3eee6]/10 hover:border-[#f3eee6]/25 text-[#a39e94]"
              }`}
            >
              <div
                className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                  selectedRole === "tutor" ? "bg-[#f59e0b] text-[#0e0d0b]" : "bg-white/5 text-[#a39e94]"
                }`}
              >
                <GraduationCap className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className={`text-sm font-bold ${selectedRole === "tutor" ? "text-[#f3eee6]" : "text-[#d1ccc4]"}`}>
                    Tutor / Teacher
                  </h4>
                  {selectedRole === "tutor" && <Check className="w-4 h-4 text-[#f59e0b]" />}
                </div>
                <p className="text-xs text-[#a39e94] leading-relaxed mt-1">
                  Host live classes, start instant meetings, use STEM math whiteboard with geometric instruments (ruler/compass/protractor), and manage attendees.
                </p>
                <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-[#f59e0b]">
                  <span className="px-1.5 py-0.5 rounded bg-[#f59e0b]/20">Host Meetings</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#f59e0b]/20">Whiteboard Master</span>
                </div>
              </div>
            </div>

            {/* Student Option */}
            <div
              onClick={() => setSelectedRole("student")}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                selectedRole === "student"
                  ? "bg-[#f59e0b]/15 border-[#f59e0b] ring-1 ring-[#f59e0b] shadow-lg shadow-[#f59e0b]/15"
                  : "bg-[#0e0d0b] border-[#f3eee6]/10 hover:border-[#f3eee6]/25 text-[#a39e94]"
              }`}
            >
              <div
                className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                  selectedRole === "student" ? "bg-[#f59e0b] text-[#0e0d0b]" : "bg-white/5 text-[#a39e94]"
                }`}
              >
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className={`text-sm font-bold ${selectedRole === "student" ? "text-[#f3eee6]" : "text-[#d1ccc4]"}`}>
                    Student / Learner
                  </h4>
                  {selectedRole === "student" && <Check className="w-4 h-4 text-[#f59e0b]" />}
                </div>
                <p className="text-xs text-[#a39e94] leading-relaxed mt-1">
                  Join live classes via code or invite link, interact on collaborative whiteboard activities, and submit answers to live polls.
                </p>
                <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-emerald-400">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15">Interactive Learner</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15">Instant Join</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button: Update Role if logged in/onboarding, or Continue with Google if signing up */}
          {(isLoggedIn || isOnboarding) && onUpdateRole ? (
            <button
              onClick={() => onUpdateRole(selectedRole)}
              className="w-full py-3.5 px-4 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
            >
              <Check className="w-4 h-4 text-[#0e0d0b]" />
              <span>
                {isOnboarding
                  ? `Complete Setup as ${selectedRole === "tutor" ? "Tutor" : "Student"}`
                  : `Save Role as ${selectedRole === "tutor" ? "Tutor / Teacher" : "Student / Learner"}`}
              </span>
            </button>
          ) : (
            onContinueWithGoogle && (
              <button
                onClick={() => onContinueWithGoogle(selectedRole)}
                className="w-full py-3.5 px-4 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 flex items-center justify-center gap-2.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#0e0d0b"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#0e0d0b"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#0e0d0b"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#0e0d0b"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Sign up with Google as {selectedRole === "tutor" ? "Tutor" : "Student"}</span>
              </button>
            )
          )}

          {onDirectSignIn && !isLoggedIn && !isOnboarding && (
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => onDirectSignIn()}
                className="text-xs text-[#f59e0b] hover:text-[#d97706] transition inline-flex items-center gap-1.5 cursor-pointer underline underline-offset-4 font-medium"
              >
                Already have an account? Sign in directly
              </button>
            </div>
          )}

          <div className="pt-2 text-center text-[11px] text-[#a39e94] flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Returning users log in instantly with 1-click without re-selecting roles.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
