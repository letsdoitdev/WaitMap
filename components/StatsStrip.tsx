"use client";

import { memo } from "react";
import { useStats } from "@/lib/stats-context";

function formatHours(h: number): string {
  if (h < 1) {
    return `${Math.round(h * 60)}m`;
  }
  if (h < 10) {
    return `${h.toFixed(1)}h`;
  }
  return `${Math.round(h)}h`;
}

function StatsStrip() {
  const { totals, streaks, completedEvents } = useStats();

  // Hide entirely until the user has at least one completion — empty zeros
  // across the strip would just be noise.
  if (completedEvents.length === 0) return null;

  return (
    <div
      className="ds-stats-strip"
      role="group"
      aria-label="Your quest stats"
    >
      <div className="ds-stat-cell">
        <span className="ds-stat-number">{totals.count}</span>
        <span className="ds-stat-label">Completed</span>
      </div>
      <div className="ds-stat-cell" data-accent="true">
        <span className="ds-stat-number">{streaks.current}</span>
        <span className="ds-stat-label">Current streak</span>
      </div>
      <div className="ds-stat-cell">
        <span className="ds-stat-number">{streaks.longest}</span>
        <span className="ds-stat-label">Longest</span>
      </div>
      <div className="ds-stat-cell">
        <span className="ds-stat-number">{formatHours(totals.hoursSpent)}</span>
        <span className="ds-stat-label">Hours spent</span>
      </div>
    </div>
  );
}

export default memo(StatsStrip);
