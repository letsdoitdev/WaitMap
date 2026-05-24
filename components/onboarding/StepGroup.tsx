"use client";

import BigPillChoice from "@/components/onboarding/BigPillChoice";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";
import type { GroupMode } from "@/lib/database.types";

type Props = {
  onAdvance: () => void;
};

const OPTIONS: { label: string; value: GroupMode }[] = [
  { label: "Solo", value: "Solo" },
  { label: "Partner", value: "Partner" },
  { label: "Roommates", value: "Roommates" },
  { label: "Close friends", value: "Close friends" },
  { label: "Bigger group", value: "Bigger group" },
  { label: "Family", value: "Family" },
];

export default function StepGroup({ onAdvance }: Props) {
  const { answers, setGroupModes } = useOnboarding();
  const selected = answers.groupModes;
  const canAdvance = selected.length >= 1;

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">
          Who are you usually questing with?
        </h2>
        <p className="ds-onboarding-helper">Pick all that apply.</p>

        <BigPillChoice
          options={OPTIONS}
          selected={selected}
          onChange={(next) => setGroupModes(next)}
          multi
          ariaLabel="Group modes"
        />
      </div>

      <PrimaryCta
        disabled={!canAdvance}
        onClick={() => {
          track("onboarding_step_completed", {
            step: 2,
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
