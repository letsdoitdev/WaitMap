"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { GeneratedQuest } from "@/lib/generate";
import { QuestCategory } from "@/lib/quests";
import { NearbyPlace, NearbyResponse } from "@/lib/nearby";
import {
  Rating,
  RatingRecord,
  RATING_STORAGE_KEY,
  latestRatings,
} from "@/lib/ratings";
import {
  SUGGEST_STORAGE_KEY,
  Suggestion,
  SelfRating,
} from "@/lib/suggestions";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useActiveQuest } from "@/lib/active-quest-context";
import { useStats } from "@/lib/stats-context";
import { GROUP_MODE_SIZE, useOnboarding } from "@/lib/onboarding-context";
import {
  appendRecentQuests,
  hasAnyRecentQuests,
  loadRecentQuests,
} from "@/lib/recent-quests";
import { createClient } from "@/lib/supabase/client";
import { FREE_DAILY_REROLLS } from "@/lib/constants";
import SignInModal, { SignInIntent } from "@/components/SignInModal";
import OutOfRerollsModal from "@/components/OutOfRerollsModal";
import {
  ArrowRight,
  BookmarkSimple,
  CaretDown,
  Crosshair,
  Check,
  CircleNotch,
  Clock,
  CurrencyDollar,
  Flame,
  ForkKnife,
  Hand,
  Lightbulb,
  Lightning,
  Lock,
  MapPin,
  Minus,
  Moon,
  PaintBrush,
  Play,
  Sliders,
  Snowflake,
  Sparkle,
  Tree,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

const CATEGORY_ICONS: Record<QuestCategory, Icon> = {
  Social: UsersThree,
  Outdoor: Tree,
  Chaos: Lightning,
  Creative: PaintBrush,
  Food: ForkKnife,
  "Late Night": Moon,
  Chill: Sparkle,
  Fitness: Sparkle,
  Nature: Sparkle,
  Tech: Sparkle,
  Exploration: Sparkle,
  Indoor: Sparkle,
};

const REACTION_ICONS: Record<Rating, Icon> = {
  cooked: Snowflake,
  mid: Minus,
  tuff: Hand,
  fire: Flame,
};

const REACTION_LABELS: Record<Rating, string> = {
  cooked: "Cooked",
  mid: "Mid",
  tuff: "Tuff",
  fire: "Fire",
};

const RATING_ORDER: Rating[] = ["cooked", "mid", "tuff", "fire"];

const ALL_CATEGORIES: QuestCategory[] = [
  "Chaos",
  "Outdoor",
  "Social",
  "Creative",
  "Food",
  "Late Night",
  "Chill",
  "Fitness",
  "Nature",
  "Tech",
  "Exploration",
  "Indoor",
];

const SHOWN_KEY = "sqShown";
const SHOWN_TITLES_KEY = "sqShownTitles";
const BOOKMARK_KEY = "sqBookmarks";
// 24h TTL across diversity-related localStorage. Long enough that closing
// the tab and coming back tomorrow still suppresses repeats; short enough
// that a true week-later session feels fresh again.
const DIVERSITY_TTL_MS = 24 * 60 * 60 * 1000;

type TtlEnvelope<T> = { value: T; expiresAt: number };

function readTtl<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TtlEnvelope<T>>;
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      Date.now() > parsed.expiresAt
    ) {
      localStorage.removeItem(key);
      return fallback;
    }
    return (parsed.value as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeTtl<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const envelope: TtlEnvelope<T> = {
      value,
      expiresAt: Date.now() + DIVERSITY_TTL_MS,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // ignore
  }
}

function loadShown(): string[] {
  const titles = readTtl<string[]>(SHOWN_KEY, []);
  return Array.isArray(titles) ? titles : [];
}
function saveShown(ids: string[]) {
  writeTtl(SHOWN_KEY, ids.slice(-30));
}

function loadShownTitles(): string[] {
  const titles = readTtl<string[]>(SHOWN_TITLES_KEY, []);
  return Array.isArray(titles) ? titles : [];
}
function saveShownTitles(titles: string[]) {
  writeTtl(SHOWN_TITLES_KEY, titles.slice(-30));
}

// Append titles, deduping case-insensitively while preserving order (oldest
// first, newest last). Fixes the old double-append: the on-screen batch was
// pushed into a window that already contained it, so the 9-slot title memory
// effectively held only ~2 batches.
function mergeTitles(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
  const out = [...existing];
  for (const t of incoming) {
    const key = t.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function loadBookmarks(): GeneratedQuest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GeneratedQuest[]) : [];
  } catch {
    return [];
  }
}
function saveBookmarks(items: GeneratedQuest[]) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function loadRatings(): RatingRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RATING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RatingRecord[]) : [];
  } catch {
    return [];
  }
}
function saveRatings(records: RatingRecord[]) {
  try {
    localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore
  }
}

type View = "results" | "saved";

// `region` is the geocoded locale descriptor (e.g. "Ashburn, Virginia, USA"),
// null when the city couldn't be geocoded at all. Used for geographic
// plausibility in the prompt — never to name venues.
async function fetchNearby(loc: string): Promise<{
  region: string | null;
  places: NearbyPlace[];
  typeCounts: Record<string, number>;
}> {
  // Attach the precise browser coords the client already holds when they
  // belong to THIS location — the crosshair flow stores the geolocated
  // label alongside the coords, so a label match means "the typed city IS
  // where the user was located". In-flight only; the server centers the
  // venue search on the user's neighborhood instead of the city centroid.
  // Typing a different city skips the coords (they'd point at the wrong
  // place) and falls back to the centroid path.
  let coordQs = "";
  try {
    const raw = localStorage.getItem("lastKnownGeo");
    if (raw) {
      const last = JSON.parse(raw) as {
        lat?: number;
        lng?: number;
        label?: string;
        timestamp?: number;
      };
      if (
        typeof last?.lat === "number" &&
        typeof last?.lng === "number" &&
        typeof last?.label === "string" &&
        last.label.trim().toLowerCase() === loc.trim().toLowerCase() &&
        typeof last?.timestamp === "number" &&
        Date.now() - last.timestamp < 24 * 60 * 60 * 1000
      ) {
        coordQs = `&lat=${encodeURIComponent(String(last.lat))}&lon=${encodeURIComponent(String(last.lng))}`;
      }
    }
  } catch {
    // ignore — centroid fallback
  }
  try {
    const r = await fetch(
      `/api/nearby-places?location=${encodeURIComponent(loc)}${coordQs}`,
    );
    if (!r.ok) return { region: null, places: [], typeCounts: {} };
    const data = (await r.json()) as NearbyResponse;
    // ok:false means geocode failed → no region. ok:true (even with zero
    // places, e.g. Overpass empty) still carries the resolved region.
    return {
      region: data.location?.display ?? null,
      places: data.ok ? data.places : [],
      typeCounts: data.ok ? data.typeCounts ?? {} : {},
    };
  } catch {
    return { region: null, places: [], typeCounts: {} };
  }
}

function formatTimeSince(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60 * 60 * 1000) return "just now";
  const totalHours = Math.floor(elapsed / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${totalHours}h ago`;
  if (hours === 0) return `${days}d ago`;
  return `${days}d ${hours}h ago`;
}

export default function Home() {
  const router = useRouter();
  const searchParamsHome = useSearchParams();
  const { user, isPro, rerollsRemaining } = useAuth();
  const { active, refresh: refreshActive } = useActiveQuest();
  const { completedEvents } = useStats();
  const {
    answers: onboardingAnswers,
    isComplete: onboardingDone,
    loading: onboardingLoading,
    markCompleted: markOnboardingCompleted,
  } = useOnboarding();
  const forceFlag = searchParamsHome?.get("force") === "1";
  const focusLocationFlag = searchParamsHome?.get("focus") === "1";

  // SSR-safe mount latch — no localStorage reads happen until after this
  // effect runs on the client, so the initial render matches the server
  // and we never fire the redirect on the first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // New users (no onboarding row, no localStorage progress) get routed to
  // the guided quiz the first time they hit /. ?force=1 escapes for QA.
  // Defensive backfill: if a user has clearly used the app (recent quests
  // exist + at least one onboarding answer populated) but completedAt is
  // null, stamp it instead of bouncing them through the quiz again. Covers
  // anyone stuck on a pre-M8.6 build where the persist race dropped the
  // timestamp on the floor.
  useEffect(() => {
    if (!mounted) return;
    if (onboardingLoading || forceFlag || onboardingDone) return;
    const hasAnswers =
      onboardingAnswers.groupModes.length > 0 ||
      onboardingAnswers.vibeCategories.length > 0 ||
      onboardingAnswers.canDrive !== null ||
      onboardingAnswers.costPref !== null;
    const hasRecent = hasAnyRecentQuests();
    if (hasAnswers && hasRecent) {
      markOnboardingCompleted();
      return;
    }
    router.replace("/onboarding?step=1");
  }, [
    mounted,
    onboardingLoading,
    forceFlag,
    onboardingDone,
    onboardingAnswers.groupModes,
    onboardingAnswers.vibeCategories,
    onboardingAnswers.canDrive,
    onboardingAnswers.costPref,
    markOnboardingCompleted,
    router,
  ]);

  const supabase = useMemo(() => createClient(), []);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInIntent, setSignInIntent] = useState<SignInIntent>("save");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [outOfRerollsOpen, setOutOfRerollsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [groupSize, setGroupSize] = useState(3);
  const [timeMinutes, setTimeMinutes] = useState(90);
  const [spice, setSpice] = useState(5);
  const [quests, setQuests] = useState<GeneratedQuest[] | null>(null);
  const [rolling, setRolling] = useState(false);
  const [nearbyStatus, setNearbyStatus] = useState<
    "idle" | "loading" | "ok" | "fallback"
  >("idle");
  // Per-city memoized nearby result. The nearby fetch (geocode + Overpass) is
  // the slow, repeat-identical leg; caching it here means rerolls of the same
  // city skip that network round-trip entirely and only pay the LLM call —
  // this is what keeps reroll p95 well under budget. Keyed by normalized city;
  // survives across generate() calls but resets on reload (intentional).
  const nearbyCacheRef = useRef<
    Record<
      string,
      {
        region: string | null;
        places: NearbyPlace[];
        typeCounts: Record<string, number>;
      }
    >
  >({});
  const [ratingsHistory, setRatingsHistory] = useState<RatingRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<GeneratedQuest[]>([]);
  const [view, setView] = useState<View>("results");
  const [categoryFilter, setCategoryFilter] = useState<QuestCategory | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [suggestSelfRating, setSuggestSelfRating] = useState<SelfRating>(null);
  const [suggestSent, setSuggestSent] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [canDrive, setCanDrive] = useState(true);
  const [lowCostOnly, setLowCostOnly] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locHint, setLocHint] = useState<string | null>(null);
  const [lastKnownLabel, setLastKnownLabel] = useState<string | null>(null);
  const progressTimersRef = useRef<number[]>([]);

  // Auto-fill the location input from the browser's geolocation. Only ever
  // fires on explicit tap of the crosshair button — never on mount, never
  // via a "first-visit" flag. Two-tier strategy: a fast low-accuracy attempt
  // first, then a slower high-accuracy retry if the first tier times out.
  // Surfaces progress + precise error messages so the user is never left
  // wondering whether the button did anything.
  const reverseGeocode = async (
    lat: number,
    lng: number,
  ): Promise<string | null> => {
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
      const region = feature.context?.find((c) =>
        c.id?.startsWith("region"),
      );
      const regionShort = region?.short_code
        ?.replace(/^us-/i, "")
        .toUpperCase();
      const regionText =
        region?.short_code?.toLowerCase().startsWith("us-") && region.text
          ? region.text
          : regionShort ?? region?.text ?? "";
      return regionText ? `${feature.text} ${regionText}` : feature.text;
    } catch {
      return null;
    }
  };

  const useMyLocation = () => {
    if (locBusy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("Location blocked. Type your city instead.");
      return;
    }
    setLocBusy(true);
    setLocError(null);

    // Schedule progress messages — cleared on resolve/reject.
    const progress1500 = window.setTimeout(() => {
      setLocHint("Finding you…");
    }, 1500);
    const progress4000 = window.setTimeout(() => {
      setLocHint("Still trying — may take a few more seconds…");
    }, 4000);
    progressTimersRef.current = [progress1500, progress4000];

    const cleanup = () => {
      for (const t of progressTimersRef.current) window.clearTimeout(t);
      progressTimersRef.current = [];
      setLocBusy(false);
      setLocHint(null);
    };

    const handleSuccess = async (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      const label = await reverseGeocode(latitude, longitude);
      if (!label) {
        cleanup();
        setLocError(
          "Couldn't read your location — type your city instead.",
        );
        return;
      }
      setCity(label);
      try {
        localStorage.setItem("sqLocation", label);
        localStorage.setItem(
          "lastKnownGeo",
          JSON.stringify({
            lat: latitude,
            lng: longitude,
            label,
            timestamp: Date.now(),
          }),
        );
        setLastKnownLabel(label);
      } catch {
        // ignore quota errors
      }
      cleanup();
    };

    const handleError = (err: GeolocationPositionError) => {
      // TIMEOUT on the fast tier → retry once with high-accuracy.
      if (err.code === err.TIMEOUT) {
        navigator.geolocation.getCurrentPosition(
          handleSuccess,
          (err2) => {
            cleanup();
            if (err2.code === err2.PERMISSION_DENIED) {
              setLocError(
                "Location blocked. Type your city, or enable location in your browser settings.",
              );
            } else if (err2.code === err2.POSITION_UNAVAILABLE) {
              setLocError(
                "Your device couldn't find a location signal. Type your city instead.",
              );
            } else {
              setLocError(
                "Couldn't get a fix in time. Type your city, or try again with stronger GPS/Wi-Fi.",
              );
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 8_000,
            maximumAge: 5 * 60 * 1000,
          },
        );
        return;
      }
      cleanup();
      if (err.code === err.PERMISSION_DENIED) {
        setLocError(
          "Location blocked. Type your city, or enable location in your browser settings.",
        );
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        setLocError(
          "Your device couldn't find a location signal. Type your city instead.",
        );
      } else {
        setLocError("Couldn't get your location — type it instead.");
      }
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: false,
      timeout: 3_500,
      maximumAge: 5 * 60 * 1000,
    });
  };

  useEffect(() => {
    setRatingsHistory(loadRatings());
    setBookmarks(loadBookmarks());
    try {
      const saved = localStorage.getItem("sqLocation");
      if (saved) setCity(saved);
      // Pre-fill from lastKnownGeo if it's under 24h old — returning users
      // skip the geolocation roulette. Tap the chip to clear and re-search.
      const lastRaw = localStorage.getItem("lastKnownGeo");
      if (lastRaw) {
        const last = JSON.parse(lastRaw) as {
          lat?: number;
          lng?: number;
          label?: string;
          timestamp?: number;
        };
        if (
          last?.label &&
          last.timestamp &&
          Date.now() - last.timestamp < 24 * 60 * 60 * 1000
        ) {
          setLastKnownLabel(last.label);
          if (!saved) setCity(last.label);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // First-visit-after-onboarding Preferences prefill. We seed once: if the
  // onboarding answers exist (group_modes / spice / time_minutes / canDrive
  // / costPref) we write them into the matching Preferences state so the
  // home generator starts on the user's quiz answers rather than the
  // hard-coded defaults. Gated on a localStorage flag so reroll / reload
  // doesn't repeatedly clobber state the user has since tweaked.
  const onboardingPrefillRef = useRef(false);
  useEffect(() => {
    if (onboardingPrefillRef.current) return;
    if (onboardingLoading || !onboardingDone) return;
    onboardingPrefillRef.current = true;
    let alreadySeeded = false;
    try {
      alreadySeeded =
        localStorage.getItem("sqOnboardingPrefilled.v1") === "1";
    } catch {
      // ignore
    }
    if (alreadySeeded) return;
    if (onboardingAnswers.groupModes.length > 0) {
      const sizes = onboardingAnswers.groupModes
        .map((m) => GROUP_MODE_SIZE[m] ?? 3)
        .filter((n) => Number.isFinite(n));
      if (sizes.length > 0) setGroupSize(Math.max(...sizes));
    }
    if (typeof onboardingAnswers.spice === "number") {
      setSpice(onboardingAnswers.spice);
    }
    if (typeof onboardingAnswers.timeMinutes === "number") {
      setTimeMinutes(onboardingAnswers.timeMinutes);
    }
    if (typeof onboardingAnswers.canDrive === "boolean") {
      setCanDrive(onboardingAnswers.canDrive);
    }
    if (onboardingAnswers.costPref) {
      setLowCostOnly(onboardingAnswers.costPref === "free");
    }
    try {
      localStorage.setItem("sqOnboardingPrefilled.v1", "1");
    } catch {
      // ignore
    }
  }, [
    onboardingLoading,
    onboardingDone,
    onboardingAnswers.groupModes,
    onboardingAnswers.spice,
    onboardingAnswers.timeMinutes,
    onboardingAnswers.canDrive,
    onboardingAnswers.costPref,
  ]);

  // /?focus=1 arrives from the "I'll type it in" path. Focus the location
  // input once the city input ref has mounted; clear the URL param so a
  // later reload doesn't keep stealing focus.
  const locInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!focusLocationFlag) return;
    const t = window.setTimeout(() => {
      locInputRef.current?.focus();
      router.replace("/", { scroll: false });
    }, 50);
    return () => window.clearTimeout(t);
  }, [focusLocationFlag, router]);

  const submitSuggestion = async () => {
    const text = suggestText.trim();
    if (!text || text.length > 500 || suggestBusy) return;
    setSuggestBusy(true);
    const record: Suggestion = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `sug_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      text,
      selfRating: suggestSelfRating,
      timestamp: Date.now(),
    };
    try {
      const raw = localStorage.getItem(SUGGEST_STORAGE_KEY);
      const all: Suggestion[] = raw ? JSON.parse(raw) : [];
      all.push(record);
      localStorage.setItem(SUGGEST_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
    try {
      await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, selfRating: suggestSelfRating }),
      });
    } catch {
      // ignore
    }
    setSuggestBusy(false);
    setSuggestSent(true);
    setTimeout(() => {
      setSuggestOpen(false);
      setSuggestSent(false);
      setSuggestText("");
      setSuggestSelfRating(null);
    }, 1200);
  };

  const ratingByQuest = useMemo(
    () => latestRatings(ratingsHistory),
    [ratingsHistory],
  );
  const bookmarkIds = useMemo(
    () => new Set(bookmarks.map((b) => b.id)),
    [bookmarks],
  );

  const canGenerate = city.trim().length > 0;

  // Prefetch the nearby context as soon as a city is known (prefilled on
  // mount or typed), debounced so keystrokes don't spam the geocoder. This
  // makes the FIRST roll location-aware: previously the cold path fired the
  // fetch in the background and only roll #2 saw venue data.
  useEffect(() => {
    const key = city.trim().toLowerCase();
    if (!key || nearbyCacheRef.current[key]) return;
    const t = window.setTimeout(() => {
      void fetchNearby(city).then((res) => {
        nearbyCacheRef.current[key] = res;
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [city]);

  // One request body for both the streaming and JSON endpoints so the two
  // calls can never drift. Threads through the personal signals the server
  // renders since M13: onboarding vibes, the 3-value cost preference, and
  // the user's local time (for temporal plausibility).
  const WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  function buildGenerateBody(
    region: string | null,
    places: NearbyPlace[],
    typeCounts: Record<string, number>,
    excludeIds: string[],
    previousTitles: string[],
    category: QuestCategory | null,
  ) {
    const groupBand: "solo" | "2" | "group" =
      groupSize === 1 ? "solo" : groupSize === 2 ? "2" : "group";
    // Effective cost preference: the home toggle is the live override — ON
    // always means free-only. When OFF, fall back to the onboarding answer,
    // except an onboarding "free" with the toggle OFF means the user
    // deliberately relaxed it, so send "any".
    const costPref = lowCostOnly
      ? "free"
      : onboardingAnswers.costPref === "free"
        ? "any"
        : onboardingAnswers.costPref;
    const now = new Date();
    return {
      location: city,
      region: region ?? city,
      nearbyPlaces: places
        .map((p) => ({ name: p.name, type: p.type, bucket: p.bucket }))
        .slice(0, 20),
      typeCounts,
      spiceLevel: spice,
      groupSize: groupBand,
      timeAvailable: timeMinutes,
      excludeIds,
      previousTitles,
      category,
      canDrive,
      // Kept alongside costPref so a not-yet-redeployed server still gets
      // the boolean it understands.
      lowCostOnly,
      vibeCategories: onboardingAnswers.vibeCategories,
      costPref,
      localHour: now.getHours(),
      localWeekday: WEEKDAY_NAMES[now.getDay()],
    };
  }

  // Returns the generated quests, `null` to signal the caller should surface
  // an error state, or "reroll_limit" when the server enforced the cap (402).
  async function fetchAiQuests(
    region: string | null,
    places: NearbyPlace[],
    typeCounts: Record<string, number>,
    excludeIds: string[],
    previousTitles: string[],
    category: QuestCategory | null,
  ): Promise<GeneratedQuest[] | null | "reroll_limit"> {
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildGenerateBody(
            region,
            places,
            typeCounts,
            excludeIds,
            previousTitles,
            category,
          ),
        ),
      });
      // 402 = reroll cap hit (blocking). Distinct from 5xx/network below —
      // surface it so the caller opens the upsell instead of the error toast.
      if (r.status === 402) {
        const data = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (data?.error === "reroll_limit") return "reroll_limit";
        return null;
      }
      // Any other non-OK status (5xx, etc.) → null → error state upstream.
      if (!r.ok) return null;
      const data = (await r.json()) as {
        ok: boolean;
        quests?: GeneratedQuest[];
      };
      if (!data.ok || !Array.isArray(data.quests) || data.quests.length === 0) {
        return null;
      }
      return data.quests;
    } catch {
      // Network throw → null → error state upstream.
      return null;
    }
  }

  // Streaming variant: posts to /api/generate/stream (SSE) and invokes
  // `onQuest` for each quest as the model finishes it, so cards render
  // progressively (first-quest-visible well before the full batch). Returns the
  // full batch on success, "reroll_limit" on the 402 cap, or null to signal the
  // caller should fall back to the non-streaming JSON endpoint (old deploy,
  // network error, or a stream that produced zero quests).
  async function fetchAiQuestsStreaming(
    region: string | null,
    places: NearbyPlace[],
    typeCounts: Record<string, number>,
    excludeIds: string[],
    previousTitles: string[],
    category: QuestCategory | null,
    onQuest: (q: GeneratedQuest) => void,
  ): Promise<GeneratedQuest[] | null | "reroll_limit"> {
    try {
      const r = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildGenerateBody(
            region,
            places,
            typeCounts,
            excludeIds,
            previousTitles,
            category,
          ),
        ),
      });
      if (r.status === 402) {
        const data = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (data?.error === "reroll_limit") return "reroll_limit";
        return null;
      }
      // Non-OK or no stream body → fall back to the JSON endpoint.
      if (!r.ok || !r.body) return null;

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      const collected: GeneratedQuest[] = [];
      let buf = "";
      // Parse the SSE frames ("data: {...}\n\n") as they arrive.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: { type?: string; quest?: GeneratedQuest } | null = null;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            evt = null;
          }
          if (!evt) continue;
          if (evt.type === "quest" && evt.quest) {
            collected.push(evt.quest);
            onQuest(evt.quest);
          }
          // "error"/"done" need no special handling — loop ends on stream close;
          // zero collected quests falls back to the JSON endpoint below.
        }
      }
      // Any quests we streamed are a usable result; zero → fall back to JSON.
      return collected.length > 0 ? collected : null;
    } catch {
      return null;
    }
  }

  const generate = async (
    overrideCategory?: QuestCategory | null,
  ) => {
    if (!canGenerate) return;
    setPrefsOpen(false);
    setQuests(null);
    setRolling(true);
    setView("results");

    // Locale signal for THIS generation. We always have at least the raw city
    // (enough for geographic plausibility), so rerolls never wait on the
    // nearby fetch. The FIRST roll of a session is the exception below.
    const cityKey = city.trim().toLowerCase();
    const cachedNearby = nearbyCacheRef.current[cityKey];
    let region: string | null = cachedNearby?.region ?? null;
    let places: NearbyPlace[] = cachedNearby?.places ?? [];
    let typeCounts: Record<string, number> = cachedNearby?.typeCounts ?? {};

    // We have a usable locale (raw city at minimum) → no alarming banner.
    setNearbyStatus("ok");

    if (cachedNearby) {
      // Warm path (the common case now that the city-change effect
      // prefetches): reuse the geocode + Overpass result, only pay the LLM.
      setNearbyStatus(cachedNearby.region ? "ok" : "fallback");
    } else {
      const nearbyPromise = fetchNearby(city).then((res) => {
        nearbyCacheRef.current[cityKey] = res;
        // Only flag a true geocode failure (no region at all). Empty venues on
        // a city that resolved fine is NOT a fallback — quests stay locale-aware
        // via the region/raw city.
        if (!res.region) setNearbyStatus("fallback");
        return res;
      });
      // First roll of a session (empty title memory): the impression-forming
      // roll, and the one the server routes to the stronger model — give the
      // nearby fetch up to ~2s so it isn't venue-blind, then proceed without
      // it. Rerolls keep the old behavior: background warm, never block.
      const isFirstRoll =
        loadShownTitles().length === 0 && loadRecentQuests().length === 0;
      if (isFirstRoll) {
        const res = await Promise.race([
          nearbyPromise,
          new Promise<null>((resolve) =>
            window.setTimeout(() => resolve(null), 2_000),
          ),
        ]);
        if (res) {
          region = res.region;
          places = res.places;
          typeCounts = res.typeCounts;
        }
      }
    }

    // Session memory. The on-screen batch is merged in (deduped — it may
    // already be here from the post-success append) to cover batches that
    // rendered but never persisted, e.g. streamed cards from a stream that
    // later errored before generate() saved them.
    let shown = loadShown();
    let shownTitles = loadShownTitles();
    if (quests) {
      const currentIds = quests.map((q) => q.id);
      const currentTitles = quests.map((q) => q.title);
      shown = Array.from(new Set([...shown, ...currentIds]));
      shownTitles = mergeTitles(shownTitles, currentTitles);
      saveShown(shown);
      saveShownTitles(shownTitles);
    }

    // Persistent ring buffer (last 30 {id, title}, localStorage) — survives
    // reload and tab close so rerolls don't keep surfacing the same set when
    // the user returns later. Titles feed the server's BANNED TITLES
    // blocklist (its similarity checks work on titles); ids keep feeding
    // excludeIds. Oldest first so the server's oldest-first truncation drops
    // the stalest memory.
    const recent = loadRecentQuests();
    const excludeIds = Array.from(
      new Set([...shown, ...recent.map((r) => r.id)]),
    );
    const bannedTitles = mergeTitles(
      recent.map((r) => r.title),
      shownTitles,
    );

    const cat =
      overrideCategory !== undefined ? overrideCategory : categoryFilter;

    // Try the streaming endpoint first: render each quest the moment it lands
    // so the first card is visible well before the full batch finishes. Quests
    // arriving via the callback are shown progressively; the spinner clears on
    // the first one. Falls back to the JSON endpoint on null (old deploy,
    // network error, or zero quests streamed).
    const streamed: GeneratedQuest[] = [];
    let aiResult = await fetchAiQuestsStreaming(
      region,
      places,
      typeCounts,
      excludeIds,
      bannedTitles,
      cat,
      (q) => {
        streamed.push(q);
        setQuests([...streamed]);
        setRolling(false);
      },
    );
    if (aiResult === null) {
      // Streaming unavailable/failed with nothing rendered → JSON fallback.
      aiResult = await fetchAiQuests(
        region,
        places,
        typeCounts,
        excludeIds,
        bannedTitles,
        cat,
      );
    }
    // Free-tier cap hit — block here. No results rendered; just surface the
    // upsell modal.
    if (aiResult === "reroll_limit") {
      setRolling(false);
      setOutOfRerollsOpen(true);
      return;
    }
    // AI-only generation: if the API call returns null (network/5xx/parse
    // failure), surface an error to the user. There is no local fallback —
    // we deliberately removed the template-based generator so the model is
    // the single source of truth.
    if (!aiResult) {
      setRolling(false);
      setToast("Couldn't generate quests right now. Please try again.");
      setTimeout(() => setToast(null), 4000);
      return;
    }
    const picked = aiResult;

    const nextShown = Array.from(
      new Set([...shown, ...picked.map((q) => q.id)]),
    );
    const nextShownTitles = mergeTitles(
      shownTitles,
      picked.map((q) => q.title),
    );
    saveShown(nextShown);
    saveShownTitles(nextShownTitles);
    // Append the batch into the persistent {id, title} ring buffer so the
    // titles land in the next request's blocklist.
    appendRecentQuests(picked.map((q) => ({ id: q.id, title: q.title })));

    setQuests(picked);
    setRolling(false);

    // Silent generation counter — M8 will read this to enforce a daily limit.
    if (user) {
      supabase.rpc("increment_daily_generation_counter").then(() => {
        // ignore result in M5
      });
    }
  };

  const startQuest = async (q: GeneratedQuest) => {
    if (!user) {
      setSignInIntent("start");
      setSignInOpen(true);
      return;
    }
    if (active) {
      // Locked — open the active quest detail instead of starting a new one.
      router.push("/quest/active");
      return;
    }
    setStartingId(q.id);
    setStartError(null);
    const { data, error } = await supabase.rpc("start_quest", {
      p_title: q.title,
      p_description: q.description,
      p_category: q.category,
      p_spice: q.spice,
      p_estimated_minutes:
        Number.isFinite(q.maxTime) && q.maxTime > 0 ? q.maxTime : null,
      p_location_text: city || null,
      p_source: "ai_generated",
    });
    setStartingId(null);
    if (error) {
      if (error.message?.includes("active_quest_exists")) {
        setStartError("Finish your current quest first.");
        await refreshActive();
        router.push("/quest/active");
        return;
      }
      setStartError(error.message ?? "Couldn't start quest. Try again.");
      return;
    }
    await refreshActive();
    if (data) {
      router.push("/quest/active");
    }
  };

  const rateQuest = (q: GeneratedQuest, rating: Rating) => {
    const record: RatingRecord = {
      questId: q.id,
      questName: q.title,
      category: q.category,
      spiceLevel: spice,
      groupSize,
      timeAvailable: timeMinutes,
      rating,
      timestamp: Date.now(),
    };
    const next = [...ratingsHistory, record];
    setRatingsHistory(next);
    saveRatings(next);
    fetch("/api/rate-quest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => {});
  };

  const toggleBookmark = (q: GeneratedQuest) => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.id === q.id);
      const next = exists ? prev.filter((b) => b.id !== q.id) : [...prev, q];
      saveBookmarks(next);
      return next;
    });
  };

  const timeLabel = useMemo(() => {
    if (timeMinutes < 60) return `${timeMinutes} min`;
    const h = Math.floor(timeMinutes / 60);
    const m = timeMinutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }, [timeMinutes]);

  const sourceList: GeneratedQuest[] =
    view === "saved" ? bookmarks : quests ?? [];
  const displayedQuests = categoryFilter
    ? sourceList.filter((q) => q.category === categoryFilter)
    : sourceList;

  const showResultsArea = view === "saved" || quests !== null || rolling;

  // SSR-safe gate. completedAt (truthy) is the single source of truth for
  // "onboarded"; until we've hydrated localStorage on the client we render
  // null to avoid both a hydration mismatch and a flash of home content
  // before the redirect decision.
  if (!mounted || onboardingLoading) {
    return null;
  }
  if (!forceFlag && !onboardingDone) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* HERO — design v2 milestone 1 */}
      <section className="relative w-full overflow-visible px-6 pt-20 pb-12 sm:pt-28 md:pb-16">
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="ds-hero-badge"
          >
            <MapPin
              weight="duotone"
              size={14}
              color="var(--text-secondary)"
              aria-hidden="true"
            />
            IRL adventure generator
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="ds-hero-title mt-6"
          >
            Unemployment
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="ds-hero-subhead"
          >
            Spontaneous real-world quests. Pick your vibe, go cause some delight.
          </motion.p>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-12 max-w-3xl px-4 sm:px-6">
        {/* INPUTS */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="glass p-5 sm:p-7"
        >
          <label className="block">
            <span
              className="ds-prefs-label"
              style={{ marginBottom: "var(--space-2)" }}
            >
              <span>Location</span>
            </span>
            <div className="ds-loc-field">
              <input
                ref={locInputRef}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  try {
                    localStorage.setItem("sqLocation", e.target.value);
                  } catch {
                    // ignore
                  }
                }}
                placeholder="e.g. Washington DC"
                className="ds-loc-input"
              />
              <span className="ds-loc-pin-marker" aria-hidden="true">
                <MapPin weight="duotone" size={16} />
              </span>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locBusy}
                aria-label="Use my location"
                title="Use my location"
                className="ds-loc-pin"
                hidden={
                  typeof window !== "undefined" && !window.isSecureContext
                }
                data-busy={locBusy ? "true" : "false"}
              >
                {locBusy ? (
                  <CircleNotch
                    weight="duotone"
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <Crosshair weight="duotone" size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            {/* Progress + error helpers — amber for errors, tertiary for the
              * in-flight hints. Only one shows at a time. */}
            {locError ? (
              <span className="ds-loc-helper" role="status">{locError}</span>
            ) : locHint ? (
              <span className="ds-loc-helper" data-info="true" role="status">
                {locHint}
              </span>
            ) : lastKnownLabel && city === lastKnownLabel ? (
              <span style={{ display: "inline-flex", marginTop: 8, gap: 6 }}>
                <button
                  type="button"
                  className="ds-loc-chip-ghost"
                  onClick={() => {
                    setCity("");
                    setLastKnownLabel(null);
                    try {
                      localStorage.removeItem("sqLocation");
                    } catch {
                      // ignore
                    }
                  }}
                  aria-label="Clear last known location and re-search"
                >
                  Last known · clear
                </button>
              </span>
            ) : null}
          </label>

          {/* PREFERENCES + QUICK-ACTION PILLS — Last quest, Saved.
            * Scrolls horizontally if the row overflows on small screens. */}
          <div className="ds-home-chip-row mt-4">
            <button
              type="button"
              onClick={() => setPrefsOpen((v) => !v)}
              className="ds-prefs-pill"
              data-open={prefsOpen ? "true" : "false"}
              aria-expanded={prefsOpen}
            >
              <Sliders weight="duotone" size={14} aria-hidden="true" />
              <span>Preferences</span>
              <span className="ds-prefs-caret" aria-hidden="true">
                <CaretDown weight="duotone" size={12} />
              </span>
            </button>

            {(() => {
              const last = completedEvents[0];
              if (!last) return null;
              return (
                <Link
                  href={`/quest/${last.quest_id}`}
                  className="ds-prefs-pill"
                  aria-label={`Last quest ${formatTimeSince(last.created_at)}`}
                >
                  <Clock weight="duotone" size={14} aria-hidden="true" />
                  <span>Last quest · {formatTimeSince(last.created_at)}</span>
                </Link>
              );
            })()}

            {bookmarks.length > 0 && (
              <Link
                href="/history?filter=saved"
                className="ds-prefs-pill"
                aria-label={`Saved ${bookmarks.length}`}
              >
                <BookmarkSimple
                  weight="duotone"
                  size={14}
                  aria-hidden="true"
                />
                <span>Saved · {bookmarks.length}</span>
              </Link>
            )}
          </div>

          {/* REROLL METER — free tier only (M12.1). Pro is uncapped. */}
          {!isPro && (
            <p
              className="ds-hero-helper"
              role="status"
              style={{
                marginTop: "var(--space-4)",
                textAlign: "center",
                ...(rerollsRemaining <= 0
                  ? { color: "var(--warning)" }
                  : {}),
              }}
            >
              {rerollsRemaining > 0
                ? `${rerollsRemaining}/${FREE_DAILY_REROLLS} rerolls remaining today`
                : `${FREE_DAILY_REROLLS}/${FREE_DAILY_REROLLS} rerolls used today. Resets at midnight UTC.`}
            </p>
          )}

          {/* GENERATE BUTTON — design v2 CTA */}
          <div className="mt-6 flex flex-col items-center">
            <button
              type="button"
              onClick={() => generate()}
              disabled={!canGenerate || rolling}
              className="ds-cta"
            >
              {rolling ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                    className="inline-flex"
                    aria-hidden="true"
                  >
                    <Sparkle weight="duotone" size={18} color="#1a1614" />
                  </motion.span>
                  <span>
                    {nearbyStatus === "loading"
                      ? "Finding nearby spots…"
                      : "Generating…"}
                  </span>
                </>
              ) : quests ? (
                <>
                  <Sparkle weight="duotone" size={18} color="#1a1614" aria-hidden="true" />
                  <span>Reroll quests</span>
                </>
              ) : (
                <>
                  <Sparkle weight="duotone" size={18} color="#1a1614" aria-hidden="true" />
                  <span>Generate quests</span>
                </>
              )}
            </button>
            {!canGenerate && (
              <p className="ds-hero-helper">
                Add a location to begin your adventure.
              </p>
            )}
            {nearbyStatus === "fallback" && quests && (
              <p className="ds-hero-helper" style={{ color: "var(--warning)" }}>
                Couldn&apos;t pin your exact area — quests may be a little less
                locale-specific.
              </p>
            )}
          </div>
        </motion.section>

        {/* PREFERENCES PANEL — sibling card, flush with the location card above. */}
        <AnimatePresence initial={false}>
          {prefsOpen && (
            <motion.div
              key="prefs-panel"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden"
              style={{ marginTop: "var(--space-4)" }}
            >
              <div className="glass ds-prefs-panel">
                <div className="ds-prefs-grid">
                  <div className="ds-prefs-row">
                    <div className="ds-prefs-label">
                      <span>Group size</span>
                      <span className="ds-prefs-value">{groupSize}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={groupSize}
                      onChange={(e) => setGroupSize(Number(e.target.value))}
                      className="ds-slider"
                      data-fill="success"
                      style={
                        {
                          ["--fill-pct" as string]: `${((groupSize - 1) / 9) * 100}%`,
                        } as React.CSSProperties
                      }
                      aria-label="Group size"
                    />
                  </div>
                  <div className="ds-prefs-row">
                    <div className="ds-prefs-label">
                      <span>Time</span>
                      <span className="ds-prefs-value">{timeLabel}</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={240}
                      step={15}
                      value={timeMinutes}
                      onChange={(e) => setTimeMinutes(Number(e.target.value))}
                      className="ds-slider"
                      data-fill="success"
                      style={
                        {
                          ["--fill-pct" as string]: `${((timeMinutes - 30) / 210) * 100}%`,
                        } as React.CSSProperties
                      }
                      aria-label="Time"
                    />
                  </div>
                  <div className="ds-prefs-row">
                    <div className="ds-prefs-label">
                      <span>Spice</span>
                      <span className="ds-prefs-value">{spice}/10</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={spice}
                      onChange={(e) => setSpice(Number(e.target.value))}
                      className="ds-slider"
                      data-fill="warning"
                      style={
                        {
                          ["--fill-pct" as string]: `${((spice - 1) / 9) * 100}%`,
                        } as React.CSSProperties
                      }
                      aria-label="Spice"
                    />
                  </div>
                  <div className="ds-prefs-row">
                    <div className="ds-prefs-label">
                      <span>Can drive</span>
                    </div>
                    <div className="ds-toggle-row">
                      <span className="ds-toggle-label">Yes, we can drive</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={canDrive}
                        aria-label="Can drive"
                        onClick={() => setCanDrive((v) => !v)}
                        className="ds-toggle"
                        data-on={canDrive ? "true" : "false"}
                      >
                        <span className="ds-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                  <div className="ds-prefs-row">
                    <div className="ds-prefs-label">
                      <span>Low / no cost</span>
                    </div>
                    <div className="ds-toggle-row">
                      <span className="ds-toggle-label">Free or cheap only</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={lowCostOnly}
                        aria-label="Low or no cost only"
                        onClick={() => setLowCostOnly((v) => !v)}
                        className="ds-toggle"
                        data-on={lowCostOnly ? "true" : "false"}
                      >
                        <span className="ds-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FILTER CHIPS — always visible (M7.1). Tap a category to scope
          * generation to it. The All / Saved chips toggle the displayed view. */}
        <nav
          aria-label="Filter quests"
          className="ds-filter-scroll relative mt-8 -mx-4 sm:-mx-6"
        >
            <DsChip
              active={view === "results" && categoryFilter === null}
              onClick={() => {
                setView("results");
                setCategoryFilter(null);
              }}
            >
              All
            </DsChip>
            <DsChip
              active={view === "saved"}
              onClick={() => setView("saved")}
              leadingIcon={
                <BookmarkSimple
                  weight="duotone"
                  size={14}
                  color="var(--text-tertiary)"
                  aria-hidden="true"
                />
              }
            >
              Saved
              <span
                className="ml-1 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  background: "var(--bg-glass-strong)",
                  color: "var(--text-secondary)",
                }}
              >
                {bookmarks.length}
              </span>
            </DsChip>
            {ALL_CATEGORIES.map((c) => {
              const active = categoryFilter === c;
              return (
                <DsChip
                  key={c}
                  active={active}
                  onClick={() => {
                    if (active) {
                      setCategoryFilter(null);
                      if (view === "saved") setView("results");
                      return;
                    }
                    setCategoryFilter(c);
                    setView("results");
                    if (canGenerate && !rolling) {
                      generate(c);
                    }
                  }}
                >
                  {c}
                </DsChip>
              );
            })}
        </nav>

        {/* QUEST CARDS */}
        {showResultsArea && (
          <section className="mt-4 space-y-4">
            {rolling ? (
              <div className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="glass relative h-44 overflow-hidden p-6"
                  >
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                    <div className="space-y-3">
                      <div className="h-4 w-24 rounded-full bg-white/10" />
                      <div className="h-5 w-3/4 rounded bg-white/10" />
                      <div className="h-3 w-full rounded bg-white/[0.07]" />
                      <div className="h-3 w-5/6 rounded bg-white/[0.07]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedQuests.length === 0 ? (
              <div
                className="glass p-10 text-center text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                {view === "saved"
                  ? bookmarks.length === 0
                    ? "No bookmarks yet. Tap the bookmark on any quest to save it."
                    : `No saved quests in ${categoryFilter}. Try another category.`
                  : `No quests in ${categoryFilter}. Try another filter or reroll.`}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {displayedQuests.map((q, i) => {
                  const userRating = ratingByQuest[q.id];
                  const bookmarked = bookmarkIds.has(q.id);
                  const CategoryIcon =
                    CATEGORY_ICONS[q.category] ?? Sparkle;
                  const spicePct = Math.max(
                    0,
                    Math.min(100, (q.spice / 10) * 100),
                  );
                  return (
                    <motion.article
                      key={q.id + "-" + i}
                      layout
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{
                        duration: 0.35,
                        delay: i * 0.06,
                        ease: "easeOut",
                      }}
                      className="glass ds-card"
                    >
                      <button
                        type="button"
                        onClick={() => toggleBookmark(q)}
                        aria-label={
                          bookmarked ? "Remove bookmark" : "Bookmark quest"
                        }
                        aria-pressed={bookmarked}
                        className="ds-bookmark"
                        data-saved={bookmarked ? "true" : "false"}
                      >
                        <BookmarkSimple
                          size={20}
                          weight={bookmarked ? "fill" : "duotone"}
                          aria-hidden="true"
                        />
                      </button>

                      <div className="flex flex-wrap items-center gap-2 pr-12">
                        <span className="ds-cat-chip">
                          <span
                            className="ds-cat-chip-icon"
                            aria-hidden="true"
                          >
                            <CategoryIcon weight="duotone" size={12} />
                          </span>
                          {q.category}
                        </span>
                        {q.nearbyDetected && (
                          <span className="ds-cat-chip">
                            <span
                              className="ds-cat-chip-icon"
                              aria-hidden="true"
                            >
                              <MapPin weight="duotone" size={12} />
                            </span>
                            Nearby
                          </span>
                        )}
                      </div>

                      <h3 className="ds-card-title mt-3">{q.title}</h3>
                      <p className="ds-card-desc">{q.description}</p>

                      <div className="ds-meta-row">
                        <span className="ds-meta-item">
                          <UsersThree
                            weight="duotone"
                            size={14}
                            aria-hidden="true"
                          />
                          {q.minGroup === q.maxGroup
                            ? q.minGroup
                            : `${q.minGroup}-${q.maxGroup}`}
                        </span>
                        <span className="ds-meta-item">
                          <Clock
                            weight="duotone"
                            size={14}
                            aria-hidden="true"
                          />
                          {q.minTime === q.maxTime
                            ? `${q.minTime}m`
                            : `${q.minTime}-${q.maxTime}m`}
                        </span>
                        {q.cost && (
                          <span className="ds-meta-item">
                            <CurrencyDollar
                              weight="duotone"
                              size={14}
                              aria-hidden="true"
                            />
                            {q.cost}
                          </span>
                        )}
                      </div>

                      {(() => {
                        const variant = !user
                          ? "default"
                          : !active
                            ? "default"
                            : active.quest.title === q.title
                              ? "open"
                              : "locked";
                        const starting = startingId === q.id;
                        return (
                          <button
                            type="button"
                            className="ds-start-btn"
                            data-variant={variant}
                            disabled={starting}
                            onClick={() => startQuest(q)}
                            aria-label={
                              variant === "locked"
                                ? "Finish your current quest first"
                                : variant === "open"
                                  ? "Open active quest"
                                  : "Start this quest"
                            }
                          >
                            {variant === "locked" ? (
                              <>
                                <Lock
                                  weight="duotone"
                                  size={16}
                                  aria-hidden="true"
                                />
                                <span>Finish your current quest first</span>
                              </>
                            ) : variant === "open" ? (
                              <>
                                <ArrowRight
                                  weight="duotone"
                                  size={16}
                                  aria-hidden="true"
                                />
                                <span>Open active quest</span>
                              </>
                            ) : starting ? (
                              <>
                                <CircleNotch
                                  weight="duotone"
                                  size={16}
                                  aria-hidden="true"
                                  className="animate-spin"
                                />
                                <span>Starting…</span>
                              </>
                            ) : (
                              <>
                                <Play
                                  weight="duotone"
                                  size={16}
                                  aria-hidden="true"
                                />
                                <span>Start this quest</span>
                              </>
                            )}
                          </button>
                        );
                      })()}

                      <div className="ds-spice">
                        <div
                          className="ds-spice-track"
                          role="img"
                          aria-label={`Spice ${q.spice} of 10`}
                        >
                          <div
                            className="ds-spice-fill"
                            style={{ width: `${spicePct}%` }}
                          />
                        </div>
                        <span className="ds-spice-label">
                          Spice · {q.spice}/10
                        </span>
                      </div>

                      <div
                        className="ds-reactions"
                        role="radiogroup"
                        aria-label="Rate this quest"
                      >
                        {RATING_ORDER.map((r) => {
                          const active = userRating === r;
                          const ReactionIcon = REACTION_ICONS[r];
                          return (
                            <button
                              key={r}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => rateQuest(q, r)}
                              className="ds-reaction"
                              data-active={active ? "true" : "false"}
                            >
                              <ReactionIcon
                                weight={active ? "fill" : "duotone"}
                                size={14}
                                aria-hidden="true"
                              />
                              <span>{REACTION_LABELS[r]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            )}
          </section>
        )}

        {/* FOOTER — Suggest pill + tagline. */}
        <div
          className="flex flex-col items-center"
          style={{
            marginTop: "var(--space-7)",
            paddingBottom: "var(--space-7)",
          }}
        >
          <button
            type="button"
            onClick={() => setSuggestOpen(true)}
            className="ds-suggest-pill"
          >
            <Lightbulb weight="duotone" size={14} aria-hidden="true" />
            <span>Suggest a quest</span>
          </button>
          <p
            className="ds-footer-line"
            style={{ marginTop: "var(--space-6)" }}
          >
            Stay safe. Be kind. Take photos.
          </p>
        </div>
      </div>

      {/* SUGGEST MODAL */}
      <AnimatePresence>
        {suggestOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="ds-modal-overlay"
            onClick={() =>
              !suggestBusy && !suggestSent && setSuggestOpen(false)
            }
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              className="glass ds-modal-card"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="suggest-title"
            >
              <div className="flex items-center justify-between">
                <h3 id="suggest-title" className="ds-modal-title">
                  <Lightbulb weight="duotone" size={20} aria-hidden="true" />
                  Suggest a quest
                </h3>
                <button
                  type="button"
                  onClick={() => setSuggestOpen(false)}
                  disabled={suggestBusy}
                  className="ds-modal-close"
                  aria-label="Close"
                >
                  <X weight="duotone" size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="ds-modal-hint">
                Got an idea for a quest? Drop it here.
              </p>
              <textarea
                value={suggestText}
                onChange={(e) =>
                  setSuggestText(e.target.value.slice(0, 500))
                }
                placeholder="At a hardware store, see who can build the tallest free-standing tower out of $10 of supplies in 15 minutes..."
                rows={4}
                maxLength={500}
                disabled={suggestBusy || suggestSent}
                className="ds-textarea"
                aria-label="Quest idea"
              />
              <p className="ds-modal-counter">{suggestText.length}/500</p>

              <p className="ds-modal-section-label">
                Your self-rating (optional)
              </p>
              <div
                className="ds-reactions"
                role="radiogroup"
                aria-label="Self-rating"
              >
                {RATING_ORDER.map((r) => {
                  const active = suggestSelfRating === r;
                  const ReactionIcon = REACTION_ICONS[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        setSuggestSelfRating((cur) => (cur === r ? null : r))
                      }
                      disabled={suggestBusy || suggestSent}
                      className="ds-reaction"
                      data-active={active ? "true" : "false"}
                    >
                      <ReactionIcon
                        weight={active ? "fill" : "duotone"}
                        size={14}
                        aria-hidden="true"
                      />
                      <span>{REACTION_LABELS[r]}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={submitSuggestion}
                disabled={!suggestText.trim() || suggestBusy || suggestSent}
                className="ds-cta ds-modal-submit"
              >
                {suggestSent ? (
                  <>
                    <Check
                      weight="duotone"
                      size={16}
                      color="#1a1614"
                      aria-hidden="true"
                    />
                    <span>Thanks! Sent.</span>
                  </>
                ) : suggestBusy ? (
                  <>
                    <CircleNotch
                      weight="duotone"
                      size={16}
                      color="#1a1614"
                      aria-hidden="true"
                      className="animate-spin"
                    />
                    <span>Sending…</span>
                  </>
                ) : (
                  <span>Submit suggestion</span>
                )}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SignInModal
        open={signInOpen}
        intent={signInIntent}
        onClose={() => setSignInOpen(false)}
      />
      <OutOfRerollsModal
        open={outOfRerollsOpen}
        onClose={() => setOutOfRerollsOpen(false)}
        onGoPro={() => {
          setOutOfRerollsOpen(false);
          setToast("Coming soon — we’ll email you when Pro launches");
          window.setTimeout(() => setToast(null), 3200);
        }}
      />
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "calc(80px + env(safe-area-inset-bottom))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            padding: "10px 16px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-body, inherit)",
            fontSize: 13,
            boxShadow: "var(--shadow-card)",
          }}
        >
          {toast}
        </div>
      )}
      {startError && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "calc(80px + env(safe-area-inset-bottom))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            padding: "10px 16px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-body, inherit)",
            fontSize: 13,
            boxShadow: "var(--shadow-card)",
          }}
        >
          {startError}
        </div>
      )}
    </main>
  );
}

function DsChip({
  children,
  active,
  onClick,
  leadingIcon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  leadingIcon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      className="ds-chip"
    >
      {active && (
        <Check
          weight="duotone"
          size={14}
          color="var(--text-primary)"
          aria-hidden="true"
        />
      )}
      {!active && leadingIcon}
      <span>{children}</span>
    </button>
  );
}
