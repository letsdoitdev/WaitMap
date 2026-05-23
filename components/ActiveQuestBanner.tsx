"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaretRight,
  Compass,
  Pause,
  Play,
} from "@phosphor-icons/react/dist/ssr";
import { useActiveQuest } from "@/lib/active-quest-context";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { computeElapsedMs, formatElapsed } from "@/lib/quest-lifecycle";

export default function ActiveQuestBanner() {
  const router = useRouter();
  const { active, refresh } = useActiveQuest();
  const { user } = useAuth();
  const supabase = createClient();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || active.state !== "active") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active || !user) return null;

  const elapsedMs = computeElapsedMs(
    active.events,
    new Date(Date.now()).toISOString(),
  );
  // tick is read so the linter knows the interval drives a re-render
  void tick;

  const isPaused = active.state === "paused";

  const togglePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    await supabase.from("quest_events").insert({
      quest_id: active.quest.id,
      user_id: user.id,
      event_type: isPaused ? "resumed" : "paused",
    });
    await refresh();
    setBusy(false);
  };

  const open = () => router.push("/quest/active");

  return (
    <div className="ds-active-banner-wrap">
      <div
        className="glass ds-active-banner"
        data-paused={isPaused ? "true" : "false"}
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") open();
        }}
      >
        <Compass
          weight="duotone"
          size={18}
          color="var(--text-secondary)"
          aria-hidden="true"
        />
        <span className="ds-active-banner-title">{active.quest.title}</span>
        <span className="ds-active-banner-timer">
          {isPaused ? "Paused · " : ""}
          {formatElapsed(elapsedMs)}
        </span>
        <button
          type="button"
          className="ds-active-banner-icon-btn"
          onClick={togglePause}
          disabled={busy}
          aria-label={isPaused ? "Resume quest" : "Pause quest"}
        >
          {isPaused ? (
            <Play weight="duotone" size={18} aria-hidden="true" />
          ) : (
            <Pause weight="duotone" size={18} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="ds-active-banner-icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          aria-label="Open active quest"
        >
          <CaretRight weight="duotone" size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
