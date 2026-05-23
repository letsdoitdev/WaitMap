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
import type { Quest, QuestEvent } from "@/lib/database.types";
import {
  getQuestState,
  isLiveState,
  type QuestState,
} from "@/lib/quest-lifecycle";

type ActiveQuestSnapshot = {
  quest: Quest;
  events: QuestEvent[];
  state: QuestState;
};

type ActiveQuestContextValue = {
  active: ActiveQuestSnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const ActiveQuestContext = createContext<ActiveQuestContextValue | null>(null);

export function ActiveQuestProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [active, setActive] = useState<ActiveQuestSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setActive(null);
      return;
    }
    setLoading(true);

    // Get the user's quests ordered by most recent generation, then for each
    // newest-first, pick the first one whose latest event is active/paused.
    // To keep this single-query, pull recent quests + their events.
    const { data: quests } = await supabase
      .from("quests")
      .select("*")
      .eq("user_id", user.id)
      .order("generated_at", { ascending: false })
      .limit(20);

    if (!quests || quests.length === 0) {
      setActive(null);
      setLoading(false);
      return;
    }

    const questIds = quests.map((q) => q.id);
    const { data: events } = await supabase
      .from("quest_events")
      .select("*")
      .in("quest_id", questIds)
      .order("created_at", { ascending: true });

    const eventsByQuest = new Map<string, QuestEvent[]>();
    for (const e of events ?? []) {
      const arr = eventsByQuest.get(e.quest_id);
      if (arr) arr.push(e);
      else eventsByQuest.set(e.quest_id, [e]);
    }

    let found: ActiveQuestSnapshot | null = null;
    for (const q of quests) {
      const qEvents = eventsByQuest.get(q.id) ?? [];
      const state = getQuestState(qEvents);
      if (isLiveState(state)) {
        found = { quest: q, events: qEvents, state };
        break;
      }
    }
    setActive(found);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ActiveQuestContext.Provider value={{ active, loading, refresh }}>
      {children}
    </ActiveQuestContext.Provider>
  );
}

export function useActiveQuest() {
  const ctx = useContext(ActiveQuestContext);
  if (!ctx)
    throw new Error("useActiveQuest must be used inside ActiveQuestProvider");
  return ctx;
}
