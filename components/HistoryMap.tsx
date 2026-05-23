"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MapPin,
  Sparkle,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { formatDistanceToNow } from "date-fns";
import type { Map as MapboxMap, Marker as MapboxMarker, GeoJSONSource } from "mapbox-gl";
import { useAuth } from "@/lib/auth-context";
import { useStats } from "@/lib/stats-context";
import { createClient } from "@/lib/supabase/client";
import {
  geocodeLocation,
  hasMapboxToken,
  upsertQuestCoords,
} from "@/lib/geocode";
import { getSignedMediaUrls } from "@/lib/upload";
import type { Quest, QuestMedia } from "@/lib/database.types";

type PinQuest = Quest & {
  lat: number;
  lng: number;
  thumbUrl?: string;
};

type PopoverState = {
  questId: string;
  title: string;
  category: string;
  completedAt: string | null;
  thumbUrl?: string;
};

const CONTINENTAL_US_CENTER: [number, number] = [-98.5795, 39.8283];

type Props = {
  /** Pass true when the map mode is the visible mode on /history. We keep
   * the component mounted in both modes so Mapbox doesn't re-initialize on
   * every toggle; when this flips back to true we call map.resize(). */
  visible?: boolean;
};

export default function HistoryMap({ visible = true }: Props) {
  const { user } = useAuth();
  const { quests, completedEvents, refresh: refreshStats } = useStats();
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, MapboxMarker>>(new Map());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [pendingCoords, setPendingCoords] = useState(0);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [media, setMedia] = useState<QuestMedia[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [geocodedPatch, setGeocodedPatch] = useState<
    Record<string, { lat: number; lng: number }>
  >({});

  const tokenPresent = hasMapboxToken();

  // When the container flips from hidden → visible, Mapbox needs a resize
  // pass; otherwise the canvas keeps its zero-width layout from when the
  // container was display:none.
  useEffect(() => {
    if (!visible || !mapRef.current) return;
    // Defer one frame so the container has its real size after the CSS
    // toggle has flushed.
    const id = requestAnimationFrame(() => {
      mapRef.current?.resize();
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  // Fetch media so each pin can show the first thumbnail.
  useEffect(() => {
    if (!user || quests.length === 0) {
      setMedia([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("quest_media")
        .select("*")
        .in(
          "quest_id",
          quests.map((q) => q.id),
        )
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const list = data ?? [];
      setMedia(list);
      if (list.length > 0) {
        const urls = await getSignedMediaUrls(list);
        if (!cancelled) setSignedUrls(urls);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user, quests]);

  // Lazy geocode any quests with a location but no coords.
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
          // setGeocodedPatch first so the pin renders immediately on the
          // map in-session. Persistence happens after — if it fails, the
          // list-row "Pin pending" badge will stay until the next reload,
          // but the map still shows the resolved pin.
          setGeocodedPatch((prev) => ({
            ...prev,
            [q.id]: coords,
          }));
          const result = await upsertQuestCoords(q.id, coords);
          if (result.ok) anyPersisted = true;
        }
        setPendingCoords((n) => Math.max(0, n - 1));
      }
      // Only refresh the StatsProvider when at least one write landed —
      // otherwise refresh is a no-op for the badge (lat/lng still null in
      // DB) and just churns the network.
      if (!cancelled && anyPersisted) await refreshStats();
    })();
    return () => {
      cancelled = true;
    };
  }, [quests, tokenPresent, refreshStats]);

  const mediaByQuest = useMemo(() => {
    const map = new Map<string, QuestMedia[]>();
    for (const m of media) {
      const arr = map.get(m.quest_id) ?? [];
      arr.push(m);
      map.set(m.quest_id, arr);
    }
    return map;
  }, [media]);

  const completedByQuest = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of completedEvents) {
      if (!map.has(e.quest_id)) {
        map.set(e.quest_id, e.created_at);
      }
    }
    return map;
  }, [completedEvents]);

  const pinQuests: PinQuest[] = useMemo(() => {
    const out: PinQuest[] = [];
    for (const q of quests) {
      const patched = geocodedPatch[q.id];
      const lat = patched?.lat ?? q.lat;
      const lng = patched?.lng ?? q.lng;
      if (lat == null || lng == null) continue;
      const firstMedia = mediaByQuest.get(q.id)?.[0];
      const thumbUrl = firstMedia ? signedUrls[firstMedia.id] : undefined;
      out.push({ ...q, lat, lng, thumbUrl });
    }
    return out;
  }, [quests, geocodedPatch, mediaByQuest, signedUrls]);

  // Mount Mapbox the first time the container becomes visible. Once
  // initialized, it persists across List/Map toggles via the `hidden`
  // attribute on the wrapper — we just call resize() when flipping back.
  useEffect(() => {
    if (!tokenPresent || !visible || !containerRef.current || mapRef.current)
      return;
    let cancelled = false;
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
          style: "mapbox://styles/mapbox/dark-v11",
          center: CONTINENTAL_US_CENTER,
          zoom: 2.6,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }));
        map.on("error", (e) => {
          console.info("[map] error", e?.error?.message ?? e);
        });
        map.on("load", () => {
          if (cancelled) return;
          // Seed an empty cluster source — we update its data when pinQuests
          // changes below.
          map.addSource("quests", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [],
            },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 60,
          });
          setMapReady(true);
          // Mapbox computes its initial canvas size at construction. After
          // our flex layout has settled the wrapper to its real height, run
          // a second resize so the tiles pick up the new dimensions without
          // needing a manual List/Map toggle.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => map.resize());
          });
        });
        mapRef.current = map;
      } catch (err) {
        console.info("[map] init failed", err);
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
  }, [tokenPresent, visible]);

  // Tear-down on unmount.
  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync the cluster source data + render HTML markers when pins change.
  useEffect(() => {
    if (!mapReady || !tokenPresent) return;
    let cancelled = false;
    (async () => {
      const mod = await import("mapbox-gl");
      if (cancelled) return;
      const mapboxgl = mod.default;
      const map = mapRef.current;
      if (!map) return;
      const source = map.getSource("quests") as GeoJSONSource | undefined;
      if (!source) return;

      const features = pinQuests.map((q) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [q.lng, q.lat] as [number, number],
        },
        properties: {
          questId: q.id,
          title: q.title,
          category: q.category,
          thumbUrl: q.thumbUrl ?? "",
        },
      }));
      source.setData({
        type: "FeatureCollection",
        features,
      });

      // Auto-fit on first non-empty data set only — don't yank the camera
      // every time geocoding finishes for a single quest.
      if (!fittedRef.current && pinQuests.length > 0) {
        fittedRef.current = true;
        if (pinQuests.length === 1) {
          map.flyTo({
            center: [pinQuests[0].lng, pinQuests[0].lat],
            zoom: 11,
            duration: 600,
          });
        } else {
          const bounds = new mapboxgl.LngLatBounds();
          for (const p of pinQuests) bounds.extend([p.lng, p.lat]);
          map.fitBounds(bounds, {
            padding: 80,
            maxZoom: 11,
            duration: 600,
          });
        }
      }

      // Render HTML markers for clusters + unclustered points based on what
      // Mapbox has computed. We re-run on every source update + on move/zoom
      // via the listeners below.
      const renderMarkers = () => {
        if (!map.isStyleLoaded()) return;
        const queried = map.querySourceFeatures("quests");
        const next = new Map<string, MapboxMarker>();

        for (const feature of queried) {
          const props = feature.properties ?? {};
          const geom = feature.geometry as
            | { type: "Point"; coordinates: [number, number] }
            | undefined;
          if (!geom || geom.type !== "Point") continue;
          const [lng, lat] = geom.coordinates;

          if (props.cluster) {
            const id = `cluster-${props.cluster_id}`;
            const count = props.point_count as number;
            const existing = markersRef.current.get(id);
            if (existing) {
              existing.setLngLat([lng, lat]);
              next.set(id, existing);
              continue;
            }
            const el = document.createElement("button");
            el.type = "button";
            el.className = "ds-map-cluster";
            el.setAttribute(
              "aria-label",
              `${count} quests in this area — zoom in`,
            );
            const stack = document.createElement("span");
            stack.className = "ds-map-cluster-stack";
            // Pull up to 3 thumb URLs from the queried unclustered features
            // for this cluster's children — best-effort, gracefully skipped
            // if the cluster source can't return them synchronously.
            el.appendChild(stack);
            const badge = document.createElement("span");
            badge.className = "ds-map-cluster-badge";
            badge.textContent = String(count);
            el.appendChild(badge);
            el.addEventListener("click", (event) => {
              event.stopPropagation();
              const src = map.getSource(
                "quests",
              ) as GeoJSONSource;
              src.getClusterExpansionZoom(
                props.cluster_id as number,
                (err, zoom) => {
                  if (err || zoom == null) return;
                  map.easeTo({
                    center: [lng, lat],
                    zoom: zoom + 0.2,
                    duration: 500,
                  });
                },
              );
            });
            // Asynchronously hydrate up to three child thumb stack tiles.
            const src = map.getSource("quests") as GeoJSONSource;
            src.getClusterLeaves(
              props.cluster_id as number,
              3,
              0,
              (err, leaves) => {
                if (err || !leaves) return;
                stack.innerHTML = "";
                leaves.forEach((leaf, idx) => {
                  const url = (leaf.properties?.thumbUrl as string) ?? "";
                  const tile = document.createElement("span");
                  tile.className = "ds-map-cluster-stack-tile";
                  tile.style.zIndex = String(3 - idx);
                  if (url) {
                    const img = document.createElement("img");
                    img.src = url;
                    img.alt = "";
                    tile.appendChild(img);
                  }
                  stack.appendChild(tile);
                });
              },
            );
            const marker = new mapboxgl.Marker({
              element: el,
              anchor: "center",
            })
              .setLngLat([lng, lat])
              .addTo(map);
            next.set(id, marker);
          } else {
            const questId = props.questId as string;
            if (!questId) continue;
            const id = `quest-${questId}`;
            const existing = markersRef.current.get(id);
            if (existing) {
              existing.setLngLat([lng, lat]);
              next.set(id, existing);
              continue;
            }
            const el = document.createElement("button");
            el.type = "button";
            el.className = "ds-map-pin";
            el.setAttribute("aria-label", props.title as string);
            const thumbUrl = (props.thumbUrl as string) ?? "";
            if (thumbUrl) {
              const img = document.createElement("img");
              img.src = thumbUrl;
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
              document
                .querySelectorAll(".ds-map-pin[data-active='true']")
                .forEach((node) => {
                  (node as HTMLElement).removeAttribute("data-active");
                });
              el.setAttribute("data-active", "true");
              setPopover({
                questId,
                title: props.title as string,
                category: props.category as string,
                completedAt: completedByQuest.get(questId) ?? null,
                thumbUrl: thumbUrl || undefined,
              });
            });
            const marker = new mapboxgl.Marker({
              element: el,
              anchor: "center",
            })
              .setLngLat([lng, lat])
              .addTo(map);
            next.set(id, marker);
          }
        }

        // Sweep stale markers.
        markersRef.current.forEach((m, key) => {
          if (!next.has(key)) m.remove();
        });
        markersRef.current = next;
      };

      renderMarkers();
      map.on("moveend", renderMarkers);
      map.on("zoomend", renderMarkers);
      map.on("sourcedata", renderMarkers);

      return () => {
        map.off("moveend", renderMarkers);
        map.off("zoomend", renderMarkers);
        map.off("sourcedata", renderMarkers);
      };
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, pinQuests, completedByQuest, tokenPresent]);

  const dismissPopover = () => {
    document
      .querySelectorAll(".ds-map-pin[data-active='true']")
      .forEach((node) => {
        (node as HTMLElement).removeAttribute("data-active");
      });
    setPopover(null);
  };

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

      {popover && (
        <div
          className="glass ds-map-popover"
          role="dialog"
          aria-label="Quest"
        >
          <button
            type="button"
            className="ds-map-popover-close"
            onClick={dismissPopover}
            aria-label="Close"
          >
            <X weight="duotone" size={14} aria-hidden="true" />
          </button>
          <span className="ds-cat-chip" style={{ alignSelf: "flex-start" }}>
            <span className="ds-cat-chip-icon" aria-hidden="true">
              <MapPin weight="duotone" size={12} />
            </span>
            {popover.category}
          </span>
          <h3 className="ds-map-popover-title">{popover.title}</h3>
          {popover.completedAt && (
            <p className="ds-map-popover-sub">
              completed{" "}
              {formatDistanceToNow(new Date(popover.completedAt), {
                addSuffix: true,
              })}
            </p>
          )}
          <Link
            href={`/quest/${popover.questId}`}
            className="ds-secondary-pill"
            style={{ marginTop: "var(--space-3)" }}
          >
            <span>View</span>
            <ArrowRight weight="duotone" size={14} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
