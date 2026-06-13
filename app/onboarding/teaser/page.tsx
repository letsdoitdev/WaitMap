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
import { type GeneratedQuest } from "@/lib/generate";
import { appendRecentQuestIds } from "@/lib/recent-quests";
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

  // Static preview teaser. The personalized local generator was removed
  // (AI-only migration); the teaser now shows a single curated example
  // chosen by the user's spice tier so it still feels tonally aligned with
  // their onboarding answers without requiring a network call here.
  const teaser = useMemo<GeneratedQuest | null>(() => {
    if (loading) return null;
    const spice = answers.spice;
    const TEASER_SAMPLES: GeneratedQuest[] = [
      {
        id: "teaser-chill",
        title: "Highest Point Before Sunrise",
        description:
          "Split into pairs, race without navigation to find the highest elevation spot in your area before sunrise. Meet at the top and watch it together.",
        category: "Outdoor",
        spice: 2,
        minGroup: 2,
        maxGroup: 6,
        minTime: 60,
        maxTime: 120,
        cost: "free",
        nearbyDetected: false,
      },
      {
        id: "teaser-mid",
        title: "Bowling Loser Cooks",
        description:
          "One game, one rule: lowest score has to cook a full breakfast for the group the next morning. No handicaps, no mercy.",
        category: "Social",
        spice: 5,
        minGroup: 2,
        maxGroup: 6,
        minTime: 60,
        maxTime: 90,
        cost: "$",
        nearbyDetected: false,
      },
      {
        id: "teaser-spicy",
        title: "Home Depot Fake Emergency",
        description:
          "Each person uses an AI image generator to create a photorealistic fake home emergency (car crashed into kitchen, raccoon in dishwasher, ball pit filling basement). Walk into Home Depot, show the image to an employee, ask for serious repair advice. Cannot break character. Others watch from a distance.",
        category: "Chaos",
        spice: 8,
        minGroup: 2,
        maxGroup: 6,
        minTime: 45,
        maxTime: 75,
        cost: "free",
        nearbyDetected: false,
      },
    ];
    const tier = spice <= 3 ? 0 : spice <= 6 ? 1 : 2;
    return TEASER_SAMPLES[tier];
  }, [loading, answers.spice]);

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
