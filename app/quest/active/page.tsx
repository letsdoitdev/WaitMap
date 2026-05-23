"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ForkKnife,
  Lightning,
  MapPin,
  Moon,
  PaintBrush,
  Pause,
  Play,
  Sparkle,
  Tree,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { useActiveQuest } from "@/lib/active-quest-context";
import { createClient } from "@/lib/supabase/client";
import {
  computeElapsedMs,
  formatElapsed,
} from "@/lib/quest-lifecycle";
import type { Icon } from "@phosphor-icons/react";

const CATEGORY_ICONS: Record<string, Icon> = {
  Social: UsersThree,
  Outdoor: Tree,
  Chaos: Lightning,
  Creative: PaintBrush,
  Food: ForkKnife,
  "Late Night": Moon,
};

export default function ActiveQuestPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { active, refresh } = useActiveQuest();
  const supabase = useMemo(() => createClient(), []);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!active) return;
    if (active.state !== "active") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!confirmAbandon) return;
    const t = window.setTimeout(() => setConfirmAbandon(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmAbandon]);

  if (!active) {
    return (
      <main className="ds-active-screen">
        <p className="ds-empty-state-text" style={{ textAlign: "center" }}>
          No active quest right now.
        </p>
      </main>
    );
  }

  void tick;
  const elapsedMs = computeElapsedMs(
    active.events,
    new Date(Date.now()).toISOString(),
  );
  const isPaused = active.state === "paused";

  const CategoryIcon = CATEGORY_ICONS[active.quest.category] ?? Sparkle;
  const spicePct = Math.max(
    0,
    Math.min(100, (active.quest.spice / 10) * 100),
  );

  const startedAt = active.events.find((e) => e.event_type === "started");
  const startedDistance = startedAt
    ? formatDistanceToNow(new Date(startedAt.created_at), { addSuffix: true })
    : "just now";

  const insertEvent = async (
    event_type: "paused" | "resumed" | "abandoned",
  ) => {
    if (!user || busy) return;
    setBusy(true);
    const { error } = await supabase.from("quest_events").insert({
      quest_id: active.quest.id,
      user_id: user.id,
      event_type,
    });
    if (error) {
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
    if (event_type === "abandoned") {
      router.push("/");
    }
  };

  const goToComplete = () => {
    if (busy) return;
    // No event is inserted here — the completion event is written from the
    // /quest/[id]/complete capture screen after media is attached (or skipped).
    router.push(`/quest/${active.quest.id}/complete`);
  };

  return (
    <main className="ds-active-screen">
      <div className="glass" style={{ padding: "var(--space-6)" }}>
        <span className="ds-cat-chip">
          <span className="ds-cat-chip-icon" aria-hidden="true">
            <CategoryIcon weight="duotone" size={12} />
          </span>
          {active.quest.category}
        </span>

        <h1 className="ds-active-title" style={{ marginTop: "var(--space-3)" }}>
          {active.quest.title}
        </h1>

        <div className="ds-spice" style={{ marginTop: "var(--space-4)" }}>
          <div
            className="ds-spice-track"
            role="img"
            aria-label={`Spice ${active.quest.spice} of 10`}
          >
            <div
              className="ds-spice-fill"
              style={{ width: `${spicePct}%` }}
            />
          </div>
          <span className="ds-spice-label">
            Spice · {active.quest.spice}/10
          </span>
        </div>

        <p
          style={{
            fontFamily: "var(--font-body, inherit)",
            fontSize: 16,
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            margin: "var(--space-5) 0 0",
          }}
        >
          {active.quest.description}
        </p>

        {active.quest.location_text && (
          <p
            className="ds-meta-row"
            style={{ marginTop: "var(--space-4)" }}
          >
            <span className="ds-meta-item">
              <MapPin weight="duotone" size={14} aria-hidden="true" />
              {active.quest.location_text}
            </span>
          </p>
        )}

        <hr
          style={{
            border: 0,
            borderTop: "1px solid var(--border)",
            margin: "var(--space-7) 0 var(--space-6)",
          }}
        />

        <p
          className="ds-active-timer"
          data-paused={isPaused ? "true" : "false"}
        >
          {formatElapsed(elapsedMs)}
        </p>
        <p
          style={{
            fontFamily: "var(--font-body, inherit)",
            fontSize: 12,
            color: "var(--text-tertiary)",
            textAlign: "center",
            margin: "var(--space-3) 0 0",
          }}
        >
          Started {startedDistance}
        </p>

        <div className="ds-active-actions">
          <button
            type="button"
            className="ds-secondary-pill"
            onClick={() => insertEvent(isPaused ? "resumed" : "paused")}
            disabled={busy}
          >
            {isPaused ? (
              <>
                <Play weight="duotone" size={16} aria-hidden="true" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause weight="duotone" size={16} aria-hidden="true" />
                <span>Pause</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="ds-cta"
            style={{ width: "auto" }}
            onClick={goToComplete}
            disabled={busy}
          >
            <span>Complete</span>
          </button>
          <button
            type="button"
            className="ds-abandon-link"
            data-confirm={confirmAbandon ? "true" : "false"}
            onClick={() => {
              if (confirmAbandon) {
                insertEvent("abandoned");
              } else {
                setConfirmAbandon(true);
              }
            }}
            disabled={busy}
          >
            {confirmAbandon ? "Tap again to confirm" : "Abandon quest"}
          </button>
        </div>
      </div>
    </main>
  );
}
