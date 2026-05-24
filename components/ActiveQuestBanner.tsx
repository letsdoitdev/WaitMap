"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaretRight,
  CheckCircle,
  Compass,
} from "@phosphor-icons/react/dist/ssr";
import { useActiveQuest } from "@/lib/active-quest-context";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { computeElapsedMs, formatElapsed } from "@/lib/quest-lifecycle";

export default function ActiveQuestBanner() {
  const router = useRouter();
  const { active } = useActiveQuest();
  const { user } = useAuth();
  const pathname = usePathname();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active || active.state !== "active") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (pathname?.startsWith("/onboarding")) return null;
  if (!active || !user) return null;

  void tick;
  const elapsedMs = computeElapsedMs(
    active.events,
    new Date(Date.now()).toISOString(),
  );
  const isPaused = active.state === "paused";

  const open = () => router.push("/quest/active");
  const goComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/quest/${active.quest.id}/complete`);
  };

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
        <span className="ds-active-banner-title">Quest in progress</span>
        <span className="ds-active-banner-timer">
          {isPaused ? "Paused · " : ""}
          {formatElapsed(elapsedMs)}
        </span>
        <button
          type="button"
          className="ds-secondary-pill"
          style={{ minHeight: 36, padding: "0 14px", fontSize: 13 }}
          onClick={goComplete}
          aria-label="Complete quest"
        >
          <CheckCircle weight="duotone" size={16} aria-hidden="true" />
          <span>Complete</span>
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
