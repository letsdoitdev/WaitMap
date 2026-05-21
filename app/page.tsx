"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ShaderAnimation } from "@/components/ui/shader-animation";

const CATEGORY_STYLES: Record<QuestCategory, string> = {
  Chaos: "bg-red-500/10 text-red-300 border-red-500/30",
  Outdoor: "bg-green-500/10 text-green-300 border-green-500/30",
  Social: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  Creative: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  Food: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Late Night": "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  Chill: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  Fitness: "bg-lime-500/10 text-lime-300 border-lime-500/30",
  Nature: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Tech: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  Exploration: "bg-orange-500/10 text-orange-300 border-orange-500/30",
};

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

const RATING_STYLES: {
  key: Rating;
  label: string;
  icon: string;
  hover: string;
  active: string;
}[] = [
  {
    key: "cooked",
    label: "Cooked",
    icon: "🗑️",
    hover: "hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40",
    active: "bg-red-500/30 text-red-200 border-red-400/60",
  },
  {
    key: "mid",
    label: "Mid",
    icon: "😐",
    hover: "hover:bg-yellow-500/20 hover:text-yellow-300 hover:border-yellow-500/40",
    active: "bg-yellow-500/30 text-yellow-200 border-yellow-400/60",
  },
  {
    key: "tuff",
    label: "Tuff",
    icon: "💪",
    hover: "hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500/40",
    active: "bg-blue-500/30 text-blue-200 border-blue-400/60",
  },
  {
    key: "fire",
    label: "Fire",
    icon: "🔥",
    hover: "hover:bg-orange-500/20 hover:text-orange-300 hover:border-orange-500/40",
    active: "bg-orange-500/30 text-orange-200 border-orange-400/60",
  },
];

function SpiceBar({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={`h-2 w-1.5 rounded-sm transition-colors ${
              i < level
                ? level >= 8
                  ? "bg-red-400"
                  : level >= 5
                    ? "bg-orange-400"
                    : "bg-emerald-400"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-white/60 tabular-nums">
        {level}/10
      </span>
    </div>
  );
}

type View = "results" | "saved";

export default function Home() {
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

  useEffect(() => {
    setRatingsHistory(loadRatings());
    setBookmarks(loadBookmarks());
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

  async function fetchNearby(loc: string): Promise<NearbyPlace[]> {
    try {
      const r = await fetch(
        `/api/nearby-places?location=${encodeURIComponent(loc)}`,
      );
      if (!r.ok) return [];
      const data = (await r.json()) as NearbyResponse;
      if (!data.ok) return [];
      return data.places;
    } catch {
      return [];
    }
  }

  async function fetchAiQuests(
    places: NearbyPlace[],
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
          nearbyPlaces: places.map((p) => p.name).slice(0, 20),
          spiceLevel: spice,
          groupSize: groupBand,
          timeAvailable: timeMinutes,
          excludeIds,
          previousTitles,
          category,
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
    setRolling(true);
    setNearbyStatus("loading");
    setView("results");

    const places = await fetchNearby(city);
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
    let picked = await fetchAiQuests(places, shown, shownTitles, cat);
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

  const showResultsArea = view === "saved" || quests !== null;

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0a0a0a] text-white">
      {/* Hidden SVG filter for glass distortion accents */}
      <svg className="hidden" aria-hidden="true">
        <defs>
          <filter
            id="glass-distortion"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            filterUnits="objectBoundingBox"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.001 0.005"
              numOctaves="1"
              seed="17"
              result="turbulence"
            />
            <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softMap"
              scale="200"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* HERO */}
      <section className="relative h-[42vh] min-h-[320px] w-full overflow-hidden">
        <ShaderAnimation className="absolute inset-0 h-full w-full opacity-30" />
        {/* Dark gradient overlay for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/40 via-[#0a0a0a]/40 to-[#0a0a0a]" />
        {/* Glow blob behind text */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white/60 backdrop-blur"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
            IRL Adventure Generator
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-balance text-5xl font-bold tracking-tight text-white md:text-7xl"
          >
            <span className="bg-gradient-to-br from-violet-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">
              Unemployment
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-4 max-w-xl text-balance text-sm text-white/55 md:text-base"
          >
            Spontaneous real-world quests. Pick your vibe, go cause some delight.
          </motion.p>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-12 max-w-3xl px-4 pb-24 sm:px-6">
        {/* INPUTS */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-7"
        >
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/50">
              Location
            </span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Washington DC"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-violet-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-violet-500/30"
            />
          </label>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Group size
                </span>
                <span className="text-sm text-white/80 tabular-nums">
                  {groupSize}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={groupSize}
                onChange={(e) => setGroupSize(Number(e.target.value))}
                className="slider-violet w-full"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Time
                </span>
                <span className="text-sm text-white/80 tabular-nums">
                  {timeLabel}
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={240}
                step={15}
                value={timeMinutes}
                onChange={(e) => setTimeMinutes(Number(e.target.value))}
                className="slider-violet w-full"
              />
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                Spice
              </span>
              <SpiceBar level={spice} />
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={spice}
              onChange={(e) => setSpice(Number(e.target.value))}
              className="slider-violet w-full"
            />
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.2em] text-white/30">
              <span>Chill</span>
              <span>Wild</span>
              <span>Unhinged</span>
            </div>
          </div>

          {/* GENERATE BUTTON */}
          <div className="relative mt-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-6 -bottom-3 h-10 rounded-full bg-violet-500/40 blur-2xl"
            />
            <button
              onClick={() => generate()}
              disabled={!canGenerate || rolling}
              className="group relative w-full overflow-hidden rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-base font-semibold text-white shadow-[0_0_30px_rgba(139,92,246,0.4)] transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:text-lg"
            >
              {/* Liquid glass overlay */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full bg-white/10 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100"
              />
              <span className="relative inline-flex items-center justify-center gap-2">
                {rolling ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                      className="inline-block"
                    >
                      ✦
                    </motion.span>
                    <span className="animate-pulse">
                      {nearbyStatus === "loading"
                        ? "Finding nearby spots..."
                        : "Generating..."}
                    </span>
                  </>
                ) : quests ? (
                  <>🎲 Reroll Quests</>
                ) : (
                  <>Generate Quests</>
                )}
              </span>
            </button>
            {!canGenerate && (
              <p className="mt-3 text-center text-xs text-white/40">
                Add a location to begin your adventure.
              </p>
            )}
            {nearbyStatus === "fallback" && quests && (
              <p className="mt-3 text-center text-xs text-amber-300/70">
                Couldn&apos;t reach nearby venue data — using generic quests.
              </p>
            )}
          </div>
        </motion.section>

        {/* FILTER CHIPS */}
        {showResultsArea && (
          <div className="no-scrollbar mt-8 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterPill
              active={view === "results" && categoryFilter === null}
              onClick={() => {
                setView("results");
                setCategoryFilter(null);
              }}
            >
              All
            </FilterPill>
            <FilterPill
              active={view === "saved"}
              gold
              onClick={() => setView("saved")}
            >
              🔖 Saved
              <span className="ml-1.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {bookmarks.length}
              </span>
            </FilterPill>
            {ALL_CATEGORIES.map((c) => {
              const active = categoryFilter === c;
              return (
                <FilterPill
                  key={c}
                  active={active}
                  onClick={() => {
                    if (active) {
                      // Toggling off — clear filter, no regenerate.
                      setCategoryFilter(null);
                      if (view === "saved") setView("results");
                      return;
                    }
                    setCategoryFilter(c);
                    setView("results");
                    // Trigger a fresh generation targeted at this category.
                    if (canGenerate && !rolling) {
                      generate(c);
                    }
                  }}
                >
                  {c}
                </FilterPill>
              );
            })}
          </div>
        )}

        {/* QUEST CARDS */}
        {showResultsArea && (
          <section className="mt-4 space-y-4">
            {displayedQuests.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-sm text-white/40 backdrop-blur-xl">
                {view === "saved"
                  ? bookmarks.length === 0
                    ? "No bookmarks yet. Tap 🔖 on any quest to save it."
                    : `No saved quests in ${categoryFilter}. Try another category.`
                  : `No quests in ${categoryFilter}. Try another filter or reroll.`}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {displayedQuests.map((q, i) => {
                  const userRating = ratingByQuest[q.id];
                  const bookmarked = bookmarkIds.has(q.id);
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
                      className="group relative rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] hover:shadow-[0_8px_30px_rgba(139,92,246,0.15)] sm:p-6"
                    >
                      <button
                        onClick={() => toggleBookmark(q)}
                        aria-label={
                          bookmarked ? "Remove bookmark" : "Bookmark quest"
                        }
                        aria-pressed={bookmarked}
                        className={`absolute right-4 top-4 rounded-lg border px-2 py-1 text-base transition active:scale-90 ${
                          bookmarked
                            ? "border-amber-400/60 bg-amber-500/20 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.3)]"
                            : "border-white/10 bg-white/5 text-white/40 hover:border-amber-400/40 hover:text-amber-300"
                        }`}
                      >
                        🔖
                      </button>

                      <div className="mb-3 flex flex-wrap items-center gap-2 pr-12">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CATEGORY_STYLES[q.category]}`}
                        >
                          {q.category}
                        </span>
                        {q.nearbyDetected && (
                          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            📍 Nearby
                          </span>
                        )}
                      </div>

                      <h3 className="text-lg font-semibold leading-snug text-white sm:text-xl">
                        {q.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-white/70 sm:text-[15px]">
                        {q.description}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
                        <span className="inline-flex items-center gap-1.5">
                          👥 {q.minGroup}-{q.maxGroup}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          ⏱ {q.minTime}-{q.maxTime}m
                        </span>
                        {q.cost && (
                          <span className="inline-flex items-center gap-1.5">
                            💵 {q.cost}
                          </span>
                        )}
                        <span className="ml-auto">
                          <SpiceBar level={q.spice} />
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2">
                        {RATING_STYLES.map((r) => {
                          const active = userRating === r.key;
                          return (
                            <button
                              key={r.key}
                              onClick={() => rateQuest(q, r.key)}
                              aria-pressed={active}
                              aria-label={`Rate ${r.label}`}
                              className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                                active
                                  ? r.active
                                  : `border-white/10 bg-white/[0.03] text-white/50 ${r.hover}`
                              }`}
                            >
                              <span>{r.icon}</span>
                              <span className="hidden xs:inline sm:inline">
                                {r.label}
                              </span>
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

        {/* FOOTER */}
        <div className="mt-16 flex flex-col items-center gap-4">
          <button
            onClick={() => setSuggestOpen(true)}
            className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2 text-sm text-white/60 backdrop-blur transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-violet-200"
          >
            💡 Suggest a Quest
          </button>
          <p className="text-xs text-white/30">
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
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 backdrop-blur-md sm:items-center"
            onClick={() =>
              !suggestBusy && !suggestSent && setSuggestOpen(false)
            }
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f10]/90 p-6 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">💡 Suggest a Quest</h3>
                <button
                  onClick={() => setSuggestOpen(false)}
                  disabled={suggestBusy}
                  className="text-white/40 transition hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="mb-3 text-xs text-white/50">
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
                className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder-white/30 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60"
              />
              <div className="mt-1 text-right text-[10px] text-white/40">
                {suggestText.length}/500
              </div>

              <div className="mt-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-white/50">
                  Your self-rating (optional)
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["cooked", "mid", "tuff", "fire"] as const).map((r) => {
                    const active = suggestSelfRating === r;
                    const icon =
                      r === "cooked"
                        ? "🗑️"
                        : r === "mid"
                          ? "😐"
                          : r === "tuff"
                            ? "💪"
                            : "🔥";
                    return (
                      <button
                        key={r}
                        onClick={() =>
                          setSuggestSelfRating((cur) => (cur === r ? null : r))
                        }
                        disabled={suggestBusy || suggestSent}
                        className={`rounded-full border px-2 py-1.5 text-xs font-semibold capitalize transition ${
                          active
                            ? "border-violet-400 bg-violet-500/30 text-violet-100"
                            : "border-white/10 text-white/50 hover:border-violet-400/40 hover:text-violet-200"
                        }`}
                      >
                        <span className="mr-1">{icon}</span>
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={submitSuggestion}
                disabled={!suggestText.trim() || suggestBusy || suggestSent}
                className="mt-5 w-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestSent
                  ? "✓ Thanks! Sent."
                  : suggestBusy
                    ? "Sending..."
                    : "Submit Suggestion"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function FilterPill({
  children,
  active,
  onClick,
  gold,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  gold?: boolean;
}) {
  const base =
    "shrink-0 inline-flex items-center rounded-full border px-4 py-1.5 text-sm whitespace-nowrap transition-all backdrop-blur";
  if (active) {
    return (
      <button
        onClick={onClick}
        className={`${base} ${
          gold
            ? "border-amber-400/60 bg-amber-500/20 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,0.25)]"
            : "border-violet-500 bg-violet-600/80 text-white shadow-[0_0_18px_rgba(139,92,246,0.45)]"
        }`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${base} border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white`}
    >
      {children}
    </button>
  );
}
