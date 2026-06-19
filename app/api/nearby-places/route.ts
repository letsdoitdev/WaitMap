import { NextRequest, NextResponse } from "next/server";
import {
  BUCKET_CAPS,
  NearbyBucket,
  NearbyPlace,
  NearbyResponse,
  bucketOf,
  categoryOf,
  shuffle,
} from "@/lib/nearby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "side-quest-generator/1.0 (https://github.com/letsdoitdev/WaitMap)";

const FINAL_TOTAL_CAP = 20;

// ---------- Performance knobs ----------
//
// Hard per-fetch AbortController deadlines. An earlier 2.5s shared cap was too
// aggressive: Overpass from us-east regularly needs ~3s, so it ALWAYS aborted,
// venue context was always empty, and the "generic quests" banner fired every
// run. The client now (a) fires this request in parallel with generation and
// (b) memoizes the result per city, so nearby latency is hidden behind the LLM
// call and paid at most once per city. That lets us give Overpass enough room
// to actually succeed while geocode keeps a tighter bound.
const GEOCODE_TIMEOUT_MS = Number(process.env.GEOCODE_TIMEOUT_MS) || 3_000;
const OVERPASS_TIMEOUT_MS = Number(process.env.OVERPASS_TIMEOUT_MS) || 4_500;

// Overpass endpoint + search radius are config-overridable so a faster mirror
// (e.g. https://overpass.kumi.systems/api/interpreter) or a smaller radius can
// be A/B-evaluated via env without a code change. Defaults preserve the prior
// behavior so results don't silently degrade.
const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT?.trim() ||
  "https://overpass-api.de/api/interpreter";
const OVERPASS_RADIUS_M = Number(process.env.OVERPASS_RADIUS_M) || 5000;

// ---------- Geohash-keyed in-memory cache ----------
//
// Per-instance (module-scope) cache with a few-hour TTL. Repeat / same-
// neighborhood requests skip the network entirely. Geocode is keyed by the
// normalized location string; Overpass is keyed by lat/lng rounded to ~1km
// (2 decimal places ≈ 1.1km) so nearby lookups collapse onto the same key.
// Serverless instances are ephemeral, so this is a best-effort warm-instance
// cache, not a durable store — but it turns the common "same city, repeated
// rerolls" path near-instant.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

type CacheEntry<T> = { value: T; expires: number };

type Geo = { lat: number; lon: number; display: string };

const geocodeCache = new Map<string, CacheEntry<Geo>>();
const overpassCache = new Map<string, CacheEntry<NearbyPlace[]>>();

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/** Round to ~1km so nearby coordinates share an Overpass cache key. */
function geoKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** fetch() wrapped in a hard AbortController deadline. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type StageResult<T> = { value: T; cached: boolean; timedOut: boolean };

async function geocode(location: string): Promise<StageResult<Geo | null>> {
  const key = location.trim().toLowerCase();
  const cached = cacheGet(geocodeCache, key);
  if (cached) return { value: cached, cached: true, timedOut: false };

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    location,
  )}&format=json&limit=1`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": UA, "Accept-Language": "en" } },
      GEOCODE_TIMEOUT_MS,
    );
    if (!res.ok) return { value: null, cached: false, timedOut: false };
    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    if (!data.length) return { value: null, cached: false, timedOut: false };
    const geo: Geo = {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display: data[0].display_name,
    };
    cacheSet(geocodeCache, key, geo);
    return { value: geo, cached: false, timedOut: false };
  } catch (err) {
    // AbortError (timeout) or network throw → graceful no-result. Not cached,
    // so a later request can retry a transient failure.
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { value: null, cached: false, timedOut };
  }
}

async function overpass(
  lat: number,
  lon: number,
): Promise<StageResult<NearbyPlace[]>> {
  const key = geoKey(lat, lon);
  const cached = cacheGet(overpassCache, key);
  if (cached) return { value: cached, cached: true, timedOut: false };

  // Broader pull (out body 80) so we have enough candidates per bucket
  // to satisfy the caps after partitioning.
  const r = OVERPASS_RADIUS_M;
  const query = `[out:json][timeout:10];
(
  node["amenity"~"fast_food|restaurant|cafe|bar|cinema|gym|library|theatre"](around:${r},${lat},${lon});
  node["shop"~"hardware|supermarket|mall"](around:${r},${lat},${lon});
  node["leisure"~"park|playground|sports_centre|stadium"](around:${r},${lat},${lon});
  node["tourism"~"attraction|museum|viewpoint"](around:${r},${lat},${lon});
);
out body 80;`;

  try {
    const res = await fetchWithTimeout(
      OVERPASS_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        body: "data=" + encodeURIComponent(query),
      },
      OVERPASS_TIMEOUT_MS,
    );
    if (!res.ok) return { value: [], cached: false, timedOut: false };
    const data = (await res.json()) as {
      elements?: Array<{ tags?: Record<string, string> }>;
    };
    const places: NearbyPlace[] = [];
    const seen = new Set<string>();
    for (const el of data.elements ?? []) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue;
      const type =
        tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ?? null;
      if (!type) continue;
      const key2 = `${name}::${type}`;
      if (seen.has(key2)) continue;
      seen.add(key2);
      places.push({
        name,
        type,
        category: categoryOf(type),
        bucket: bucketOf(type),
      });
    }
    // Cache successful responses (even empty — a genuinely barren area stays
    // barren for the TTL). Timeouts/errors are NOT cached so they can retry.
    cacheSet(overpassCache, key, places);
    return { value: places, cached: false, timedOut: false };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { value: [], cached: false, timedOut };
  }
}

/**
 * Partition candidates into per-bucket lists, take up to each bucket's cap,
 * fill any remaining slots from "other", shuffle the merged list, and trim
 * to FINAL_TOTAL_CAP. Returns the trimmed array + categoryCounts (per
 * bucket) + typeCounts (per raw OSM type).
 */
function rebalance(raw: NearbyPlace[]): {
  places: NearbyPlace[];
  categoryCounts: Partial<Record<NearbyBucket, number>>;
  typeCounts: Record<string, number>;
} {
  const buckets: Record<NearbyBucket, NearbyPlace[]> = {
    food: [],
    nature: [],
    culture: [],
    utility: [],
    chill: [],
    other: [],
  };
  for (const p of raw) buckets[p.bucket].push(p);

  // Shuffle each bucket so we don't always take the same names back-to-back.
  for (const b of Object.keys(buckets) as NearbyBucket[]) {
    buckets[b] = shuffle(buckets[b]);
  }

  // Take a hard min(cap, available) from each bucket. The per-bucket slice
  // is the enforcement point — once `picked` is built, no later step can
  // expand a bucket past its cap.
  const picked: NearbyPlace[] = [];
  const order: NearbyBucket[] = [
    "nature",
    "culture",
    "chill",
    "utility",
    "food",
    "other",
  ];
  for (const b of order) {
    const cap = BUCKET_CAPS[b];
    const take = Math.min(cap, buckets[b].length);
    picked.push(...buckets[b].slice(0, take));
  }

  const merged = shuffle(picked).slice(0, FINAL_TOTAL_CAP);
  const categoryCounts: Partial<Record<NearbyBucket, number>> = {};
  const typeCounts: Record<string, number> = {};
  for (const p of merged) {
    categoryCounts[p.bucket] = (categoryCounts[p.bucket] ?? 0) + 1;
    typeCounts[p.type] = (typeCounts[p.type] ?? 0) + 1;
  }
  // Visible in Vercel function logs — helps confirm caps are actually
  // enforced post-deploy.
  console.log("[nearby-places] rebalance result", {
    total: merged.length,
    categoryCounts,
    typeCounts,
  });
  return { places: merged, categoryCounts, typeCounts };
}

export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get("location")?.trim() ?? "";
  if (!location) {
    const body: NearbyResponse = {
      ok: false,
      places: [],
      error: "missing location",
    };
    return NextResponse.json(body, { status: 400 });
  }

  const t0 = Date.now();
  try {
    const geoRes = await geocode(location);
    const tGeo = Date.now();
    const geo = geoRes.value;
    if (!geo) {
      // No usable geocode (miss or timeout) → graceful no-places path so the
      // downstream generator can still run without venue context.
      console.log("[nearby-places] timing", {
        geocodeMs: tGeo - t0,
        overpassMs: 0,
        totalMs: tGeo - t0,
        geocodeCached: geoRes.cached,
        geocodeTimedOut: geoRes.timedOut,
        outcome: geoRes.timedOut ? "geocode_timeout" : "geocode_failed",
      });
      const body: NearbyResponse = {
        ok: false,
        places: [],
        error: geoRes.timedOut ? "geocode timeout" : "geocode failed",
      };
      return NextResponse.json(body);
    }
    const overRes = await overpass(geo.lat, geo.lon);
    const tOver = Date.now();
    const { places, categoryCounts, typeCounts } = rebalance(overRes.value);
    console.log("[nearby-places] timing", {
      geocodeMs: tGeo - t0,
      overpassMs: tOver - tGeo,
      totalMs: tOver - t0,
      geocodeCached: geoRes.cached,
      overpassCached: overRes.cached,
      overpassTimedOut: overRes.timedOut,
      placeCount: places.length,
      outcome: overRes.timedOut ? "overpass_timeout" : "ok",
    });
    // On an Overpass timeout we still return ok:true with whatever we have
    // (usually zero places) so generation proceeds on the no-places path
    // rather than erroring — a slow Overpass can never block a result.
    const body: NearbyResponse = {
      ok: true,
      location: { display: geo.display, lat: geo.lat, lon: geo.lon },
      places,
      categoryCounts,
      typeCounts,
    };
    return NextResponse.json(body);
  } catch (err) {
    const body: NearbyResponse = {
      ok: false,
      places: [],
      error: err instanceof Error ? err.message : "unknown error",
    };
    return NextResponse.json(body, { status: 200 });
  }
}
