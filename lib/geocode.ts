"use client";

import { createClient } from "@/lib/supabase/client";

export type Coords = { lat: number; lng: number };

const DEV = process.env.NODE_ENV !== "production";

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
 * lowercased input text. Returns null on any failure — never throws.
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

  const next = queue.then(async () => {
    try {
      if (DEV) console.info("[geocode] resolving:", text);
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.searchParams.set("q", text);
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", token);
      const res = await fetch(url.toString());
      if (!res.ok) {
        if (DEV) {
          console.info("[geocode] mapbox returned", res.status, "for", text);
        }
        cache.set(key, null);
        return null;
      }
      const data = (await res.json()) as {
        features?: { geometry?: { coordinates?: [number, number] } }[];
      };
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (!coords) {
        if (DEV) console.info("[geocode] no features for", text);
        cache.set(key, null);
        return null;
      }
      const result: Coords = { lat: coords[1], lng: coords[0] };
      if (DEV) console.info("[geocode] resolved:", text, "→", result);
      cache.set(key, result);
      return result;
    } catch (err) {
      if (DEV) console.info("[geocode] error for", text, err);
      cache.set(key, null);
      return null;
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

export type UpsertResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; lat?: undefined; lng?: undefined };

// Circuit breaker — one trip per session, all later upserts short-circuit.
const MISSING_GEO_FLAG = "__geo_columns_missing__";
let warnedCircuit = false;
// Per-quest dedupe — even before the circuit trips, a single quest never
// generates more than one upsert attempt in the same session.
const attempted = new Set<string>();

function circuitOpen(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(MISSING_GEO_FLAG) === "1";
  } catch {
    return false;
  }
}

function tripCircuit(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(MISSING_GEO_FLAG, "1");
  } catch {
    // ignore
  }
}

function isSchemaCacheMissError(err: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (err.code === "PGRST204") return true;
  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("schema cache") ||
    (msg.includes("could not find") &&
      (msg.includes(" lat ") ||
        msg.includes(" lng ") ||
        msg.includes("'lat'") ||
        msg.includes("'lng'")))
  );
}

/**
 * Write the resolved lat/lng back to the quests row.
 *
 * Two short-circuits:
 *   1. Circuit breaker — once any call this session sees PGRST204 (lat/lng
 *      columns missing from the quests schema cache), the flag flips in
 *      sessionStorage and all later calls return ok:false without hitting
 *      the network.
 *   2. Per-quest dedupe — even on the first round, we attempt each quest at
 *      most once per session, so a re-mount loop can't retry indefinitely.
 *
 * On the first miss we emit ONE console.warn so the user knows pins are
 * paused; everything else is gated behind NODE_ENV !== "production".
 */
export async function upsertQuestCoords(
  questId: string,
  coords: Coords,
): Promise<UpsertResult> {
  if (circuitOpen()) {
    if (!warnedCircuit) {
      warnedCircuit = true;
      console.warn(
        "[geo] columns missing on quests table — pins paused until migration applied",
      );
    }
    return { ok: false };
  }
  if (attempted.has(questId)) {
    return { ok: false };
  }
  attempted.add(questId);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("quests")
    .update({ lat: coords.lat, lng: coords.lng })
    .eq("id", questId)
    .select("id, lat, lng");
  if (error) {
    if (isSchemaCacheMissError(error)) {
      tripCircuit();
      if (!warnedCircuit) {
        warnedCircuit = true;
        console.warn(
          "[geo] columns missing on quests table — pins paused until migration applied",
        );
      }
      return { ok: false };
    }
    if (DEV) {
      console.info(
        "[geocode] upsert error for",
        questId,
        "—",
        `message="${error.message}"`,
        `code="${error.code}"`,
        `details="${error.details}"`,
      );
    }
    return { ok: false };
  }
  if (!data || data.length === 0) {
    if (DEV) {
      console.info(
        "[geocode] upsert wrote 0 rows for",
        questId,
        "(likely RLS or wrong id)",
      );
    }
    return { ok: false };
  }
  if (DEV) {
    console.info(
      "[geocode] persisted:",
      questId,
      `-> (${coords.lat}, ${coords.lng})`,
    );
  }
  return { ok: true, lat: coords.lat, lng: coords.lng };
}

export function hasMapboxToken(): boolean {
  return getToken() !== null;
}

/** UI hook: lets components know whether to surface the "apply migration"
 * banner. Returns true when the circuit has tripped in this session. */
export function isGeoCircuitOpen(): boolean {
  return circuitOpen();
}

export const GEO_MIGRATION_SQL = [
  "alter table public.quests add column if not exists lat double precision;",
  "alter table public.quests add column if not exists lng double precision;",
  "create index if not exists quests_user_geo_idx",
  "  on public.quests(user_id) where lat is not null;",
].join("\n");
