"use client";

import { useEffect, useRef } from "react";
import PrimaryCta from "@/components/onboarding/PrimaryCta";
import { track } from "@/lib/analytics";

type Props = {
  onAdvance: () => void;
};

export default function StepWelcome({ onAdvance }: Props) {
  const fired = useRef(false);
  // Fire onboarding_started exactly once when the welcome step mounts —
  // even under Strict Mode's double-effect in dev.
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track("onboarding_started", {});
  }, []);

  return (
    <>
      <div className="ds-onboarding-step ds-onboarding-step--center">
        <h1 className="ds-onboarding-wordmark">Unemployment</h1>
        <p className="ds-onboarding-sub">
          Spontaneous IRL adventures for you and your friends.
        </p>
      </div>

      <PrimaryCta
        onClick={() => {
          track("onboarding_step_completed", { step: 1, value: null });
          onAdvance();
        }}
      >
        Get started
      </PrimaryCta>
    </>
  );
}
