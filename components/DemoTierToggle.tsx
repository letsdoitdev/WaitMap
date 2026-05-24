"use client";

import { useState } from "react";
import { CircleNotch } from "@phosphor-icons/react/dist/ssr";
import { useAuth } from "@/lib/auth-context";
import { ADMIN_EMAILS } from "@/lib/constants";

// Demo-only tier flip surfaced inside UserMenu (M12.2). Visibility here is a
// convenience gate — /api/admin/tier re-checks the admin email server-side.
export default function DemoTierToggle() {
  const { user, tier, refreshTier } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) return null;

  const nextTier = tier === "pro" ? "free" : "pro";
  const buttonLabel = tier === "pro" ? "Become Free" : "Become Pro";

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: nextTier }),
      });
      if (!res.ok) {
        setError("Couldn’t switch tier.");
        return;
      }
      await refreshTier();
    } catch {
      setError("Couldn’t switch tier.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ds-user-menu-item"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        gap: "var(--space-2)",
        cursor: "default",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
        }}
      >
        <span>Tier: {tier}</span>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-glass-strong)",
            color: "var(--text-tertiary)",
          }}
        >
          DEMO
        </span>
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="ds-suggest-pill"
        style={{ justifyContent: "center" }}
      >
        {busy ? (
          <CircleNotch
            weight="duotone"
            size={14}
            aria-hidden="true"
            className="animate-spin"
          />
        ) : null}
        <span>{buttonLabel}</span>
      </button>
      {error && (
        <span
          style={{
            fontSize: "12px",
            color: "var(--error)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
