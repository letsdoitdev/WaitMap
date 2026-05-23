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

// Two markers within this screen-px distance group into a single cluster.
const CLUSTER_RADIUS_PX = 30;
// At-or-above this zoom (or when coords are identical) clicking the
// cluster spiderfies instead of zooming in.
const SPIDERFY_ZOOM_THRESHOLD = 15;
// Pixel radius for the spiderfy fan-out.
const SPIDERFY_RADIUS_PX = 36;

type PinQuest = Quest & {
  lat: number;
  lng: number;
  thumbUrl?: string;
  /** True iff this came from completion_lat/lng (precise) rather than the
   * city-level geocode. Visual-only signal for future styling. */
  precise: boolean;
};

type Group =
  | { kind: "single"; quest: PinQuest }
  | {
      kind: "cluster";
      id: string;
      quests: PinQuest[];
      center: { lng: number; lat: number };
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
  /** When set, non-matching pins disappear from clustering entirely so the
   * cluster + spiderfy math reflects only the filtered set. */
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
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  // Single Map keyed by either `quest-${id}` (leaf) or `cluster-${id}`.
  const markersRef = useRef<Map<string, MapboxMarker>>(new Map());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [pendingCoords, setPendingCoords] = useState(0);
  // Bumps on every map move/zoom + on spiderfy toggle — drives the render
  // effect without needing to wire React state into the Mapbox event loop.
  const [viewTick, setViewTick] = useState(0);
  const [spiderfyId, setSpiderfyId] = useState<string | null>(null);
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

  // Lazy-geocode quests that don't have *any* coords (no completion GPS and
  // no city geocode). The list-view backfill on /history covers this path
  // too — we keep it here for the case where the user opens the map mode
  // before the list mode has run.
  useEffect(() => {
    if (!tokenPresent || quests.length === 0) return;
    const needs = quests.filter(
      (q) =>
        q.completion_lat == null &&
        q.completion_lng == null &&
        (q.lat == null || q.lng == null),
    );
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

  // Validated pin set. Completion coords take priority over city coords;
  // typeof + isFinite guards a stray NaN from planting a pin at (0, 0).
  const pinQuests: PinQuest[] = useMemo(() => {
    const mediaByQuest = new Map<string, QuestMedia[]>();
    for (const m of media) {
      const arr = mediaByQuest.get(m.quest_id) ?? [];
      arr.push(m);
      mediaByQuest.set(m.quest_id, arr);
    }
    const out: PinQuest[] = [];
    for (const q of quests) {
      let lat: number | null | undefined = q.completion_lat;
      let lng: number | null | undefined = q.completion_lng;
      let precise = true;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        const patched = geocodedPatch[q.id];
        lat = patched?.lat ?? q.lat;
        lng = patched?.lng ?? q.lng;
        precise = false;
      }
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }
      if (categoryFilter && q.category !== categoryFilter) continue;
      const firstMedia = mediaByQuest.get(q.id)?.[0];
      const thumbUrl = firstMedia ? signedUrls[firstMedia.id] : undefined;
      out.push({ ...q, lat, lng, thumbUrl, precise });
    }
    return out;
  }, [quests, geocodedPatch, media, signedUrls, categoryFilter]);

  // Initialize Mapbox the first time the container becomes visible. Hooks
  // into both `load` and `styledata` so a transient style 503 doesn't strand
  // us forever.
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
        map.on("styledata", flipReady);

        // Recompute clusters on every camera change.
        const bumpView = () => setViewTick((n) => n + 1);
        map.on("move", bumpView);
        map.on("zoom", bumpView);
        map.on("resize", bumpView);

        // Click anywhere on the map empty area — collapse spiderfy.
        map.on("click", (e: { originalEvent: Event }) => {
          const target = e.originalEvent?.target as HTMLElement | null;
          if (target?.closest(".ds-map-pin") || target?.closest(".ds-map-cluster")) {
            return;
          }
          setSpiderfyId(null);
        });

        map.on(
          "error",
          (e: { error?: { status?: number; message?: string } }) => {
            const status = e?.error?.status;
            if (DEV) console.warn("[map] error", status, e?.error?.message);
            if (
              !styleRetried &&
              (status === 503 || status === 502 || status === 504)
            ) {
              styleRetried = true;
              window.setTimeout(() => {
                try {
                  map.setStyle(MAP_STYLE);
                } catch {
                  // give up — markers still render on a blank canvas
                }
              }, 1_000);
            }
          },
        );

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

  // Compute clusters in screen space, then render. Re-runs on pinQuests,
  // viewTick (every map move/zoom), spiderfy toggle, mapReady.
  useEffect(() => {
    if (!mapReady || !tokenPresent) return;
    let cancelled = false;
    (async () => {
      const mod = await import("mapbox-gl");
      if (cancelled) return;
      const mapboxgl = mod.default;
      const map = mapRef.current;
      if (!map) return;

      // Screen-space cluster pass — O(n²) is fine for our ~tens-of-pins
      // ceiling. Each marker grabs the nearest still-unassigned neighbours
      // within CLUSTER_RADIUS_PX.
      const projected = pinQuests.map((q) => ({
        quest: q,
        px: map.project([q.lng, q.lat]),
      }));
      const used = new Set<string>();
      const groups: Group[] = [];
      for (let i = 0; i < projected.length; i++) {
        if (used.has(projected[i].quest.id)) continue;
        used.add(projected[i].quest.id);
        const cluster: PinQuest[] = [projected[i].quest];
        for (let j = i + 1; j < projected.length; j++) {
          if (used.has(projected[j].quest.id)) continue;
          const dx = projected[i].px.x - projected[j].px.x;
          const dy = projected[i].px.y - projected[j].px.y;
          if (Math.hypot(dx, dy) < CLUSTER_RADIUS_PX) {
            cluster.push(projected[j].quest);
            used.add(projected[j].quest.id);
          }
        }
        if (cluster.length === 1) {
          groups.push({ kind: "single", quest: cluster[0] });
        } else {
          const avgLng =
            cluster.reduce((s, q) => s + q.lng, 0) / cluster.length;
          const avgLat =
            cluster.reduce((s, q) => s + q.lat, 0) / cluster.length;
          const id =
            "c_" +
            cluster
              .map((q) => q.id)
              .sort()
              .join("|");
          groups.push({
            kind: "cluster",
            id,
            quests: cluster,
            center: { lng: avgLng, lat: avgLat },
          });
        }
      }

      // Decide the marker key set this pass.
      const wanted = new Set<string>();
      const activeSpiderfy = groups.find(
        (g) => g.kind === "cluster" && g.id === spiderfyId,
      ) as Extract<Group, { kind: "cluster" }> | undefined;

      for (const group of groups) {
        if (group.kind === "single") {
          wanted.add(`quest-${group.quest.id}`);
        } else if (spiderfyId === group.id) {
          // Spiderfied — show each member leaf, no cluster bubble.
          for (const q of group.quests) wanted.add(`quest-${q.id}`);
        } else {
          // Collapsed cluster — show only the cluster bubble.
          wanted.add(`cluster-${group.id}`);
        }
      }

      // Sweep gone markers.
      markersRef.current.forEach((marker, key) => {
        if (!wanted.has(key)) {
          marker.remove();
          markersRef.current.delete(key);
        }
      });

      const ensureLeafMarker = (
        q: PinQuest,
        offset: { x: number; y: number } | null,
      ) => {
        const key = `quest-${q.id}`;
        const existing = markersRef.current.get(key);
        const setOffset = (el: HTMLElement) => {
          const inner = el.querySelector<HTMLElement>(".ds-map-pin-offset");
          if (!inner) return;
          inner.style.transform = offset
            ? `translate(${offset.x}px, ${offset.y}px)`
            : "translate(0px, 0px)";
          inner.style.transition = "transform 200ms ease-out";
        };
        if (existing) {
          existing.setLngLat([q.lng, q.lat]);
          setOffset(existing.getElement() as HTMLElement);
          return;
        }
        const host = document.createElement("div");
        host.className = "ds-map-pin-host";
        const inner = document.createElement("span");
        inner.className = "ds-map-pin-offset";
        host.appendChild(inner);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ds-map-pin";
        button.setAttribute("aria-label", q.title);
        button.setAttribute("data-category", q.category ?? "");
        if (q.thumbUrl) {
          const img = document.createElement("img");
          img.src = q.thumbUrl;
          img.alt = "";
          img.className = "ds-map-pin-thumb";
          button.appendChild(img);
        } else {
          const fallback = document.createElement("span");
          fallback.className = "ds-map-pin-fallback";
          fallback.setAttribute("aria-hidden", "true");
          button.appendChild(fallback);
        }
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          router.push(`/quest/${q.id}`);
        });
        inner.appendChild(button);

        const marker = new mapboxgl.Marker({ element: host, anchor: "center" })
          .setLngLat([q.lng, q.lat])
          .addTo(map);
        markersRef.current.set(key, marker);
        setOffset(host);
      };

      const ensureClusterMarker = (
        cluster: Extract<Group, { kind: "cluster" }>,
      ) => {
        const key = `cluster-${cluster.id}`;
        const existing = markersRef.current.get(key);
        if (existing) {
          existing.setLngLat([cluster.center.lng, cluster.center.lat]);
          const el = existing.getElement() as HTMLElement;
          const num = el.querySelector(".ds-map-cluster-count");
          if (num) num.textContent = String(cluster.quests.length);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ds-map-cluster";
        button.setAttribute(
          "aria-label",
          `${cluster.quests.length} quests in this area`,
        );
        const count = document.createElement("span");
        count.className = "ds-map-cluster-count";
        count.textContent = String(cluster.quests.length);
        button.appendChild(count);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          // If the coords are stacked (city-geocode collision) — spiderfy
          // immediately. Otherwise ease in by 1.5 levels and let the
          // cluster pass run again at the new zoom; once we're at or above
          // the threshold and they still cluster, the next click spiderfies.
          const stacked = cluster.quests.every(
            (q) =>
              Math.abs(q.lat - cluster.quests[0].lat) < 1e-4 &&
              Math.abs(q.lng - cluster.quests[0].lng) < 1e-4,
          );
          const z = map.getZoom();
          if (stacked || z >= SPIDERFY_ZOOM_THRESHOLD) {
            setSpiderfyId(cluster.id);
            return;
          }
          map.easeTo({
            center: [cluster.center.lng, cluster.center.lat],
            zoom: Math.min(SPIDERFY_ZOOM_THRESHOLD, z + 1.5),
            duration: 500,
          });
        });
        const marker = new mapboxgl.Marker({
          element: button,
          anchor: "center",
        })
          .setLngLat([cluster.center.lng, cluster.center.lat])
          .addTo(map);
        markersRef.current.set(key, marker);
      };

      // Render the desired set.
      for (const group of groups) {
        if (group.kind === "single") {
          ensureLeafMarker(group.quest, null);
        } else if (spiderfyId === group.id) {
          const n = group.quests.length;
          group.quests.forEach((q, idx) => {
            const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
            const offset = {
              x: Math.cos(angle) * SPIDERFY_RADIUS_PX,
              y: Math.sin(angle) * SPIDERFY_RADIUS_PX,
            };
            ensureLeafMarker(q, offset);
          });
        } else {
          ensureClusterMarker(group);
        }
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
            maxZoom: 15,
            duration: 600,
          });
        }
      }

      // Draw spiderfy leader lines into the SVG overlay.
      const svg = overlayRef.current;
      if (svg) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        if (activeSpiderfy) {
          const centerPx = map.project([
            activeSpiderfy.center.lng,
            activeSpiderfy.center.lat,
          ]);
          const ns = "http://www.w3.org/2000/svg";
          const n = activeSpiderfy.quests.length;
          for (let idx = 0; idx < n; idx++) {
            const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
            const x2 = centerPx.x + Math.cos(angle) * SPIDERFY_RADIUS_PX;
            const y2 = centerPx.y + Math.sin(angle) * SPIDERFY_RADIUS_PX;
            const line = document.createElementNS(ns, "line");
            line.setAttribute("x1", String(centerPx.x));
            line.setAttribute("y1", String(centerPx.y));
            line.setAttribute("x2", String(x2));
            line.setAttribute("y2", String(y2));
            line.setAttribute("stroke", "rgba(255,255,255,0.3)");
            line.setAttribute("stroke-width", "1");
            line.setAttribute("stroke-linecap", "round");
            svg.appendChild(line);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    mapReady,
    pinQuests,
    tokenPresent,
    router,
    viewTick,
    spiderfyId,
  ]);

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
      <svg
        ref={overlayRef}
        className="ds-map-overlay"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
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
