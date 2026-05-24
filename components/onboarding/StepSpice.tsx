"use client";

import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { useOnboarding } from "@/lib/onboarding-context";
import { track } from "@/lib/analytics";

type Props = {
  onAdvance: () => void;
};

/**
 * Live label that maps the 0..10 slider to the anchors the spec calls for.
 * Endpoints get the exact spec strings; the in-between bands are quick
 * one-liners so the user gets feedback as they drag.
 */
function labelFor(spice: number): string {
  if (spice <= 0) return "Wholesome";
  if (spice >= 10) return "Unhinged";
  if (spice <= 2) return "Easy-going";
  if (spice <= 4) return "Adventurous";
  if (spice <= 6) return "Daring";
  if (spice <= 8) return "Wild";
  return "Bold";
}

export default function StepSpice({ onAdvance }: Props) {
  const { answers, setSpice } = useOnboarding();
  const spice = answers.spice;
  const fillPct = (spice / 10) * 100;

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">
          How weird are you willing to get?
        </h2>

        <div className="ds-onboarding-spice">
          <div className="ds-onboarding-spice-readout">
            <span className="ds-onboarding-spice-number">{spice}</span>
            <span className="ds-onboarding-spice-label">{labelFor(spice)}</span>
          </div>

          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={spice}
            onChange={(e) => setSpice(Number(e.target.value))}
            className="ds-slider ds-onboarding-slider"
            data-fill="warning"
            style={
              {
                ["--fill-pct" as string]: `${fillPct}%`,
              } as React.CSSProperties
            }
            aria-label="Spice level"
          />

          <div className="ds-onboarding-spice-anchors" aria-hidden="true">
            <span>0 wholesome</span>
            <span>10 unhinged</span>
          </div>
        </div>
      </div>

      <PrimaryCta
        onClick={() => {
          track("onboarding_step_completed", { step: 4, value: spice });
          onAdvance();
        }}
      >
        Continue
      </PrimaryCta>
    </>
  );
}
