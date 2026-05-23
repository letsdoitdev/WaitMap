"use client";

import { useStats } from "@/lib/stats-context";

// Opal palette pulled from --accent-grad — mint, lilac, pink, honey.
const OPAL_STOPS = ["#7dd3c0", "#c9a8e9", "#f4a4c0", "#f5c98a"];
const UNLIT = "rgba(255, 255, 255, 0.08)";
const GAP = "rgba(255, 255, 255, 0.02)";

export default function StreakRing() {
  const { streaks, trailing } = useStats();
  if (streaks.current < 1) return null;

  const total = trailing.length;
  const sliceDeg = 360 / total;
  const stops: string[] = [];
  let lit = 0;
  for (let i = 0; i < total; i++) {
    const start = (i * sliceDeg).toFixed(2);
    const end = ((i + 1) * sliceDeg - 0.5).toFixed(2);
    const color = trailing[i].completed
      ? OPAL_STOPS[lit++ % OPAL_STOPS.length]
      : UNLIT;
    stops.push(`${color} ${start}deg ${end}deg`);
    if (i < total - 1) {
      stops.push(`${GAP} ${end}deg ${(Number(end) + 0.5).toFixed(2)}deg`);
    }
  }

  return (
    <div className="ds-streak-ring-wrap" aria-live="polite">
      <div
        className="ds-streak-ring"
        style={{
          background: `conic-gradient(${stops.join(", ")})`,
        }}
        aria-label={`${streaks.current} day streak`}
      >
        <div className="ds-streak-ring-inner">
          <span className="ds-streak-ring-number">{streaks.current}</span>
          <span className="ds-streak-ring-sub">day streak</span>
        </div>
      </div>
    </div>
  );
}
