import React, { createContext, useContext, useEffect, useState } from "react";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  isHost?: boolean;
  role?: "tutor" | "student";
}

interface AuthContextType {
  user: UserProfile | null;
  session: { access_token: string; user: UserProfile } | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  joinAsGuest: (guestName: string, role?: "tutor" | "student") => Promise<void>;
  signOut: () => Promise<void>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001/api";
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "624389472912-jb3ji3bklfi2frmb9nuhc3n9alnfpdqm.apps.googleusercontent.com";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<{ access_token: string; user: UserProfile } | null>(null);
  const [loading, setLoading] = useState(true);

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
    localStorage.removeItem("mathsy_meet_token");
    localStorage.removeItem("mathsy_meet_user");
    localStorage.removeItem("mathsy_meet_guest");
  };

  useEffect(() => {
    // 1. Check for token in URL hash/params (e.g. from Google OAuth callback)
    const hash = window.location.hash;
    if (hash && hash.includes("access_token=")) {
      try {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get("access_token");
        if (accessToken) {
          // Fetch Google User Profile with access token
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
            .then((r) => r.json())
            .then(async (googleUser) => {
              if (googleUser?.email) {
                // Upsert user into PostgreSQL
                const res = await fetch(`${API_BASE}/auth/google`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: googleUser.email,
                    name: googleUser.name,
                    avatarUrl: googleUser.picture,
                    providerUserId: googleUser.sub,
                    role: "tutor",
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  saveSession(data.user, data.token);
                  window.history.replaceState({}, document.title, window.location.pathname);
                }
              }
            })
            .catch((err) => console.warn("[Auth] Failed to exchange Google token:", err))
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
          // If offline / local fallback, restore cached user
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
      // Check for saved guest
      const savedGuest = localStorage.getItem("mathsy_meet_guest");
      if (savedGuest) {
        try {
          const parsed = JSON.parse(savedGuest);
          setProfile(parsed);
        } catch {}
      }
      setLoading(false);
    }
  }, []);

  const signInWithGoogle = async () => {
    try {
      const redirectUri = window.location.origin;
      const scope = encodeURIComponent("openid email profile");
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&response_type=token&scope=${scope}&prompt=select_account`;

      window.location.href = authUrl;
    } catch (err: any) {
      console.error("[Auth] Google Sign-in error:", err.message);
      throw err;
    }
  };

  const joinAsGuest = async (guestName: string, role: "tutor" | "student" = "student") => {
    const trimmed =
      guestName.trim() ||
      (role === "tutor" ? "Tutor" : "Student") + " " + Math.floor(100 + Math.random() * 900);
    const isTutor = role === "tutor";

    try {
      // Attempt to register guest in PostgreSQL database
      const res = await fetch(`${API_BASE}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: trimmed, role }),
      });

      if (res.ok) {
        const data = await res.json();
        saveSession(data.user, data.token);
        return;
      }
    } catch (err) {
      console.warn("[Auth] PostgreSQL guest endpoint unreachable, using client fallback:", err);
    }

    // Client-side fallback if backend is offline
    const fallbackProfile: UserProfile = {
      id: "guest_" + Math.random().toString(36).substring(2, 10),
      name: trimmed,
      email: "",
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
        trimmed
      )}&backgroundColor=${isTutor ? "1a73e8" : "10b981"}`,
      isHost: isTutor,
      role: role,
    };
    setProfile(fallbackProfile);
    localStorage.setItem("mathsy_meet_guest", JSON.stringify(fallbackProfile));
  };

  const signOut = async () => {
    clearSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user: profile,
        session,
        profile,
        loading,
        signInWithGoogle,
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
