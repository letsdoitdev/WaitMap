import { NextRequest, NextResponse } from "next/server";
import { NearbyPlace, NearbyResponse, categoryOf } from "@/lib/nearby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "side-quest-generator/1.0 (https://github.com/letsdoitdev/WaitMap)";

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
  const query = `[out:json][timeout:10];
(
  node["amenity"~"fast_food|restaurant|cafe|bar|cinema|gym|library"](around:5000,${lat},${lon});
  node["shop"~"hardware|supermarket|mall"](around:5000,${lat},${lon});
  node["leisure"~"park|playground|sports_centre|stadium"](around:5000,${lat},${lon});
  node["tourism"~"attraction|museum|viewpoint"](around:5000,${lat},${lon});
);
out body 20;`;

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
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;
    const type =
      tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ?? null;
    if (!type) continue;
    places.push({ name, type, category: categoryOf(type) });
  }
  return places;
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
    const places = await overpass(geo.lat, geo.lon);
    const body: NearbyResponse = {
      ok: true,
      location: { display: geo.display, lat: geo.lat, lon: geo.lon },
      places,
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
