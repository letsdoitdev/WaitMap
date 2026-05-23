"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  CircleNotch,
  Flame,
  Hand,
  Minus,
  Snowflake,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth-context";
import { useActiveQuest } from "@/lib/active-quest-context";
import { useUploadQueue } from "@/components/UploadQueueProvider";
import MediaCapturePad, {
  type PendingMedia,
} from "@/components/MediaCapturePad";
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
  const { refresh: refreshActive } = useActiveQuest();
  const { enqueue } = useUploadQueue();
  const supabase = useMemo(() => createClient(), []);

  const [quest, setQuest] = useState<Quest | null>(null);
  const [events, setEvents] = useState<QuestEvent[]>([]);
  const [pending, setPending] = useState<PendingMedia[]>([]);
  const [reaction, setReaction] = useState<QuestReaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
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
      setAlreadyCompleted(
        (ev ?? []).some((e) => e.event_type === "completed"),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.id, supabase, user]);

  const elapsedMs = useMemo(() => {
    if (events.length === 0) return 0;
    const completedEvent = [...events]
      .reverse()
      .find((e) => e.event_type === "completed");
    const ref = completedEvent
      ? completedEvent.created_at
      : new Date(Date.now()).toISOString();
    return computeElapsedMs(events, ref);
  }, [events]);

  const submit = async () => {
    if (!user || !quest || submitting) return;
    setSubmitting(true);
    setError(null);

    let completionEventId: string | null = null;

    if (alreadyCompleted) {
      // Re-attaching media to a quest already completed (e.g. user navigated
      // back here from /history). Reuse the original completion event.
      const last = [...events]
        .reverse()
        .find((e) => e.event_type === "completed");
      completionEventId = last?.id ?? null;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("quest_events")
        .insert({
          quest_id: quest.id,
          user_id: user.id,
          event_type: "completed",
        })
        .select()
        .single();
      if (insertError || !inserted) {
        setError(insertError?.message ?? "Couldn't mark complete");
        setSubmitting(false);
        return;
      }
      completionEventId = inserted.id;
    }

    if (reaction !== quest.reaction) {
      await supabase
        .from("quests")
        .update({ reaction })
        .eq("id", quest.id);
    }

    if (pending.length > 0 && completionEventId) {
      enqueue({
        questId: quest.id,
        eventId: completionEventId,
        files: pending.map((p) => p.file),
      });
    }

    await refreshActive();
    router.push("/history");
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
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "var(--space-6) var(--space-4) var(--space-8)",
      }}
    >
      <Link
        href="/quest/active"
        className="ds-secondary-pill"
        style={{ marginBottom: "var(--space-5)" }}
      >
        <ArrowLeft weight="duotone" size={16} aria-hidden="true" />
        <span>Back to quest</span>
      </Link>

      <h1 className="ds-complete-hero-title">
        {alreadyCompleted ? "Add to your quest" : "Wrapping up"}
      </h1>
      <p className="ds-complete-hero-sub">
        {quest.title} · {formatElapsed(elapsedMs)}
      </p>

      <p className="ds-complete-section-label">Photos &amp; video</p>
      <MediaCapturePad
        pending={pending}
        onChange={setPending}
        disabled={submitting}
      />

      <p className="ds-complete-section-label">How did this quest feel?</p>
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
              onClick={() => setReaction((cur) => (cur === r ? null : r))}
              className="ds-reaction"
              data-active={active ? "true" : "false"}
              disabled={submitting}
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

      {error && (
        <p
          role="alert"
          style={{
            color: "var(--error)",
            fontFamily: "var(--font-body, inherit)",
            fontSize: 13,
            margin: "var(--space-4) 0 0",
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        className="ds-mark-complete-btn"
        onClick={submit}
        disabled={submitting}
      >
        {submitting ? (
          <>
            <CircleNotch
              weight="duotone"
              size={18}
              aria-hidden="true"
              className="animate-spin"
            />
            <span>
              {pending.length > 0 ? "Finalizing…" : "Marking complete…"}
            </span>
          </>
        ) : (
          <>
            <CheckCircle weight="duotone" size={18} aria-hidden="true" />
            <span>
              {alreadyCompleted ? "Save" : "Mark complete"}
              {pending.length > 0 ? ` & upload ${pending.length}` : ""}
            </span>
          </>
        )}
      </button>
    </main>
  );
}
