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
import { FREE_DAILY_REROLLS, getUtcDateKey } from "@/lib/constants";
import type { Tier } from "@/lib/database.types";

type TierState = {
  tier: Tier;
  tier_expires_at: string | null;
  daily_rerolls: Record<string, number>;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  initial: string;
  tier: Tier;
  isPro: boolean;
  rerollsToday: number;
  rerollsRemaining: number;
  refreshTier: () => Promise<void>;
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
  const [tierState, setTierState] = useState<TierState | null>(null);

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

  // Pull the user's tier + reroll ledger from profiles. Exposed as refreshTier
  // so the demo tier toggle (M12.2) can re-read after flipping tier without a
  // full reload. Signed-out users fall back to the free-tier defaults.
  const refreshTier = useCallback(async () => {
    if (!user) {
      setTierState(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("tier, tier_expires_at, daily_rerolls")
      .eq("id", user.id)
      .maybeSingle();
    setTierState(
      data
        ? {
            tier: data.tier ?? "free",
            tier_expires_at: data.tier_expires_at ?? null,
            daily_rerolls: data.daily_rerolls ?? {},
          }
        : null,
    );
  }, [supabase, user]);

  useEffect(() => {
    void refreshTier();
  }, [refreshTier]);

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

  const tier: Tier = tierState?.tier ?? "free";

  const isPro = useMemo(() => {
    if (!tierState || tierState.tier !== "pro") return false;
    if (!tierState.tier_expires_at) return true;
    return new Date(tierState.tier_expires_at).getTime() > Date.now();
  }, [tierState]);

  const rerollsToday = useMemo(() => {
    if (!tierState) return 0;
    return tierState.daily_rerolls[getUtcDateKey()] ?? 0;
  }, [tierState]);

  const rerollsRemaining = useMemo(() => {
    if (isPro) return Number.POSITIVE_INFINITY;
    return Math.max(0, FREE_DAILY_REROLLS - rerollsToday);
  }, [isPro, rerollsToday]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        displayName,
        initial,
        tier,
        isPro,
        rerollsToday,
        rerollsRemaining,
        refreshTier,
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
