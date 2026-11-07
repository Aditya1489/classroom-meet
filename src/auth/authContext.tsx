import React, { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  isHost?: boolean;
  role?: "tutor" | "student";
  isPlatformSuperadmin?: boolean;
  needsRoleSelection?: boolean;
}

export interface PendingAuthAction {
  type: "start_instant_class" | "open_schedule_modal" | "view_schedule" | "join_room" | "accept_invite";
  roomId?: string;
  inviteToken?: string;
  returnUrl?: string;
  role?: "tutor" | "student";
}

interface AuthContextType {
  user: UserProfile | null;
  session: { access_token: string; user: UserProfile } | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  needsOnboardingRole: boolean;
  pendingAction: PendingAuthAction | null;
  clearPendingAction: () => void;
  signInWithGoogle: (action?: PendingAuthAction) => Promise<void>;
  signUpWithGoogle: (role: "tutor" | "student", action?: PendingAuthAction) => Promise<void>;
  updateRole: (role: "tutor" | "student") => Promise<void>;
  dismissOnboardingRole: () => void;
  joinAsGuest: (guestName: string, role?: "tutor" | "student") => Promise<void>;
  signOut: () => Promise<void>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<{ access_token: string; user: UserProfile } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [needsOnboardingRole, setNeedsOnboardingRole] = useState(false);
  const isProcessingOAuthRef = React.useRef(false);

  const [pendingAction, setPendingAction] = useState<PendingAuthAction | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("mathsy_meet_pending_action");
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  const clearPendingAction = () => {
    localStorage.removeItem("mathsy_meet_pending_action");
    setPendingAction(null);
  };

  const isAuthenticated = Boolean(
    profile?.email &&
    (session?.access_token || localStorage.getItem("mathsy_meet_token")) &&
    !profile?.id?.startsWith("guest_")
  );

  // Helper to save session
  const saveSession = (user: UserProfile, token: string) => {
    setProfile(user);
    setSession({ access_token: token, user });
    if (user.needsRoleSelection) {
      setNeedsOnboardingRole(true);
    }
    localStorage.setItem("mathsy_meet_token", token);
    localStorage.setItem("mathsy_meet_user", JSON.stringify(user));
  };

  // Helper to clear session
  const clearSession = () => {
    setProfile(null);
    setSession(null);
    setNeedsOnboardingRole(false);
    setIsAuthenticating(false);
    localStorage.removeItem("mathsy_meet_token");
    localStorage.removeItem("mathsy_meet_user");
    localStorage.removeItem("mathsy_meet_guest");
    localStorage.removeItem("mathsy_meet_signup_role");
    localStorage.removeItem("mathsy_meet_auth_intent");
    localStorage.removeItem("mathsy_meet_redirect_url");
  };

  useEffect(() => {
    // 1. Check for token in URL hash/params (e.g. from Google OAuth callback)
    const hash = window.location.hash;
    if (hash && (hash.includes("access_token=") || hash.includes("id_token="))) {
      if (isProcessingOAuthRef.current) return;
      isProcessingOAuthRef.current = true;
      setIsAuthenticating(true);

      try {
        const params = new URLSearchParams(hash.substring(1));
        const idToken = params.get("id_token");
        const accessToken = params.get("access_token");

        if (idToken || accessToken) {
          const targetRedirect = localStorage.getItem("mathsy_meet_redirect_url");
          localStorage.removeItem("mathsy_meet_redirect_url");
          
          // Preserves ANY valid internal app route (e.g. /invite/:token, /meet/:code, /dashboard, etc.)
          const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";
          const dest = targetRedirect && targetRedirect.startsWith("/") && !targetRedirect.startsWith("//")
            ? targetRedirect
            : (currentPath !== "/" ? currentPath : "/");

          // Immediately strip hash from URL before making the async fetch to prevent duplicate parsing
          window.history.replaceState({}, document.title, dest);

          const signupRole = localStorage.getItem("mathsy_meet_signup_role") as ("tutor" | "student" | null);
          const authIntent = localStorage.getItem("mathsy_meet_auth_intent") || (signupRole ? "signup" : "signin");
          localStorage.removeItem("mathsy_meet_signup_role");
          localStorage.removeItem("mathsy_meet_auth_intent");

          // Optimistically parse id_token client-side in 0ms to eliminate visual delay
          if (idToken) {
            try {
              const parts = idToken.split(".");
              if (parts.length === 3) {
                const base64Url = parts[1];
                const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
                const jsonPayload = decodeURIComponent(
                  atob(base64)
                    .split("")
                    .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                    .join("")
                );
                const p = JSON.parse(jsonPayload);
                if (p?.email) {
                  const quickProfile: UserProfile = {
                    id: `tmp_${p.sub || "user"}`,
                    name: p.name || p.email.split("@")[0] || "User",
                    email: p.email,
                    avatarUrl: p.picture || "",
                    role: signupRole || "student",
                    needsRoleSelection: false,
                  };
                  setProfile(quickProfile);
                }
              }
            } catch {}
          }

          // Authenticate with verified Google credential on PostgreSQL backend with retry resiliency
          const executeAuthWithRetry = async (attempt = 1): Promise<void> => {
            try {
              const res = await fetch(`${API_BASE}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  idToken: idToken || undefined,
                  accessToken: accessToken || undefined,
                  role: authIntent === "signup" ? (signupRole || undefined) : undefined,
                }),
              });

              if (res.ok) {
                const data = await res.json();
                saveSession(data.user, data.token);

                if (data.needsRoleSelection || data.user?.needsRoleSelection) {
                  setNeedsOnboardingRole(true);
                } else {
                  setNeedsOnboardingRole(false);
                }

                window.dispatchEvent(new PopStateEvent("popstate"));
                return;
              }

              // If server responded with a 5xx error (e.g. transient proxy restart or timeout), retry once after a short delay
              if (res.status >= 500 && attempt < 2) {
                console.warn(`[Auth] Backend returned ${res.status}. Retrying in 800ms... (attempt ${attempt})`);
                await new Promise((r) => setTimeout(r, 800));
                return executeAuthWithRetry(attempt + 1);
              }

              const errData = await res.json().catch(() => ({}));
              console.error("[Auth] Server rejected Google authentication:", res.status, errData);
              toast.error(errData.error || "Failed to authenticate with Google. Please try again.");
              clearSession();
              window.dispatchEvent(new PopStateEvent("popstate"));
            } catch (err) {
              if (attempt < 2) {
                console.warn(`[Auth] Fetch failed with error. Retrying in 800ms... (attempt ${attempt})`, err);
                await new Promise((r) => setTimeout(r, 800));
                return executeAuthWithRetry(attempt + 1);
              }
              console.error("[Auth] Failed to reach auth backend:", err);
              toast.error("Authentication backend is unreachable. Please verify server connection.");
            }
          };

          executeAuthWithRetry().finally(() => {
            setLoading(false);
            setIsAuthenticating(false);
          });
          return;
        }
      } catch (err) {
        console.warn("[Auth] URL hash parse error:", err);
        setIsAuthenticating(false);
      }
    }

    // 2. Check stored JWT token with PostgreSQL /api/auth/me
    const token = localStorage.getItem("mathsy_meet_token");
    const savedUser = localStorage.getItem("mathsy_meet_user");

    if (token) {
      fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (res.ok) {
            return res.json().then((data) => {
              saveSession(data.user, token);
              if (data.needsRoleSelection || data.user?.needsRoleSelection) {
                setNeedsOnboardingRole(true);
              } else {
                setNeedsOnboardingRole(false);
              }
            });
          } else {
            // Token expired or invalid
            clearSession();
          }
        })
        .catch(() => {
          // If network glitch, tentatively keep cached user session
          if (savedUser) {
            try {
              const u = JSON.parse(savedUser);
              setProfile(u);
              setSession({ access_token: token, user: u });
              if (u.needsRoleSelection) {
                setNeedsOnboardingRole(true);
              }
            } catch {}
          }
        })
        .finally(() => setLoading(false));
    } else {
      // Remove any legacy guest state
      localStorage.removeItem("mathsy_meet_guest");
      setLoading(false);
    }

    // Listen for storage events (e.g. cross-tab sign out)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "mathsy_meet_token" && !e.newValue) {
        clearSession();
        if (typeof window !== "undefined") {
          window.location.href = "/";
          window.location.reload();
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const triggerGoogleOAuth = (
    intent: "signin" | "signup",
    role?: "tutor" | "student",
    action?: PendingAuthAction
  ) => {
    try {
      if (!GOOGLE_CLIENT_ID) {
        console.error("[Auth] Google Client ID is not configured (missing VITE_GOOGLE_CLIENT_ID in env)");
        toast.error("Google Sign-In is not configured: missing VITE_GOOGLE_CLIENT_ID in environment.");
        return;
      }

      // Check if accessing via private local network IP (e.g. 192.168.x.x, 10.x.x.x, 169.254.x.x)
      const isLocalIp = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(window.location.hostname);
      if (isLocalIp) {
        console.warn("[Auth] Google OAuth forbids private IP redirect URIs:", window.location.origin);
        toast.error(
          "Google Sign-In blocks raw local IP addresses (192.168.x.x). Please use USB Port Forwarding (localhost) or an HTTPS tunnel (localtunnel/cloudflared) to test Google login on mobile.",
          { duration: 8000 }
        );
      }

      localStorage.setItem("mathsy_meet_auth_intent", intent);
      if (role) {
        localStorage.setItem("mathsy_meet_signup_role", role);
      } else {
        localStorage.removeItem("mathsy_meet_signup_role");
      }

      // 1. Determine target return URL with full path & query
      const currentFullUrl = typeof window !== "undefined"
        ? (window.location.pathname + window.location.search)
        : "/";
      const targetUrl = action?.returnUrl || (currentFullUrl !== "/" ? currentFullUrl : "");

      if (targetUrl) {
        localStorage.setItem("mathsy_meet_redirect_url", targetUrl);
      } else {
        localStorage.removeItem("mathsy_meet_redirect_url");
      }

      // 2. Persist pending action intent
      if (action) {
        localStorage.setItem("mathsy_meet_pending_action", JSON.stringify(action));
        setPendingAction(action);
      } else if (typeof window !== "undefined" && window.location.pathname.startsWith("/invite/")) {
        const token = window.location.pathname.split("/invite/")[1]?.split("?")[0];
        if (token) {
          const autoInviteAction: PendingAuthAction = {
            type: "accept_invite",
            inviteToken: token,
            returnUrl: window.location.pathname,
          };
          localStorage.setItem("mathsy_meet_pending_action", JSON.stringify(autoInviteAction));
          setPendingAction(autoInviteAction);
        }
      } else if (typeof window !== "undefined" && window.location.pathname.startsWith("/meet/")) {
        const roomCode = window.location.pathname.split("/meet/")[1]?.split("?")[0];
        if (roomCode) {
          const autoMeetAction: PendingAuthAction = {
            type: "join_room",
            roomId: roomCode,
            returnUrl: window.location.pathname,
          };
          localStorage.setItem("mathsy_meet_pending_action", JSON.stringify(autoMeetAction));
          setPendingAction(autoMeetAction);
        }
      }

      const redirectUri = window.location.origin;
      const scope = encodeURIComponent("openid email profile");
      const nonce = Math.random().toString(36).substring(2, 15);
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&response_type=token id_token&scope=${scope}&prompt=select_account&nonce=${nonce}`;

      window.location.href = authUrl;
    } catch (err: any) {
      console.error("[Auth] Google OAuth trigger error:", err.message);
      throw err;
    }
  };

  const signInWithGoogle = async (action?: PendingAuthAction) => {
    triggerGoogleOAuth("signin", undefined, action);
  };

  const signUpWithGoogle = async (role: "tutor" | "student", action?: PendingAuthAction) => {
    triggerGoogleOAuth("signup", role, action);
  };

  const dismissOnboardingRole = () => {
    setNeedsOnboardingRole(false);
  };

  const updateRole = async (newRole: "tutor" | "student") => {
    if (!profile) return;
    let token = localStorage.getItem("mathsy_meet_token");
    if (!token) {
      // If user selected role before async auth fetch finished, wait up to 3 seconds for token
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        token = localStorage.getItem("mathsy_meet_token");
        if (token) break;
      }
    }
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/auth/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: UserProfile = {
          ...profile,
          role: newRole,
          isHost: newRole === "tutor",
          needsRoleSelection: false,
        };
        saveSession(data.user || updated, data.token || token);
        setNeedsOnboardingRole(false);
        toast.success(`Welcome to Mathsy Meet! Account setup as ${newRole === "tutor" ? "Tutor" : "Student"}.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to update role on server");
      }
    } catch (err) {
      console.warn("[Auth] Failed to update role on backend:", err);
      toast.error("Failed to update role. Please try again.");
    }
  };

  const joinAsGuest = async (guestName: string, role: "tutor" | "student" = "student") => {
    const guestUser: UserProfile = {
      id: "guest-" + Math.random().toString(36).substring(2, 9),
      email: "",
      name: guestName || "Guest Student",
      role: role,
    };
    setProfile(guestUser);
  };

  const signOut = async () => {
    clearSession();
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState({}, document.title, "/");
      } catch {}
      window.location.href = "/";
      window.location.reload();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: profile,
        session,
        profile,
        loading,
        isAuthenticating,
        isAuthenticated,
        needsOnboardingRole,
        pendingAction,
        clearPendingAction,
        signInWithGoogle,
        signUpWithGoogle,
        updateRole,
        dismissOnboardingRole,
        joinAsGuest,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
