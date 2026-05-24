"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Default 'submit' / button — set to 'button' for non-form steps. */
  type?: "button" | "submit";
  ariaLabel?: string;
};

/**
 * Full-width opal-gradient pill used at the bottom of every onboarding step.
 * On mobile it's fixed to the viewport bottom inside a safe-area padded bar;
 * on md+ it floats inline at the end of the column.
 */
export default function PrimaryCta({
  children,
  onClick,
  disabled = false,
  type = "button",
  ariaLabel,
}: Props) {
  return (
    <div className="ds-onboarding-cta-dock">
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className="ds-onboarding-cta"
        aria-label={ariaLabel}
      >
        {children}
      </button>
    </div>
  );
}
