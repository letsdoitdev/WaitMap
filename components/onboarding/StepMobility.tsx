"use client";

import BigPillChoice from "@/components/onboarding/BigPillChoice";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";

type Props = {
  onAdvance: () => void;
};

const MOBILITY_OPTIONS: { label: string; value: "yes" | "no" }[] = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
];

export default function StepMobility({ onAdvance }: Props) {
  const { answers, setCanDrive } = useOnboarding();
  const selected =
    answers.canDrive === true ? ["yes"] : answers.canDrive === false ? ["no"] : [];
  const canAdvance = selected.length === 1;

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">Can you drive?</h2>

        <BigPillChoice
          options={MOBILITY_OPTIONS}
          selected={selected as ("yes" | "no")[]}
          onChange={(next) => {
            const v = next[0];
            if (v === "yes") setCanDrive(true);
            else if (v === "no") setCanDrive(false);
          }}
          multi={false}
          ariaLabel="Can you drive"
        />
      </div>

      <PrimaryCta
        disabled={!canAdvance}
        onClick={() => {
          track("onboarding_step_completed", {
            step: 6,
            value: answers.canDrive,
          });
          onAdvance();
        }}
      >
        Continue
      </PrimaryCta>
    </>
  );
}
