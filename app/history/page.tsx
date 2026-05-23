"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Flame,
  ForkKnife,
  Hand,
  Lightning,
  MapPinSimpleArea,
  Minus,
  Moon,
  PaintBrush,
  Snowflake,
  Sparkle,
  Tree,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { formatDistanceToNow } from "date-fns";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  computeElapsedMs,
  formatElapsed,
} from "@/lib/quest-lifecycle";
import type {
  Quest,
  QuestEvent,
  QuestReaction,
} from "@/lib/database.types";

const CATEGORY_ICONS: Record<string, Icon> = {
  Social: UsersThree,
  Outdoor: Tree,
  Chaos: Lightning,
  Creative: PaintBrush,
  Food: ForkKnife,
  "Late Night": Moon,
};

const REACTION_ICONS: Record<QuestReaction, Icon> = {
  cooked: Snowflake,
  mid: Minus,
  tuff: Hand,
  fire: Flame,
};

type Row = {
  quest: Quest;
  events: QuestEvent[];
  completedAt: string;
};

export default function HistoryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Pull recent completed events newest-first, then join quests + all
      // events for each. Keeping the SQL simple — small N for now.
      const { data: completedEvents } = await supabase
        .from("quest_events")
        .select("*")
        .eq("user_id", user.id)
        .eq("event_type", "completed")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!completedEvents || completedEvents.length === 0) {
        if (!cancelled) setRows([]);
        return;
      }

      const questIds = Array.from(
        new Set(completedEvents.map((e) => e.quest_id)),
      );
      const [{ data: quests }, { data: allEvents }] = await Promise.all([
        supabase.from("quests").select("*").in("id", questIds),
        supabase
          .from("quest_events")
          .select("*")
          .in("quest_id", questIds)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;

      const eventsByQuest = new Map<string, QuestEvent[]>();
      for (const e of allEvents ?? []) {
        const arr = eventsByQuest.get(e.quest_id);
        if (arr) arr.push(e);
        else eventsByQuest.set(e.quest_id, [e]);
      }
      const questById = new Map((quests ?? []).map((q) => [q.id, q]));

      const seen = new Set<string>();
      const built: Row[] = [];
      for (const ev of completedEvents) {
        if (seen.has(ev.quest_id)) continue;
        seen.add(ev.quest_id);
        const q = questById.get(ev.quest_id);
        if (!q) continue;
        built.push({
          quest: q,
          events: eventsByQuest.get(q.id) ?? [],
          completedAt: ev.created_at,
        });
      }
      setRows(built);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  if (!user || rows === null) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding:
            "var(--space-7) var(--space-4) var(--space-9)",
        }}
      >
        <h1 className="ds-page-title">History</h1>
      </main>
    );
  }

  if (rows.length === 0) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding:
            "var(--space-7) var(--space-4) var(--space-9)",
        }}
      >
        <h1 className="ds-page-title">History</h1>
        <div className="glass ds-empty-state">
          <MapPinSimpleArea
            weight="duotone"
            size={36}
            className="ds-empty-state-icon"
            aria-hidden="true"
          />
          <p className="ds-empty-state-text">
            No completed quests yet. Start one and we&apos;ll save it here.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "var(--space-7) var(--space-4) var(--space-9)",
      }}
    >
      <h1 className="ds-page-title">History</h1>
      <div
        className="flex flex-col"
        style={{ gap: "var(--space-3)" }}
      >
        {rows.map((row) => {
          const CategoryIcon =
            CATEGORY_ICONS[row.quest.category] ?? Sparkle;
          const totalMs = computeElapsedMs(row.events, row.completedAt);
          const ReactionIcon = row.quest.reaction
            ? REACTION_ICONS[row.quest.reaction]
            : null;
          return (
            <Link
              key={row.quest.id}
              href={`/quest/${row.quest.id}`}
              className="glass ds-history-row"
            >
              <span className="ds-cat-chip" style={{ alignSelf: "flex-start" }}>
                <span className="ds-cat-chip-icon" aria-hidden="true">
                  <CategoryIcon weight="duotone" size={12} />
                </span>
                {row.quest.category}
              </span>
              <h3 className="ds-history-row-title">{row.quest.title}</h3>
              <div className="ds-history-row-meta">
                <span className="ds-meta-item">
                  <Clock
                    weight="duotone"
                    size={14}
                    aria-hidden="true"
                  />
                  {formatElapsed(totalMs)}
                </span>
                <span>
                  completed{" "}
                  {formatDistanceToNow(new Date(row.completedAt), {
                    addSuffix: true,
                  })}
                </span>
                {ReactionIcon && (
                  <ReactionIcon
                    weight="fill"
                    size={14}
                    color="var(--text-secondary)"
                    aria-label={`Rated ${row.quest.reaction}`}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
