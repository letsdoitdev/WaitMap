"use client";

import BigPillChoice from "@/components/onboarding/BigPillChoice";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";
import type { QuestCategory } from "@/lib/quests";

type Props = {
  onAdvance: () => void;
};

// Reuse the existing category set from lib/quests.ts. Only the seven the
// M8 spec named — and each one is verified to appear on a real template.
const VIBE_OPTIONS: { label: string; value: QuestCategory }[] = [
  { label: "Chaos", value: "Chaos" },
  { label: "Outdoor", value: "Outdoor" },
  { label: "Social", value: "Social" },
  { label: "Creative", value: "Creative" },
  { label: "Food", value: "Food" },
  { label: "Late Night", value: "Late Night" },
  { label: "Chill", value: "Chill" },
];

export default function StepVibe({ onAdvance }: Props) {
  const { answers, setVibeCategories } = useOnboarding();
  const selected = answers.vibeCategories as QuestCategory[];
  const canAdvance = selected.length >= 1;

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">
          What kind of energy are you after?
        </h2>
        <p className="ds-onboarding-helper">Pick all that sound good.</p>

        <BigPillChoice
          options={VIBE_OPTIONS}
          selected={selected}
          onChange={(next) => setVibeCategories(next as string[])}
          multi
          ariaLabel="Vibe categories"
        />
      </div>

      <PrimaryCta
        disabled={!canAdvance}
        onClick={() => {
          track("onboarding_step_completed", {
            step: 3,
            value: selected,
          });
          onAdvance();
        }}
      >
        Continue
      </PrimaryCta>
    </>
  );
}
