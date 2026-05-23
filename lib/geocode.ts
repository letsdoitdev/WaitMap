"use client";

import { createClient } from "@/lib/supabase/client";

export type Coords = { lat: number; lng: number };

const cache = new Map<string, Coords | null>();
let queue: Promise<unknown> = Promise.resolve();

function normalizeKey(text: string): string {
  return text.trim().toLowerCase();
}

function getToken(): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return token && token.length > 0 ? token : null;
}

/**
 * Geocode free-text location via Mapbox's v6 forward endpoint. Requests are
 * serialized through a module-level queue (one at a time) and cached by the
 * lowercased input text — this keeps us well below Mapbox's rate limits even
 * when /map mounts a screen of quests.
 *
 * Returns null when:
 *   - NEXT_PUBLIC_MAPBOX_TOKEN is not set
 *   - the text is empty
 *   - Mapbox returns no features
 *   - any error occurs (we never throw to the caller)
 */
export async function geocodeLocation(text: string): Promise<Coords | null> {
  const key = normalizeKey(text);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const token = getToken();
  if (!token) {
    cache.set(key, null);
    return null;
  }

  // Serialize. The chain swallows errors so a single failure doesn't block
  // subsequent requests.
  const next = queue.then(async () => {
    try {
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.searchParams.set("q", text);
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", token);
      const res = await fetch(url.toString());
      if (!res.ok) {
        cache.set(key, null);
        return null;
      }
      const data = (await res.json()) as {
        features?: { geometry?: { coordinates?: [number, number] } }[];
      };
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (!coords) {
        cache.set(key, null);
        return null;
      }
      const result: Coords = { lat: coords[1], lng: coords[0] };
      cache.set(key, result);
      return result;
    } catch {
      cache.set(key, null);
      return null;
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

export async function upsertQuestCoords(
  questId: string,
  coords: Coords,
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("quests")
    .update({ lat: coords.lat, lng: coords.lng })
    .eq("id", questId);
}

export function hasMapboxToken(): boolean {
  return getToken() !== null;
}
