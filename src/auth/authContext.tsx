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
}

interface AuthContextType {
  user: UserProfile | null;
  session: { access_token: string; user: UserProfile } | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  needsOnboardingRole: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithGoogle: (role: "tutor" | "student") => Promise<void>;
  updateRole: (role: "tutor" | "student") => Promise<void>;
  dismissOnboardingRole: () => void;
  joinAsGuest: (guestName: string, role?: "tutor" | "student") => Promise<void>;
  signOut: () => Promise<void>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "207248778617-3n7l8vp8cgqv8dhiqltnsnmoj9n8ain7.apps.googleusercontent.com";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<{ access_token: string; user: UserProfile } | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboardingRole, setNeedsOnboardingRole] = useState(false);

  const isAuthenticated = Boolean(
    profile?.email &&
    (session?.access_token || localStorage.getItem("mathsy_meet_token")) &&
    !profile?.id?.startsWith("guest_")
  );

  // Helper to save session
  const saveSession = (user: UserProfile, token: string) => {
    setProfile(user);
    setSession({ access_token: token, user });
    localStorage.setItem("mathsy_meet_token", token);
    localStorage.setItem("mathsy_meet_user", JSON.stringify(user));
  };

  // Helper to clear session
  const clearSession = () => {
    setProfile(null);
    setSession(null);
    setNeedsOnboardingRole(false);
    localStorage.removeItem("mathsy_meet_token");
    localStorage.removeItem("mathsy_meet_user");
    localStorage.removeItem("mathsy_meet_guest");
    localStorage.removeItem("mathsy_meet_signup_role");
    localStorage.removeItem("mathsy_meet_auth_intent");
  };

  useEffect(() => {
    // 1. Check for token in URL hash/params (e.g. from Google OAuth callback)
    const hash = window.location.hash;
    if (hash && (hash.includes("access_token=") || hash.includes("id_token="))) {
      try {
        const params = new URLSearchParams(hash.substring(1));
        const idToken = params.get("id_token");
        const accessToken = params.get("access_token");

        if (idToken || accessToken) {
          const signupRole = localStorage.getItem("mathsy_meet_signup_role") as ("tutor" | "student" | null);
          const authIntent = localStorage.getItem("mathsy_meet_auth_intent") || (signupRole ? "signup" : "signin");
          localStorage.removeItem("mathsy_meet_signup_role");
          localStorage.removeItem("mathsy_meet_auth_intent");

          // Authenticate with verified Google credential on PostgreSQL backend
          fetch(`${API_BASE}/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idToken: idToken || undefined,
              accessToken: accessToken || undefined,
              role: authIntent === "signup" ? (signupRole || undefined) : undefined,
            }),
          })
            .then(async (res) => {
              if (res.ok) {
                const data = await res.json();
                saveSession(data.user, data.token);

                if (data.needsRoleSelection) {
                  setNeedsOnboardingRole(true);
                } else if (data.isNewUser) {
                  toast.success(`Welcome to Mathsy Meet, ${data.user.name}! (${data.user.role === "tutor" ? "Tutor" : "Student"})`);
                } else {
                  toast.success(`Welcome back, ${data.user.name}! (${data.user.role === "tutor" ? "Tutor" : "Student"})`);
                }

                // Handle preserved redirect URL safely (prevent open redirects)
                const redirectUrl = localStorage.getItem("mathsy_meet_redirect_url");
                if (redirectUrl) {
                  localStorage.removeItem("mathsy_meet_redirect_url");
                  if (redirectUrl.startsWith("/meet/") && !redirectUrl.includes("://") && !redirectUrl.startsWith("//")) {
                    window.history.replaceState({}, document.title, redirectUrl);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                    return;
                  }
                }
                window.history.replaceState({}, document.title, window.location.pathname);
              } else {
                const errData = await res.json().catch(() => ({}));
                console.error("[Auth] Server rejected Google authentication:", res.status, errData);
                toast.error(errData.error || "Failed to authenticate with Google. Please try again.");
                clearSession();
                window.history.replaceState({}, document.title, window.location.pathname);
              }
            })
            .catch((err) => {
              console.error("[Auth] Failed to reach auth backend:", err);
              toast.error("Authentication backend is unreachable. Please verify server connection.");
            })
            .finally(() => setLoading(false));
          return;
        }
      } catch (err) {
        console.warn("[Auth] URL hash parse error:", err);
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
            } catch {}
          }
        })
        .finally(() => setLoading(false));
    } else {
      // Remove any legacy guest state
      localStorage.removeItem("mathsy_meet_guest");
      setLoading(false);
    }
  }, []);

  const triggerGoogleOAuth = (intent: "signin" | "signup", role?: "tutor" | "student") => {
    try {
      localStorage.setItem("mathsy_meet_auth_intent", intent);
      if (role) {
        localStorage.setItem("mathsy_meet_signup_role", role);
      } else {
        localStorage.removeItem("mathsy_meet_signup_role");
      }
      if (window.location.pathname.includes("/meet/")) {
        localStorage.setItem("mathsy_meet_redirect_url", window.location.pathname);
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

  const signInWithGoogle = async () => {
    triggerGoogleOAuth("signin");
  };

  const signUpWithGoogle = async (role: "tutor" | "student") => {
    triggerGoogleOAuth("signup", role);
  };

  const dismissOnboardingRole = () => {
    setNeedsOnboardingRole(false);
  };

  const updateRole = async (newRole: "tutor" | "student") => {
    if (!profile) return;
    const token = localStorage.getItem("mathsy_meet_token");
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
        };
        saveSession(updated, data.token || token);
        setNeedsOnboardingRole(false);
        toast.success(`Active role updated to ${newRole === "tutor" ? "Tutor" : "Student"}`);
      } else {
        toast.error("Failed to update role on server");
      }
    } catch (err) {
      console.warn("[Auth] Failed to update role on backend:", err);
      toast.error("Failed to update role. Please try again.");
    }
  };

  const joinAsGuest = async (_guestName: string, _role: "tutor" | "student" = "student") => {
    // Guest accounts are disabled: require authentic Google sign-in
    toast.info("Please sign in with Google to enter your class with an authentic verified account.");
    triggerGoogleOAuth("signin");
  };

  const signOut = async () => {
    clearSession();
    toast.info("You have signed out.");
  };

  return (
    <AuthContext.Provider
      value={{
        user: profile,
        session,
        profile,
        loading,
        isAuthenticated,
        needsOnboardingRole,
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
