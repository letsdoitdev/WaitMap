"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import ProgressBar from "@/components/onboarding/ProgressBar";
import StepWelcome from "@/components/onboarding/StepWelcome";
import StepGroup from "@/components/onboarding/StepGroup";
import { useOnboarding } from "@/lib/onboarding-context";

const TOTAL_STEPS = 8;

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isComplete, loading } = useOnboarding();
  const forceFlag = searchParams?.get("force") === "1";
  const stepRaw = Number(searchParams?.get("step") ?? "1");
  const step = Math.max(1, Math.min(TOTAL_STEPS, Number.isFinite(stepRaw) ? stepRaw : 1));

  // Already completed? Bounce home unless ?force=1.
  useEffect(() => {
    if (loading || forceFlag) return;
    if (isComplete) router.replace("/");
  }, [loading, isComplete, forceFlag, router]);

  const goTo = (nextStep: number) => {
    const n = Math.max(1, Math.min(TOTAL_STEPS, nextStep));
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("step", String(n));
    router.push(`/onboarding?${params.toString()}`);
  };

  const onBack = step > 1 ? () => goTo(step - 1) : null;
  const onAdvance = () => goTo(step + 1);

  return (
    <div className="ds-onboarding-frame">
      <ProgressBar current={step} total={TOTAL_STEPS} />

      <div className="ds-onboarding-topbar">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="ds-onboarding-back"
            aria-label="Back"
          >
            <CaretLeft weight="duotone" size={20} aria-hidden="true" />
          </button>
        ) : (
          <span className="ds-onboarding-back" aria-hidden="true" />
        )}
      </div>

      <OnboardingShell>
        {step === 1 && <StepWelcome onAdvance={onAdvance} />}
        {step === 2 && <StepGroup onAdvance={onAdvance} />}
        {step >= 3 && (
          <div className="ds-onboarding-placeholder">
            <p
              className="ds-empty-state-text"
              style={{
                fontFamily: "var(--font-display, serif)",
                fontSize: "clamp(24px, 6vw, 30px)",
                color: "var(--text-primary)",
              }}
            >
              Step {step}
            </p>
            <p className="ds-empty-state-text">
              Coming in the next M8 substep.
            </p>
            <button
              type="button"
              className="ds-onboarding-cta"
              onClick={() => goTo(Math.min(TOTAL_STEPS, step + 1))}
            >
              <span>Skip for now</span>
            </button>
          </div>
        )}
      </OnboardingShell>
    </div>
  );
}

export default function OnboardingPage() {
  // useSearchParams must be wrapped in Suspense for the App Router static
  // boundary — even though we render fully client-side.
  return (
    <Suspense
      fallback={
        <div className="ds-onboarding-frame">
          <ProgressBar current={1} total={TOTAL_STEPS} />
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
