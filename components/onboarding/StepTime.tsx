"use client";

import BigPillChoice from "@/components/onboarding/BigPillChoice";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";

type Props = {
  onAdvance: () => void;
};

// String values keep BigPillChoice generic happy — we convert to number
// when we write back into the context.
const TIME_OPTIONS: { label: string; value: string }[] = [
  { label: "30 min", value: "30" },
  { label: "1 hr", value: "60" },
  { label: "2 hr", value: "120" },
  { label: "Open-ended", value: "240" },
];

export default function StepTime({ onAdvance }: Props) {
  const { answers, setTimeMinutes } = useOnboarding();
  const selected = [String(answers.timeMinutes)];
  const canAdvance = TIME_OPTIONS.some((o) => o.value === String(answers.timeMinutes));

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">How long do you usually have?</h2>

        <BigPillChoice
          options={TIME_OPTIONS}
          selected={selected}
          onChange={(next) => {
            const v = Number(next[0] ?? answers.timeMinutes);
            setTimeMinutes(v);
          }}
          multi={false}
          ariaLabel="Time available"
        />
      </div>

      <PrimaryCta
        disabled={!canAdvance}
        onClick={() => {
          track("onboarding_step_completed", {
            step: 5,
            value: answers.timeMinutes,
          });
          onAdvance();
        }}
      >
        Continue
      </PrimaryCta>
    </>
  );
}
