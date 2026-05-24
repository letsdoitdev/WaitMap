"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Single-column step container. Mobile-first max-w-md, opens to max-w-lg on
 * md+. The fixed-bottom CTA pattern lives on each step; this shell just
 * reserves the column width + vertical rhythm.
 */
export default function OnboardingShell({ children }: Props) {
  return <main className="ds-onboarding-shell">{children}</main>;
}
