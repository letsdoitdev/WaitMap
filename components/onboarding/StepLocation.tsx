"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotch, Crosshair } from "@phosphor-icons/react/dist/ssr";
import { track } from "@/lib/analytics";
import { useOnboarding } from "@/lib/onboarding-context";

/**
 * Reverse-geocode lat/lng → "Place Region" via Mapbox v5, matching the
 * format used by the home crosshair button (M7.2). Returns null on any
 * failure — the caller falls back to leaving the input blank.
 */
async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality,neighborhood&limit=1&access_token=${token}`,
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      features?: {
        text?: string;
        context?: { id?: string; short_code?: string; text?: string }[];
      }[];
    };
    const feature = data.features?.[0];
    if (!feature?.text) return null;
    const region = feature.context?.find((c) => c.id?.startsWith("region"));
    const regionShort = region?.short_code?.replace(/^us-/i, "").toUpperCase();
    const regionText =
      region?.short_code?.toLowerCase().startsWith("us-") && region.text
        ? region.text
        : (regionShort ?? region?.text ?? "");
    return regionText ? `${feature.text} ${regionText}` : feature.text;
  } catch {
    return null;
  }
}

export default function StepLocation() {
  const router = useRouter();
  const { markCompleted } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMyLocation = () => {
    if (busy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location unavailable — type your city on the next screen.");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const label = await reverseGeocode(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (label) {
          try {
            localStorage.setItem("sqLocation", label);
            localStorage.setItem(
              "lastKnownGeo",
              JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                label,
                timestamp: Date.now(),
              }),
            );
          } catch {
            // ignore quota / privacy mode
          }
        }
        track("onboarding_location_granted", { label });
        track("onboarding_step_completed", { step: 8, value: label });
        router.push("/onboarding/teaser");
      },
      () => {
        // Permission denied or timed out. Still advance to the teaser so
        // the value moment lands; we'll let the user type their city on /.
        setBusy(false);
        track("onboarding_location_granted", { label: null, denied: true });
        track("onboarding_step_completed", { step: 8, value: null });
        router.push("/onboarding/teaser");
      },
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  };

  const skip = () => {
    track("onboarding_location_skipped", {});
    track("onboarding_step_completed", { step: 8, value: "skipped" });
    // Per spec — skip lands on home with the location input focused. We
    // also finalize the onboarding flag here because the teaser is gated
    // behind a location attempt; users who decline get straight to /.
    markCompleted();
    track("onboarding_completed", { via: "skip" });
    router.push("/?focus=1");
  };

  return (
    <>
      <div className="ds-onboarding-step">
        <h2 className="ds-onboarding-h2">One last thing.</h2>
        <p className="ds-onboarding-sub" style={{ maxWidth: "none" }}>
          We need your location to find quests near you. We never store or
          share it.
        </p>
        {error && (
          <p
            className="ds-onboarding-helper"
            style={{ color: "var(--warning)", marginTop: 0 }}
          >
            {error}
          </p>
        )}
      </div>

      <div className="ds-onboarding-cta-dock ds-onboarding-cta-dock--stack">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={busy}
          className="ds-onboarding-cta"
          aria-label="Use my location"
        >
          {busy ? (
            <>
              <CircleNotch
                weight="duotone"
                size={18}
                aria-hidden="true"
                className="animate-spin"
              />
              <span>Finding you…</span>
            </>
          ) : (
            <>
              <Crosshair weight="duotone" size={18} aria-hidden="true" />
              <span>Use my location</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={busy}
          className="ds-onboarding-textlink"
        >
          I&apos;ll type it in
        </button>
      </div>
    </>
  );
}
