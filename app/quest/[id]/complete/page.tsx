"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Camera,
  Flame,
  Hand,
  Minus,
  Snowflake,
} from "@phosphor-icons/react/dist/ssr";
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

const REACTION_ICONS: Record<QuestReaction, Icon> = {
  cooked: Snowflake,
  mid: Minus,
  tuff: Hand,
  fire: Flame,
};

const REACTION_LABELS: Record<QuestReaction, string> = {
  cooked: "Cooked",
  mid: "Mid",
  tuff: "Tuff",
  fire: "Fire",
};

const RATING_ORDER: QuestReaction[] = ["cooked", "mid", "tuff", "fire"];

export default function CompleteQuestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [quest, setQuest] = useState<Quest | null>(null);
  const [events, setEvents] = useState<QuestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [reaction, setReaction] = useState<QuestReaction | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user || !params?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: q }, { data: ev }] = await Promise.all([
        supabase.from("quests").select("*").eq("id", params.id).maybeSingle(),
        supabase
          .from("quest_events")
          .select("*")
          .eq("quest_id", params.id)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setQuest(q ?? null);
      setEvents(ev ?? []);
      setReaction(q?.reaction ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.id, supabase, user]);

  const totalMs = computeElapsedMs(
    events,
    new Date(Date.now()).toISOString(),
  );

  const setReactionFor = async (r: QuestReaction) => {
    if (!quest || reactionBusy) return;
    setReactionBusy(true);
    const next = reaction === r ? null : r;
    setReaction(next);
    await supabase
      .from("quests")
      .update({ reaction: next })
      .eq("id", quest.id);
    setReactionBusy(false);
  };

  if (loading) {
    return (
      <main className="ds-complete-screen">
        <p
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-body, inherit)",
            fontSize: 14,
          }}
        >
          Loading…
        </p>
      </main>
    );
  }

  if (!quest) {
    return (
      <main className="ds-complete-screen">
        <p className="ds-empty-state-text">Quest not found.</p>
      </main>
    );
  }

  return (
    <main className="ds-complete-screen">
      <h1 className="ds-complete-title">Quest complete</h1>
      <p
        style={{
          fontFamily: "var(--font-body, inherit)",
          fontSize: 14,
          color: "var(--text-secondary)",
          margin: "0 0 var(--space-5)",
        }}
      >
        {quest.title}
      </p>
      <p className="ds-complete-time">{formatElapsed(totalMs)}</p>

      <p className="ds-complete-prompt">How did this quest feel?</p>
      <div
        className="ds-reactions"
        role="radiogroup"
        aria-label="Rate this quest"
        style={{ marginTop: 0 }}
      >
        {RATING_ORDER.map((r) => {
          const active = reaction === r;
          const ReactionIcon = REACTION_ICONS[r];
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setReactionFor(r)}
              className="ds-reaction"
              data-active={active ? "true" : "false"}
              disabled={reactionBusy}
            >
              <ReactionIcon
                weight={active ? "fill" : "duotone"}
                size={14}
                aria-hidden="true"
              />
              <span>{REACTION_LABELS[r]}</span>
            </button>
          );
        })}
      </div>

      <div className="ds-capture-placeholder">
        <Camera
          weight="duotone"
          size={28}
          color="var(--text-tertiary)"
          aria-hidden="true"
        />
        <span>Capture coming soon</span>
      </div>

      <Link href="/" className="ds-suggest-pill">
        <span>Back home</span>
      </Link>
    </main>
  );
}
