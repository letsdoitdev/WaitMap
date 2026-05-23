"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useUploadQueue } from "@/components/UploadQueueProvider";
import {
  computeStreaks,
  computeTotals,
  trailingDayCompletions,
  type StreakResult,
  type TotalsResult,
} from "@/lib/stats";
import type { Quest, QuestEvent } from "@/lib/database.types";

type StatsValue = {
  loading: boolean;
  quests: Quest[];
  completedEvents: QuestEvent[];
  allEvents: QuestEvent[];
  streaks: StreakResult;
  totals: TotalsResult;
  trailing: { day: string; completed: boolean }[];
  refresh: () => Promise<void>;
};

const StatsContext = createContext<StatsValue | null>(null);

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { version } = useUploadQueue();
  const supabase = useMemo(() => createClient(), []);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [completedEvents, setCompletedEvents] = useState<QuestEvent[]>([]);
  const [allEvents, setAllEvents] = useState<QuestEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setQuests([]);
      setCompletedEvents([]);
      setAllEvents([]);
      return;
    }
    setLoading(true);

    const { data: completed } = await supabase
      .from("quest_events")
      .select("*")
      .eq("user_id", user.id)
      .eq("event_type", "completed")
      .order("created_at", { ascending: false });

    const completedList = completed ?? [];
    setCompletedEvents(completedList);

    if (completedList.length === 0) {
      setQuests([]);
      setAllEvents([]);
      setLoading(false);
      return;
    }

    const questIds = Array.from(
      new Set(completedList.map((e) => e.quest_id)),
    );

    const [{ data: q }, { data: ev }] = await Promise.all([
      supabase.from("quests").select("*").in("id", questIds),
      supabase
        .from("quest_events")
        .select("*")
        .in("quest_id", questIds)
        .order("created_at", { ascending: true }),
    ]);

    setQuests(q ?? []);
    setAllEvents(ev ?? []);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const streaks = useMemo(() => computeStreaks(completedEvents), [completedEvents]);
  const totals = useMemo(
    () => computeTotals(quests, allEvents),
    [quests, allEvents],
  );
  const trailing = useMemo(
    () => trailingDayCompletions(completedEvents, 7),
    [completedEvents],
  );

  return (
    <StatsContext.Provider
      value={{
        loading,
        quests,
        completedEvents,
        allEvents,
        streaks,
        totals,
        trailing,
        refresh,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStats must be used inside StatsProvider");
  return ctx;
}
