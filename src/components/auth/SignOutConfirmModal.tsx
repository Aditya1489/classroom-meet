import React, { useEffect } from "react";
import { LogOut, X, AlertTriangle } from "lucide-react";

interface SignOutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  userName?: string;
  userRole?: string;
  avatarUrl?: string;
  isLoading?: boolean;
}

export const SignOutConfirmModal: React.FC<SignOutConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  userName,
  userRole,
  avatarUrl,
  isLoading = false,
}) => {
  // Handle keyboard Escape to cancel
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signout-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200 select-none"
      onClick={() => {
        if (!isLoading) onClose();
      }}
    >
      <div
        className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto shadow-2xl text-[#f3eee6] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f3eee6]/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center shadow-md">
              <LogOut className="w-4 h-4" />
            </div>
            <div>
              <h2 id="signout-modal-title" className="font-serif text-lg font-normal text-[#f3eee6]">
                Sign Out
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-[#a39e94] hover:text-[#f3eee6] p-1.5 rounded-lg hover:bg-[#25221b] transition cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-[#a39e94] leading-relaxed">
            Are you sure you want to sign out of <strong className="text-[#f3eee6]">Mathsy Meet</strong>?
          </p>

          {/* Account Profile Summary Card */}
          {userName && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-[#14120e] border border-[#f3eee6]/10">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={userName}
                  className="w-9 h-9 rounded-full object-cover border border-[#f59e0b]/40 shadow-sm shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#f59e0b] text-[#0e0d0b] flex items-center justify-center font-bold text-xs shrink-0">
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[#f3eee6] truncate">{userName}</div>
                {userRole && (
                  <div className="text-[10px] text-[#f59e0b] font-mono uppercase font-semibold">
                    {userRole === "tutor" ? "Tutor (Host)" : "Student"}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>You will need to sign in with Google again to start or join live classes.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[#14120e] border-t border-[#f3eee6]/[0.08]">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl bg-transparent hover:bg-[#25221b] border border-[#f3eee6]/15 text-xs font-medium text-[#f3eee6] transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-md shadow-red-950/40 flex items-center gap-1.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isLoading ? "Signing Out..." : "Sign Out"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

