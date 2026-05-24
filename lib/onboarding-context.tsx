"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { CostPref, GroupMode } from "@/lib/database.types";

export const ONBOARDING_STORAGE_KEY = "unemployment.onboarding.v1";

/**
 * Group-mode → derived group size used to pre-fill Preferences on home.
 * When the user picks multiple modes we take the MAX (spec §D).
 */
export const GROUP_MODE_SIZE: Record<GroupMode, number> = {
  Solo: 1,
  Partner: 2,
  Roommates: 3,
  "Close friends": 4,
  "Bigger group": 6,
  Family: 4,
};

export type OnboardingAnswers = {
  groupModes: GroupMode[];
  vibeCategories: string[];
  spice: number;
  timeMinutes: number;
  canDrive: boolean | null;
  costPref: CostPref | null;
  /** ISO string of when the user finished step 8 + landed on the teaser. */
  completedAt: string | null;
  /** ISO string of when we showed the "leave a review" prompt. */
  reviewPromptedAt: string | null;
};

export const EMPTY_ONBOARDING: OnboardingAnswers = {
  groupModes: [],
  vibeCategories: [],
  spice: 5,
  timeMinutes: 90,
  canDrive: null,
  costPref: null,
  completedAt: null,
  reviewPromptedAt: null,
};

type Action =
  | { type: "hydrate"; payload: OnboardingAnswers }
  | { type: "setGroupModes"; payload: GroupMode[] }
  | { type: "setVibeCategories"; payload: string[] }
  | { type: "setSpice"; payload: number }
  | { type: "setTimeMinutes"; payload: number }
  | { type: "setCanDrive"; payload: boolean }
  | { type: "setCostPref"; payload: CostPref }
  | { type: "markCompleted"; payload: string }
  | { type: "markReviewPrompted"; payload: string }
  | { type: "reset" };

function reducer(state: OnboardingAnswers, action: Action): OnboardingAnswers {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.payload };
    case "setGroupModes":
      return { ...state, groupModes: action.payload };
    case "setVibeCategories":
      return { ...state, vibeCategories: action.payload };
    case "setSpice":
      return { ...state, spice: action.payload };
    case "setTimeMinutes":
      return { ...state, timeMinutes: action.payload };
    case "setCanDrive":
      return { ...state, canDrive: action.payload };
    case "setCostPref":
      return { ...state, costPref: action.payload };
    case "markCompleted":
      return { ...state, completedAt: action.payload };
    case "markReviewPrompted":
      return { ...state, reviewPromptedAt: action.payload };
    case "reset":
      return { ...EMPTY_ONBOARDING };
  }
}

type OnboardingContextValue = {
  /** True until we've hydrated from localStorage / Supabase the first time. */
  loading: boolean;
  answers: OnboardingAnswers;
  /** Convenience derived value — true when onboarding has finished. */
  isComplete: boolean;
  setGroupModes: (next: GroupMode[]) => void;
  setVibeCategories: (next: string[]) => void;
  setSpice: (next: number) => void;
  setTimeMinutes: (next: number) => void;
  setCanDrive: (next: boolean) => void;
  setCostPref: (next: CostPref) => void;
  markCompleted: () => void;
  markReviewPrompted: () => void;
  reset: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function readLocalStorage(): Partial<OnboardingAnswers> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingAnswers>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(answers: OnboardingAnswers): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify(answers),
    );
  } catch {
    // quota / privacy mode — fine, we just lose persistence
  }
}

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [answers, dispatch] = useReducer(reducer, EMPTY_ONBOARDING);
  const [loading, setLoading] = useState(true);
  const hasHydrated = useRef(false);
  // Ref so the persistence effect can compare against the most recent
  // server snapshot without re-running on every keystroke.
  const lastWrittenRef = useRef<string>("");

  // Hydrate from localStorage immediately, then from Supabase if we have a
  // user. Supabase wins on conflicts — it's the source of truth across
  // devices.
  useEffect(() => {
    if (hasHydrated.current && user) {
      // Re-hydrate when the user changes (sign-in flow).
      hasHydrated.current = false;
    }
    let cancelled = false;
    (async () => {
      const local = readLocalStorage();
      if (local) {
        dispatch({
          type: "hydrate",
          payload: { ...EMPTY_ONBOARDING, ...local },
        });
      }
      if (user) {
        const { data } = await supabase
          .from("user_onboarding")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          // Prefer "any non-null timestamp" across local + supabase so a
          // stale supabase row (debounced upsert from the just-finished
          // onboarding hasn't landed yet) can't clobber a freshly-stamped
          // local completedAt. Same reasoning for review_prompted_at.
          const payload: OnboardingAnswers = {
            groupModes: (data.group_modes ?? []) as GroupMode[],
            vibeCategories: data.vibe_categories ?? [],
            spice: data.spice ?? EMPTY_ONBOARDING.spice,
            timeMinutes: data.time_minutes ?? EMPTY_ONBOARDING.timeMinutes,
            canDrive: data.can_drive,
            costPref: data.cost_pref,
            completedAt:
              data.onboarding_completed_at ?? local?.completedAt ?? null,
            reviewPromptedAt:
              data.review_prompted_at ?? local?.reviewPromptedAt ?? null,
          };
          dispatch({ type: "hydrate", payload });
          writeLocalStorage(payload);
          lastWrittenRef.current = JSON.stringify(payload);
        } else if (local) {
          // Brand-new authed row — mirror localStorage answers up.
          const seed: OnboardingAnswers = {
            ...EMPTY_ONBOARDING,
            ...local,
          };
          await supabase.from("user_onboarding").upsert({
            user_id: user.id,
            group_modes: seed.groupModes,
            vibe_categories: seed.vibeCategories,
            spice: seed.spice,
            time_minutes: seed.timeMinutes,
            can_drive: seed.canDrive,
            cost_pref: seed.costPref,
            onboarding_completed_at: seed.completedAt,
            review_prompted_at: seed.reviewPromptedAt,
          });
          lastWrittenRef.current = JSON.stringify(seed);
        }
      }
      hasHydrated.current = true;
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, supabase]);

  // Persist to localStorage on every change.
  useEffect(() => {
    if (!hasHydrated.current) return;
    writeLocalStorage(answers);
  }, [answers]);

  // Persist to Supabase on every change (debounced via the ref so we don't
  // POST the same payload twice).
  useEffect(() => {
    if (!hasHydrated.current || !user) return;
    const snapshot = JSON.stringify(answers);
    if (snapshot === lastWrittenRef.current) return;
    lastWrittenRef.current = snapshot;
    const handle = window.setTimeout(() => {
      void supabase
        .from("user_onboarding")
        .upsert({
          user_id: user.id,
          group_modes: answers.groupModes,
          vibe_categories: answers.vibeCategories,
          spice: answers.spice,
          time_minutes: answers.timeMinutes,
          can_drive: answers.canDrive,
          cost_pref: answers.costPref,
          onboarding_completed_at: answers.completedAt,
          review_prompted_at: answers.reviewPromptedAt,
        });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [answers, user, supabase]);

  const setGroupModes = useCallback(
    (next: GroupMode[]) => dispatch({ type: "setGroupModes", payload: next }),
    [],
  );
  const setVibeCategories = useCallback(
    (next: string[]) =>
      dispatch({ type: "setVibeCategories", payload: next }),
    [],
  );
  const setSpice = useCallback(
    (next: number) => dispatch({ type: "setSpice", payload: next }),
    [],
  );
  const setTimeMinutes = useCallback(
    (next: number) => dispatch({ type: "setTimeMinutes", payload: next }),
    [],
  );
  const setCanDrive = useCallback(
    (next: boolean) => dispatch({ type: "setCanDrive", payload: next }),
    [],
  );
  const setCostPref = useCallback(
    (next: CostPref) => dispatch({ type: "setCostPref", payload: next }),
    [],
  );
  const markCompleted = useCallback(() => {
    const ts = new Date().toISOString();
    dispatch({ type: "markCompleted", payload: ts });
    // Atomic synchronous localStorage write so a router.push that follows
    // immediately can't race the React state→effect→persist chain. The
    // effect that normally writes localStorage will then see no diff.
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
        const existing = raw
          ? (JSON.parse(raw) as Partial<OnboardingAnswers>)
          : {};
        const merged: OnboardingAnswers = {
          ...EMPTY_ONBOARDING,
          ...existing,
          completedAt: ts,
        };
        window.localStorage.setItem(
          ONBOARDING_STORAGE_KEY,
          JSON.stringify(merged),
        );
      } catch {
        // ignore quota / privacy mode
      }
    }
  }, []);
  const markReviewPrompted = useCallback(() => {
    dispatch({
      type: "markReviewPrompted",
      payload: new Date().toISOString(),
    });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      loading,
      answers,
      isComplete: !!answers.completedAt,
      setGroupModes,
      setVibeCategories,
      setSpice,
      setTimeMinutes,
      setCanDrive,
      setCostPref,
      markCompleted,
      markReviewPrompted,
      reset,
    }),
    [
      loading,
      answers,
      setGroupModes,
      setVibeCategories,
      setSpice,
      setTimeMinutes,
      setCanDrive,
      setCostPref,
      markCompleted,
      markReviewPrompted,
      reset,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used inside OnboardingProvider");
  }
  return ctx;
}
