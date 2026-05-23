"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  initial: string;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: User | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(initialUser);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        router.refresh();
      },
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [supabase, router]);

  const signInWithGoogle = useCallback(async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    return { error: error?.message ?? null };
  }, [supabase]);

  // Apple is scaffolded but not yet exposed in UI — see M5 spec.
  const signInWithApple = useCallback(async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    return { error: error?.message ?? null };
  }, [supabase]);

  const signInWithEmail = useCallback(
    async (email: string) => {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      setLoading(false);
      return { error: error?.message ?? null };
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }, [supabase, router]);

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    (user?.email ? user.email.split("@")[0] : null);

  const initial = (displayName ?? user?.email ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        displayName,
        initial,
        signInWithGoogle,
        signInWithApple,
        signInWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
