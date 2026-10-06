import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { User, Session } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  isHost?: boolean;
  role?: "tutor" | "student";
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  joinAsGuest: (guestName: string, role?: "tutor" | "student") => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Check existing Supabase session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setProfile({
          id: session.user.id,
          name: session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Host",
          email: session.user.email || "",
          avatarUrl: session.user.user_metadata?.avatar_url || "",
          isHost: true
        });
      } else {
        // Check for saved guest session
        const savedGuest = localStorage.getItem("mathsy_meet_guest");
        if (savedGuest) {
          try {
            const parsed = JSON.parse(savedGuest);
            setProfile(parsed);
          } catch {}
        }
      }
      setLoading(false);
    });

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setProfile({
          id: session.user.id,
          name: session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Host",
          email: session.user.email || "",
          avatarUrl: session.user.user_metadata?.avatar_url || "",
          isHost: true
        });
        localStorage.removeItem("mathsy_meet_guest");
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("[Auth] Google Sign-in error:", err.message);
      throw err;
    }
  };

  const joinAsGuest = (guestName: string, role: "tutor" | "student" = "student") => {
    const trimmed = guestName.trim() || (role === "tutor" ? "Tutor" : "Student") + " " + Math.floor(100 + Math.random() * 900);
    const isTutor = role === "tutor";
    const guestProfile: UserProfile = {
      id: "guest_" + Math.random().toString(36).substring(2, 10),
      name: trimmed,
      email: "",
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(trimmed)}&backgroundColor=${isTutor ? "1a73e8" : "10b981"}`,
      isHost: isTutor,
      role: role,
    };
    setProfile(guestProfile);
    localStorage.setItem("mathsy_meet_guest", JSON.stringify(guestProfile));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("mathsy_meet_guest");
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
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
