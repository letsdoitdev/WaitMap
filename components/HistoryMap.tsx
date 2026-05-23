"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  MapPin,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import type { Map as MapboxMap, Marker as MapboxMarker } from "mapbox-gl";
import { useStats } from "@/lib/stats-context";
import {
  geocodeLocation,
  hasMapboxToken,
  upsertQuestCoords,
} from "@/lib/geocode";
import type { Quest, QuestMedia } from "@/lib/database.types";

const DEV = process.env.NODE_ENV !== "production";
const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const CONTINENTAL_US_CENTER: [number, number] = [-98.5795, 39.8283];

type PinQuest = Quest & {
  lat: number;
  lng: number;
  thumbUrl?: string;
};

type Props = {
  /** Pass true when the map mode is the visible mode on /history. We keep
   * the component mounted in both modes so Mapbox doesn't re-initialize on
   * every toggle; when this flips back to true we call map.resize(). */
  visible?: boolean;
  /** Hoisted media + signed URLs so we don't double-fetch quest_media on
   * every /history mount (M7.3 dedupe — the list view already pulls these). */
  media?: QuestMedia[];
  signedUrls?: Record<string, string>;
  /** When set, non-matching markers fade to 0.15 opacity instead of being
   * removed — keeps the map from flashing on category filter changes. */
  categoryFilter?: string | null;
};

export default function HistoryMap({
  visible = true,
  media: mediaProp,
  signedUrls: signedUrlsProp,
  categoryFilter = null,
}: Props) {
  const router = useRouter();
  const { quests, refresh: refreshStats } = useStats();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, MapboxMarker>>(new Map());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [pendingCoords, setPendingCoords] = useState(0);
  const media = useMemo(() => mediaProp ?? [], [mediaProp]);
  const signedUrls = useMemo(() => signedUrlsProp ?? {}, [signedUrlsProp]);
  const [geocodedPatch, setGeocodedPatch] = useState<
    Record<string, { lat: number; lng: number }>
  >({});

  const tokenPresent = hasMapboxToken();

  // Resize when becoming visible (display:none → block).
  useEffect(() => {
    if (!visible || !mapRef.current) return;
    const id = requestAnimationFrame(() => {
      mapRef.current?.resize();
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  // Lazy-geocode quests that still need coords. (The list-view backfill from
  // M7.3 also runs this path; we leave it for the case where the user comes
  // straight to the map mode on first mount.)
  useEffect(() => {
    if (!tokenPresent || quests.length === 0) return;
    const needs = quests.filter((q) => q.lat == null || q.lng == null);
    if (needs.length === 0) {
      setPendingCoords(0);
      return;
    }
    setPendingCoords(needs.length);

    let cancelled = false;
    (async () => {
      let anyPersisted = false;
      for (const q of needs) {
        if (cancelled) return;
        if (!q.location_text) {
          setPendingCoords((n) => Math.max(0, n - 1));
          continue;
        }
        const coords = await geocodeLocation(q.location_text);
        if (cancelled) return;
        if (coords) {
          setGeocodedPatch((prev) => ({ ...prev, [q.id]: coords }));
          const result = await upsertQuestCoords(q.id, coords);
          if (result.ok) anyPersisted = true;
        }
        setPendingCoords((n) => Math.max(0, n - 1));
      }
      if (!cancelled && anyPersisted) await refreshStats();
    })();
    return () => {
      cancelled = true;
    };
  }, [quests, tokenPresent, refreshStats]);

  // Validate every coord at the source. typeof + isFinite is on purpose —
  // strings, NaN, or Infinity from a misconfigured backfill should not turn
  // into a marker at (0, 0).
  const pinQuests: PinQuest[] = useMemo(() => {
    const mediaByQuest = new Map<string, QuestMedia[]>();
    for (const m of media) {
      const arr = mediaByQuest.get(m.quest_id) ?? [];
      arr.push(m);
      mediaByQuest.set(m.quest_id, arr);
    }
    const out: PinQuest[] = [];
    for (const q of quests) {
      const patched = geocodedPatch[q.id];
      const lat = patched?.lat ?? q.lat;
      const lng = patched?.lng ?? q.lng;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }
      const firstMedia = mediaByQuest.get(q.id)?.[0];
      const thumbUrl = firstMedia ? signedUrls[firstMedia.id] : undefined;
      out.push({ ...q, lat, lng, thumbUrl });
    }
    return out;
  }, [quests, geocodedPatch, media, signedUrls]);

  // Initialize Mapbox the first time the container becomes visible. We wait
  // on BOTH `load` and `styledata` because Mapbox style requests sometimes
  // 503 — when they do, `load` never fires but the basemap-less canvas is
  // still usable for markers. One retry of the style URL on `error` covers
  // the transient case; a hard failure leaves the basemap blank but lets
  // markers render on top.
  useEffect(() => {
    if (!tokenPresent || !visible || !containerRef.current || mapRef.current)
      return;
    let cancelled = false;
    let styleRetried = false;
    (async () => {
      try {
        // @ts-expect-error — Mapbox CSS file has no module declaration.
        await import("mapbox-gl/dist/mapbox-gl.css");
        const mod = await import("mapbox-gl");
        if (cancelled || !containerRef.current) return;
        const mapboxgl = mod.default;
        mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: CONTINENTAL_US_CENTER,
          zoom: 2.6,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }));

        const flipReady = () => {
          if (cancelled || mapReady) return;
          setMapReady(true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => map.resize());
          });
        };

        map.on("load", flipReady);
        // styledata fires even when the initial style is replaced after a
        // retry — covers the 503 fall-through where `load` never arrives.
        map.on("styledata", flipReady);

        map.on("error", (e: { error?: { status?: number; message?: string } }) => {
          const status = e?.error?.status;
          if (DEV) console.warn("[map] error", status, e?.error?.message);
          if (!styleRetried && (status === 503 || status === 502 || status === 504)) {
            styleRetried = true;
            window.setTimeout(() => {
              try {
                map.setStyle(MAP_STYLE);
              } catch {
                // give up — markers still work on a blank canvas
              }
            }, 1_000);
          }
        });

        mapRef.current = map;
      } catch (err) {
        if (DEV) console.warn("[map] init failed", err);
        if (!cancelled) {
          setInitError(
            err instanceof Error ? err.message : "Mapbox failed to load",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenPresent, visible, mapReady]);

  // Tear-down on unmount.
  useEffect(() => {
    const markersAtMount = markersRef.current;
    const mapAtMount = mapRef;
    return () => {
      markersAtMount.forEach((m) => m.remove());
      markersAtMount.clear();
      mapAtMount.current?.remove();
      mapAtMount.current = null;
    };
  }, []);

  // Direct per-quest marker creation. One mapboxgl.Marker per pin, keyed by
  // quest id so the diff is O(n). Cluster source / querySourceFeatures has
  // been retired — Mapbox's source pipeline can no-op when the style 503s
  // or before the first tile is loaded, which is exactly the failure we
  // saw in prod.
  useEffect(() => {
    if (!mapReady || !tokenPresent) return;
    let cancelled = false;
    (async () => {
      const mod = await import("mapbox-gl");
      if (cancelled) return;
      const mapboxgl = mod.default;
      const map = mapRef.current;
      if (!map) return;

      const wanted = new Set(pinQuests.map((q) => q.id));

      // Remove markers whose quest is no longer in the set.
      markersRef.current.forEach((marker, id) => {
        if (!wanted.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });

      // Add / update markers for every current pin.
      for (const q of pinQuests) {
        const existing = markersRef.current.get(q.id);
        if (existing) {
          existing.setLngLat([q.lng, q.lat]);
          continue;
        }

        // 44pt tap target via padding on the button wrapper; visible disc
        // is the inner span at 24px.
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ds-map-pin";
        el.setAttribute("aria-label", q.title);
        el.setAttribute("data-category", q.category ?? "");
        el.style.transition = "opacity 180ms ease-out";

        if (q.thumbUrl) {
          const img = document.createElement("img");
          img.src = q.thumbUrl;
          img.alt = "";
          img.className = "ds-map-pin-thumb";
          el.appendChild(img);
        } else {
          const fallback = document.createElement("span");
          fallback.className = "ds-map-pin-fallback";
          fallback.setAttribute("aria-hidden", "true");
          el.appendChild(fallback);
        }

        el.addEventListener("click", (event) => {
          event.stopPropagation();
          router.push(`/quest/${q.id}`);
        });

        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([q.lng, q.lat])
          .addTo(map);
        markersRef.current.set(q.id, marker);
      }

      // Auto-fit on the first non-empty pin set only.
      if (!fittedRef.current && pinQuests.length > 0) {
        fittedRef.current = true;
        if (pinQuests.length === 1) {
          map.flyTo({
            center: [pinQuests[0].lng, pinQuests[0].lat],
            zoom: 13,
            duration: 600,
          });
        } else {
          const bounds = new mapboxgl.LngLatBounds();
          for (const p of pinQuests) bounds.extend([p.lng, p.lat]);
          map.fitBounds(bounds, {
            padding: 80,
            maxZoom: 13,
            duration: 600,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, pinQuests, tokenPresent, router]);

  // Category dim — applied to whatever markers are currently mounted.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLElement>(".ds-map-pin[data-category]")
      .forEach((node) => {
        const cat = node.getAttribute("data-category") ?? "";
        node.style.opacity =
          categoryFilter && cat !== categoryFilter ? "0.15" : "1";
      });
  }, [categoryFilter, pinQuests]);

  if (!tokenPresent || initError) {
    return (
      <div
        className="ds-history-map-wrap glass"
        hidden={!visible}
        aria-hidden={!visible}
      >
        <div className="ds-map-empty-inline">
          <MapPin
            weight="duotone"
            size={28}
            color="var(--text-tertiary)"
            aria-hidden="true"
          />
          <p
            className="ds-empty-state-text"
            style={{
              fontFamily: "var(--font-display, serif)",
              fontSize: "clamp(22px, 5vw, 28px)",
              color: "var(--text-primary)",
              lineHeight: 1.15,
            }}
          >
            Map unavailable.
          </p>
          <p className="ds-empty-state-text">
            {tokenPresent
              ? "Mapbox failed to load. Try refreshing the page."
              : "Add your Mapbox token to env to enable."}
          </p>
        </div>
      </div>
    );
  }

  const showEmpty = mapReady && pinQuests.length === 0 && pendingCoords === 0;

  return (
    <div
      className="ds-history-map-wrap glass"
      hidden={!visible}
      aria-hidden={!visible}
    >
      <div
        ref={containerRef}
        className="ds-history-map-canvas"
        role="application"
        aria-label="Quest map"
      />

      {showEmpty && (
        <div className="ds-map-empty-overlay">
          <div className="glass ds-map-empty-card">
            <MapPin
              weight="duotone"
              size={32}
              color="var(--text-tertiary)"
              aria-hidden="true"
            />
            <p
              className="ds-empty-state-text"
              style={{
                fontFamily: "var(--font-display, serif)",
                fontSize: "clamp(22px, 5vw, 28px)",
                color: "var(--text-primary)",
                lineHeight: 1.15,
              }}
            >
              No pins yet.
            </p>
            <p className="ds-empty-state-text">
              Complete a quest with a location and it&apos;ll land here.
            </p>
            <Link
              href="/"
              className="ds-suggest-pill"
              style={{ marginTop: "var(--space-3)" }}
            >
              <ArrowRight weight="duotone" size={14} aria-hidden="true" />
              <span>Generate quests</span>
            </Link>
          </div>
        </div>
      )}

      {pendingCoords > 0 && (
        <div className="ds-map-pending">
          <Sparkle weight="duotone" size={14} aria-hidden="true" />
          <span>
            Resolving {pendingCoords} location{pendingCoords === 1 ? "" : "s"}…
          </span>
        </div>
      )}
    </div>
  );
}
