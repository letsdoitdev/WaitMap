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

async function geocode(
  location: string,
): Promise<{ lat: number; lon: number; display: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    location,
  )}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display: data[0].display_name,
  };
}

async function overpass(lat: number, lon: number): Promise<NearbyPlace[]> {
  // Broader pull (out body 80) so we have enough candidates per bucket
  // to satisfy the caps after partitioning.
  const query = `[out:json][timeout:10];
(
  node["amenity"~"fast_food|restaurant|cafe|bar|cinema|gym|library|theatre"](around:5000,${lat},${lon});
  node["shop"~"hardware|supermarket|mall"](around:5000,${lat},${lon});
  node["leisure"~"park|playground|sports_centre|stadium"](around:5000,${lat},${lon});
  node["tourism"~"attraction|museum|viewpoint"](around:5000,${lat},${lon});
);
out body 80;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) return [];
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
    const key = `${name}::${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      name,
      type,
      category: categoryOf(type),
      bucket: bucketOf(type),
    });
  }
  return places;
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

  try {
    const geo = await geocode(location);
    if (!geo) {
      const body: NearbyResponse = {
        ok: false,
        places: [],
        error: "geocode failed",
      };
      return NextResponse.json(body);
    }
    const raw = await overpass(geo.lat, geo.lon);
    const { places, categoryCounts, typeCounts } = rebalance(raw);
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
