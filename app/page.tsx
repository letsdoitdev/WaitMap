"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { generateQuests, GeneratedQuest } from "@/lib/generate";
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
import { createClient } from "@/lib/supabase/client";
import SignInModal, { SignInIntent } from "@/components/SignInModal";
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

function loadShown(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SHOWN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
function saveShown(ids: string[]) {
  try {
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function loadShownTitles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SHOWN_TITLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
function saveShownTitles(titles: string[]) {
  try {
    sessionStorage.setItem(SHOWN_TITLES_KEY, JSON.stringify(titles));
  } catch {
    // ignore
  }
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
  const { user } = useAuth();
  const { active, refresh: refreshActive } = useActiveQuest();
  const { completedEvents } = useStats();
  const supabase = useMemo(() => createClient(), []);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInIntent, setSignInIntent] = useState<SignInIntent>("save");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [groupSize, setGroupSize] = useState(3);
  const [timeMinutes, setTimeMinutes] = useState(90);
  const [spice, setSpice] = useState(5);
  const [quests, setQuests] = useState<GeneratedQuest[] | null>(null);
  const [rolling, setRolling] = useState(false);
  const [nearbyStatus, setNearbyStatus] = useState<
    "idle" | "loading" | "ok" | "fallback"
  >("idle");
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

  // Auto-fill the location input from the browser's geolocation. Only ever
  // fires on explicit tap of the crosshair button — never on mount, never
  // via a "first-visit" flag. Uses Mapbox v5 places reverse geocoding so we
  // stay on a single geocoder for the whole app.
  const useMyLocation = () => {
    if (locBusy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("Couldn't get your location — type it instead.");
      return;
    }
    setLocBusy(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
          if (!token) {
            setLocError("Couldn't get your location — type it instead.");
            return;
          }
          const r = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?types=place,locality,neighborhood&limit=1&access_token=${token}`,
          );
          if (!r.ok) throw new Error("reverse geocode failed");
          const data = (await r.json()) as {
            features?: {
              text?: string;
              context?: { id?: string; short_code?: string; text?: string }[];
            }[];
          };
          const feature = data.features?.[0];
          if (!feature?.text) {
            setLocError("Couldn't get your location — type it instead.");
            return;
          }
          const region = feature.context?.find((c) =>
            c.id?.startsWith("region"),
          );
          const regionShort = region?.short_code
            ?.replace(/^us-/i, "")
            .toUpperCase();
          // US localities get just the state name (e.g. "Ashburn Virginia");
          // outside the US we fall back to "Place, Country" via context.text.
          const regionText =
            region?.short_code?.toLowerCase().startsWith("us-") &&
            region.text
              ? region.text
              : regionShort ?? region?.text ?? "";
          const next = regionText
            ? `${feature.text} ${regionText}`
            : feature.text;
          setCity(next);
          try {
            localStorage.setItem("sqLocation", next);
          } catch {
            // ignore quota errors
          }
        } catch {
          setLocError("Couldn't get your location — type it instead.");
        } finally {
          setLocBusy(false);
        }
      },
      () => {
        setLocBusy(false);
        setLocError("Couldn't get your location — type it instead.");
      },
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  };

  useEffect(() => {
    setRatingsHistory(loadRatings());
    setBookmarks(loadBookmarks());
    try {
      const saved = localStorage.getItem("sqLocation");
      if (saved) setCity(saved);
    } catch {
      // ignore
    }
  }, []);

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

  async function fetchNearby(
    loc: string,
  ): Promise<{ places: NearbyPlace[]; typeCounts: Record<string, number> }> {
    try {
      const r = await fetch(
        `/api/nearby-places?location=${encodeURIComponent(loc)}`,
      );
      if (!r.ok) return { places: [], typeCounts: {} };
      const data = (await r.json()) as NearbyResponse;
      if (!data.ok) return { places: [], typeCounts: {} };
      return { places: data.places, typeCounts: data.typeCounts ?? {} };
    } catch {
      return { places: [], typeCounts: {} };
    }
  }

  async function fetchAiQuests(
    places: NearbyPlace[],
    typeCounts: Record<string, number>,
    excludeIds: string[],
    previousTitles: string[],
    category: QuestCategory | null,
  ): Promise<GeneratedQuest[] | null> {
    const groupBand: "solo" | "2" | "group" =
      groupSize === 1 ? "solo" : groupSize === 2 ? "2" : "group";
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: city,
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
          lowCostOnly,
        }),
      });
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
    setNearbyStatus("loading");
    setView("results");

    const { places, typeCounts } = await fetchNearby(city);
    setNearbyStatus(places.length > 0 ? "ok" : "fallback");

    let shown = loadShown();
    let shownTitles = loadShownTitles();
    if (quests) {
      const currentIds = quests.map((q) => q.id);
      const currentTitles = quests.map((q) => q.title);
      shown = Array.from(new Set([...shown, ...currentIds]));
      shownTitles = [...shownTitles, ...currentTitles].slice(-9);
      saveShown(shown);
      saveShownTitles(shownTitles);
    }

    const cat =
      overrideCategory !== undefined ? overrideCategory : categoryFilter;
    let picked = await fetchAiQuests(places, typeCounts, shown, shownTitles, cat);
    let resetShown = false;
    if (!picked) {
      const count = 3 + Math.floor(Math.random() * 3);
      const result = generateQuests(
        {
          city,
          groupSize,
          timeMinutes,
          spice,
          nearby: places,
          ratings: ratingByQuest,
          excludeIds: shown,
        },
        count,
      );
      picked = result.quests;
      resetShown = result.resetShown;
    }

    const nextShown = resetShown
      ? picked.map((q) => q.id)
      : Array.from(new Set([...shown, ...picked.map((q) => q.id)]));
    const nextShownTitles = resetShown
      ? picked.map((q) => q.title)
      : [...shownTitles, ...picked.map((q) => q.title)].slice(-9);
    saveShown(nextShown);
    saveShownTitles(nextShownTitles);

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
            {locError && (
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--warning)" }}
              >
                {locError}
              </p>
            )}
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
                Couldn&apos;t reach nearby venue data — using generic quests.
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
