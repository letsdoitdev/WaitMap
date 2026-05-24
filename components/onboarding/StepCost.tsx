"use client";

import BigPillChoice from "@/components/onboarding/BigPillChoice";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";
import type { CostPref } from "@/lib/database.types";

type Props = {
  onAdvance: () => void;
};

const COST_OPTIONS: { label: string; value: CostPref }[] = [
  { label: "Free only", value: "free" },
  { label: "Cheap is fine", value: "cheap" },
  { label: "Money is not the point", value: "any" },
];

export default function StepCost({ onAdvance }: Props) {
  const { answers, setCostPref } = useOnboarding();
  const selected = answers.costPref ? [answers.costPref] : [];
  const canAdvance = selected.length === 1;

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">Money situation?</h2>

        <BigPillChoice
          options={COST_OPTIONS}
          selected={selected as CostPref[]}
          onChange={(next) => {
            const v = next[0] as CostPref | undefined;
            if (v) setCostPref(v);
          }}
          multi={false}
          ariaLabel="Cost preference"
        />
      </div>

      <PrimaryCta
        disabled={!canAdvance}
        onClick={() => {
          track("onboarding_step_completed", {
            step: 7,
            value: answers.costPref,
          });
          onAdvance();
        }}
      >
        Continue
      </PrimaryCta>
    </>
  );
}
