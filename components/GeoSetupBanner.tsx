"use client";

import { useEffect, useState } from "react";
import { Copy, Database, X } from "@phosphor-icons/react/dist/ssr";
import { GEO_MIGRATION_SQL, isGeoCircuitOpen } from "@/lib/geocode";

/**
 * One-shot banner that appears on /history when this session has detected
 * that the geocode `lat` / `lng` columns are missing from `public.quests`.
 * Gives the user the exact SQL to paste into the Supabase SQL editor —
 * after running it once, the next page load won't flip the circuit, so the
 * banner won't reappear.
 *
 * We poll once per second for the first ten seconds (the circuit usually
 * trips within the first geocode round-trip; we just need to react quickly
 * without subscribing to a custom event).
 */
export default function GeoSetupBanner() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const tick = () => setOpen(isGeoCircuitOpen());
    tick();
    const id = window.setInterval(tick, 1000);
    const stop = window.setTimeout(() => window.clearInterval(id), 10_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, []);

  if (!open || dismissed) return null;

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(GEO_MIGRATION_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore — user can still select the visible <pre> manually
    }
  };

  return (
    <div
      className="glass ds-geo-banner"
      role="status"
      aria-label="Database setup required"
    >
      <div className="ds-geo-banner-head">
        <span className="ds-geo-banner-icon" aria-hidden="true">
          <Database weight="duotone" size={18} />
        </span>
        <p className="ds-geo-banner-title">
          Map pins are paused — one-time database setup required.
        </p>
        <button
          type="button"
          className="ds-geo-banner-close"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X weight="duotone" size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="ds-geo-banner-body">
        Paste the SQL below into your Supabase SQL editor and run it. Pins
        will start appearing on the next page load.
      </p>
      <pre className="ds-geo-banner-sql">{GEO_MIGRATION_SQL}</pre>
      <button
        type="button"
        className="ds-geo-banner-copy"
        onClick={copySql}
      >
        <Copy weight="duotone" size={14} aria-hidden="true" />
        <span>{copied ? "Copied" : "Copy SQL"}</span>
      </button>
    </div>
  );
}
