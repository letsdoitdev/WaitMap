"use client";

type Props = {
  current: number;
  total: number;
};

/**
 * 4 px top progress bar with the opal gradient. Updates via inline width %
 * so the SSR render shows the right slice on first paint.
 */
export default function ProgressBar({ current, total }: Props) {
  const clamped = Math.max(0, Math.min(total, current));
  const pct = Math.round((clamped / total) * 100);
  return (
    <div
      className="ds-onboarding-progress-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clamped}
      aria-label={`Step ${clamped} of ${total}`}
    >
      <div className="ds-onboarding-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
