"use client";

const DEV = process.env.NODE_ENV !== "production";

export type AnalyticsEvent =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_location_granted"
  | "onboarding_location_skipped"
  | "onboarding_completed"
  | "teaser_quest_shown"
  | "teaser_cta_clicked"
  | "review_prompt_shown"
  | "review_prompt_accepted"
  | "review_prompt_dismissed";

export type AnalyticsProps = Record<string, unknown>;

/**
 * Fire-and-forget event tracker.
 *
 * The implementation is intentionally tiny — `console.info` in dev so we can
 * eyeball event flow in DevTools, plus a POST to /api/track which is a 200-no-op
 * stub today. When we wire a vendor (PostHog / Plausible / etc.) the only
 * change is the body of /api/track + maybe a script load — every callsite
 * stays put.
 */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;
  if (DEV) console.info("[analytics]", event, props);
  try {
    const payload = JSON.stringify({
      event,
      props,
      ts: Date.now(),
      url: window.location.pathname + window.location.search,
    });
    // sendBeacon survives page navigation; fetch fallback for older browsers.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/track", blob);
    } else {
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // swallow — analytics is best-effort
      });
    }
  } catch {
    // swallow — analytics must never break the app
  }
}
