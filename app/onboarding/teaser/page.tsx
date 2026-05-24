"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  CurrencyDollar,
  ForkKnife,
  Lightning,
  Moon,
  PaintBrush,
  Sparkle,
  Tree,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth-context";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";
import { generateQuests, type GeneratedQuest } from "@/lib/generate";
import { GROUP_MODE_SIZE } from "@/lib/onboarding-context";
import { appendRecentQuestIds, loadRecentQuestIds } from "@/lib/recent-quests";
import SignInModal from "@/components/SignInModal";
import type { QuestCategory } from "@/lib/quests";

const CATEGORY_ICONS: Record<QuestCategory, Icon> = {
  Social: UsersThree,
  Outdoor: Tree,
  Chaos: Lightning,
  Creative: PaintBrush,
  Food: ForkKnife,
  "Late Night": Moon,
  Chill: Sparkle,
  Fitness: Sparkle,
  Nature: Sparkle,
  Tech: Sparkle,
  Exploration: Sparkle,
  Indoor: Sparkle,
};

export default function TeaserPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { answers, markCompleted, loading } = useOnboarding();
  const [signInOpen, setSignInOpen] = useState(false);
  const [saveDismissed, setSaveDismissed] = useState(false);
  const tracked = useRef(false);

  // Derive group size from the spec mapping, taking MAX across selected
  // modes. Defaults to 3 if the user somehow lands here with no group
  // modes (deep-linked /onboarding/teaser without finishing the quiz).
  const groupSize = useMemo(() => {
    if (answers.groupModes.length === 0) return 3;
    return Math.max(
      ...answers.groupModes.map((m) => GROUP_MODE_SIZE[m] ?? 3),
    );
  }, [answers.groupModes]);

  // Single deterministic-ish pick from the user's prefs. We respect the
  // recent-quests ring buffer so the teaser doesn't show a quest the user
  // will immediately see again on the home reroll.
  const teaser = useMemo<GeneratedQuest | null>(() => {
    if (loading) return null;
    const city =
      (typeof window !== "undefined" &&
        localStorage.getItem("sqLocation")) ||
      "your city";
    const recent = loadRecentQuestIds();
    const result = generateQuests(
      {
        city,
        groupSize,
        timeMinutes: answers.timeMinutes,
        spice: answers.spice,
        excludeIds: recent,
        onboardingPrefs: {
          vibe_categories: answers.vibeCategories,
          cost_pref: answers.costPref ?? undefined,
        },
      },
      1,
    );
    return result.quests[0] ?? null;
  }, [
    loading,
    groupSize,
    answers.timeMinutes,
    answers.spice,
    answers.vibeCategories,
    answers.costPref,
  ]);

  useEffect(() => {
    if (!teaser || tracked.current) return;
    tracked.current = true;
    track("teaser_quest_shown", {
      questId: teaser.id,
      category: teaser.category,
      spice: teaser.spice,
    });
    // Seed the recent buffer so the same teaser isn't first-up on the home
    // reroll the user is about to land on.
    appendRecentQuestIds([teaser.id]);
  }, [teaser]);

  const onShowRest = () => {
    track("teaser_cta_clicked", { questId: teaser?.id ?? null });
    markCompleted();
    track("onboarding_completed", { via: "teaser" });
    router.push("/");
  };

  if (loading) {
    return (
      <main className="ds-onboarding-shell">
        <p
          className="ds-empty-state-text"
          style={{ color: "var(--text-tertiary)", fontSize: 14 }}
        >
          Loading…
        </p>
      </main>
    );
  }

  if (!teaser) {
    return (
      <main className="ds-onboarding-shell">
        <h2 className="ds-onboarding-h2">Couldn&apos;t pick a quest.</h2>
        <p className="ds-onboarding-helper">
          Head home and reroll — it&apos;ll work there.
        </p>
        <div className="ds-onboarding-cta-dock">
          <button
            type="button"
            className="ds-onboarding-cta"
            onClick={() => {
              markCompleted();
              router.push("/");
            }}
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  const CategoryIcon = CATEGORY_ICONS[teaser.category] ?? Sparkle;
  const spicePct = Math.max(0, Math.min(100, (teaser.spice / 10) * 100));

  return (
    <>
      <main className="ds-onboarding-shell">
        <div className="ds-onboarding-step">
          <p
            className="ds-empty-state-text"
            style={{
              color: "var(--text-secondary)",
              fontSize: 14,
              margin: 0,
            }}
          >
            Based on your answers, here is a taste.
          </p>

          <article className="glass ds-card ds-teaser-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ds-cat-chip">
                <span className="ds-cat-chip-icon" aria-hidden="true">
                  <CategoryIcon weight="duotone" size={12} />
                </span>
                {teaser.category}
              </span>
            </div>
            <h3 className="ds-card-title mt-3">{teaser.title}</h3>
            <p className="ds-card-desc">{teaser.description}</p>
            <div className="ds-meta-row">
              <span className="ds-meta-item">
                <UsersThree weight="duotone" size={14} aria-hidden="true" />
                {teaser.minGroup === teaser.maxGroup
                  ? teaser.minGroup
                  : `${teaser.minGroup}-${teaser.maxGroup}`}
              </span>
              <span className="ds-meta-item">
                <Clock weight="duotone" size={14} aria-hidden="true" />
                {teaser.minTime === teaser.maxTime
                  ? `${teaser.minTime}m`
                  : `${teaser.minTime}-${teaser.maxTime}m`}
              </span>
              {teaser.cost && (
                <span className="ds-meta-item">
                  <CurrencyDollar
                    weight="duotone"
                    size={14}
                    aria-hidden="true"
                  />
                  {teaser.cost}
                </span>
              )}
            </div>
            <div className="ds-spice">
              <div
                className="ds-spice-track"
                role="img"
                aria-label={`Spice ${teaser.spice} of 10`}
              >
                <div className="ds-spice-fill" style={{ width: `${spicePct}%` }} />
              </div>
              <span className="ds-spice-label">
                Spice · {teaser.spice}/10
              </span>
            </div>
          </article>

          {!user && !saveDismissed && (
            <div
              className="glass ds-teaser-save-row"
              role="region"
              aria-label="Sign in"
            >
              <div>
                <p className="ds-teaser-save-title">Save your quests + streak</p>
                <p className="ds-teaser-save-sub">
                  Optional. Sign in to keep history across devices.
                </p>
              </div>
              <div className="ds-teaser-save-actions">
                <button
                  type="button"
                  className="ds-secondary-pill"
                  onClick={() => setSignInOpen(true)}
                >
                  <span>Sign in</span>
                </button>
                <button
                  type="button"
                  className="ds-teaser-save-dismiss"
                  onClick={() => setSaveDismissed(true)}
                  aria-label="Dismiss"
                >
                  <X weight="duotone" size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ds-onboarding-cta-dock">
          <button
            type="button"
            className="ds-onboarding-cta"
            onClick={onShowRest}
          >
            Show me the rest
          </button>
        </div>
      </main>

      <SignInModal
        open={signInOpen}
        intent="save"
        onClose={() => setSignInOpen(false)}
      />
    </>
  );
}
