import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome — Unemployment",
};

/**
 * Full-bleed dark container. The root layout already mounts the design-system
 * background layers (.ds-bg-noise + .ds-bg-blob), and the global chrome
 * components (UserMenu, ActiveQuestBanner, BottomNav, UploadQueueIndicator)
 * all self-suppress on /onboarding/*, so this layout just frames the step
 * column.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="ds-onboarding-root">{children}</div>;
}
