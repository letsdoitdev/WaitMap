"use client";

import { useEffect, useMemo, useState } from "react";
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

const CATEGORY_STYLES: Record<QuestCategory, string> = {
  Chaos: "bg-red-500/15 text-red-300 border-red-500/30",
  Outdoor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Social: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Creative: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Food: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Late Night": "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  Chill: "bg-teal-500/15 text-teal-200 border-teal-500/30",
  Fitness: "bg-lime-500/15 text-lime-200 border-lime-500/30",
  Nature: "bg-green-500/15 text-green-200 border-green-500/30",
  Tech: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  Exploration: "bg-orange-500/15 text-orange-200 border-orange-500/30",
};

const SHOWN_KEY = "sqShown";

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

const RATINGS: { key: Rating; label: string; icon: string; active: string; idle: string }[] = [
  {
    key: "cooked",
    label: "Cooked",
    icon: "🗑️",
    active: "bg-zinc-500/30 border-zinc-400 text-zinc-100",
    idle: "border-white/10 text-white/60 hover:border-zinc-400/50 hover:text-zinc-200",
  },
  {
    key: "mid",
    label: "Mid",
    icon: "😐",
    active: "bg-yellow-500/25 border-yellow-400 text-yellow-100",
    idle: "border-white/10 text-white/60 hover:border-yellow-400/50 hover:text-yellow-200",
  },
  {
    key: "tuff",
    label: "Tuff",
    icon: "💪",
    active: "bg-blue-500/25 border-blue-400 text-blue-100",
    idle: "border-white/10 text-white/60 hover:border-blue-400/50 hover:text-blue-200",
  },
  {
    key: "fire",
    label: "Fire",
    icon: "🔥",
    active: "bg-orange-500/30 border-orange-400 text-orange-100",
    idle: "border-white/10 text-white/60 hover:border-orange-400/50 hover:text-orange-200",
  },
];

function SpiceBar({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-white/60">Spice</span>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={`h-2 w-1.5 rounded-sm ${
              i < level
                ? level >= 8
                  ? "bg-red-500"
                  : level >= 5
                    ? "bg-orange-400"
                    : "bg-emerald-400"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-semibold text-white/80">{level}/10</span>
    </div>
  );
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
    // ignore quota / privacy-mode errors
  }
}

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
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [suggestSelfRating, setSuggestSelfRating] = useState<SelfRating>(null);
  const [suggestSent, setSuggestSent] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);

  useEffect(() => {
    setRatingsHistory(loadRatings());
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

  const ratingByQuest = useMemo(() => latestRatings(ratingsHistory), [ratingsHistory]);

  const canGenerate = city.trim().length > 0;

  async function fetchNearby(loc: string): Promise<NearbyPlace[]> {
    try {
      const r = await fetch(`/api/nearby-places?location=${encodeURIComponent(loc)}`);
      if (!r.ok) return [];
      const data = (await r.json()) as NearbyResponse;
      if (!data.ok) return [];
      return data.places;
    } catch {
      return [];
    }
  }

  const generate = async () => {
    if (!canGenerate) return;
    setRolling(true);
    setNearbyStatus("loading");

    const places = await fetchNearby(city);
    setNearbyStatus(places.length > 0 ? "ok" : "fallback");

    // On reroll, mark the currently-displayed quests as shown so they don't
    // come back.
    let shown = loadShown();
    if (quests) {
      const currentIds = quests.map((q) => q.id);
      shown = Array.from(new Set([...shown, ...currentIds]));
      saveShown(shown);
    }

    const count = 3 + Math.floor(Math.random() * 3); // 3-5
    const { quests: picked, resetShown } = generateQuests(
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

    // If we wrapped around, start the session fresh with only the new picks.
    const nextShown = resetShown
      ? picked.map((q) => q.id)
      : Array.from(new Set([...shown, ...picked.map((q) => q.id)]));
    saveShown(nextShown);

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
    // Fire-and-forget server save.
    fetch("/api/rate-quest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => {});
  };

  const timeLabel = useMemo(() => {
    if (timeMinutes < 60) return `${timeMinutes} min`;
    const h = Math.floor(timeMinutes / 60);
    const m = timeMinutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }, [timeMinutes]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <header className="mb-8 text-center sm:mb-12">
          <div className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-widest text-white/60">
            IRL Adventure Generator
          </div>
          <h1 className="mt-4 text-balance text-4xl font-black leading-tight tracking-tight sm:text-6xl">
            Side Quest{" "}
            <span className="bg-gradient-to-r from-fuchsia-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
              Generator
            </span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-white/60 sm:text-base">
            Spontaneous real-world quests for you and your friends. Pick your
            vibe, hit generate, go cause some delight.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-7">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-white/80">
                City / Location
              </span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Washington DC"
                className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-white placeholder-white/30 outline-none focus:border-fuchsia-400/60 focus:ring-2 focus:ring-fuchsia-400/30"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-white/80">
                <span>Group size</span>
                <span className="text-white/60">{groupSize}</span>
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={groupSize}
                onChange={(e) => setGroupSize(Number(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-white/80">
                <span>Time available</span>
                <span className="text-white/60">{timeLabel}</span>
              </span>
              <input
                type="range"
                min={30}
                max={240}
                step={15}
                value={timeMinutes}
                onChange={(e) => setTimeMinutes(Number(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-white/80">
                <span>Spice level</span>
                <SpiceBar level={spice} />
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={spice}
                onChange={(e) => setSpice(Number(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                <span>Chill</span>
                <span>Wild</span>
                <span>Unhinged</span>
              </div>
            </label>
          </div>

          <button
            onClick={generate}
            disabled={!canGenerate || rolling}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-400 px-5 py-3.5 text-base font-bold text-slate-950 shadow-lg shadow-fuchsia-500/20 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:text-lg"
          >
            {rolling
              ? nearbyStatus === "loading"
                ? "Finding nearby spots..."
                : "Rolling..."
              : quests
                ? "🎲 Reroll Quests"
                : "Generate Quests"}
          </button>
          {!canGenerate && (
            <p className="mt-2 text-center text-xs text-white/40">
              Add a city to begin your adventure.
            </p>
          )}
          {nearbyStatus === "fallback" && quests && (
            <p className="mt-2 text-center text-xs text-amber-300/70">
              Couldn&apos;t reach nearby venue data — using generic quests.
            </p>
          )}
        </section>

        {quests && (
          <section className="mt-8 space-y-4">
            {quests.map((q, i) => {
              const userRating = ratingByQuest[q.id];
              return (
                <article
                  key={q.id + i}
                  className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 transition hover:border-white/20 sm:p-6"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[q.category]}`}
                    >
                      {q.category}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
                      👥 {q.minGroup}-{q.maxGroup}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
                      ⏱ {q.minTime}-{q.maxTime} min
                    </span>
                    {q.cost && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
                        💵 {q.cost}
                      </span>
                    )}
                    {q.nearbyDetected && (
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">
                        📍 Nearby detected
                      </span>
                    )}
                    <div className="ml-auto">
                      <SpiceBar level={q.spice} />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold leading-snug sm:text-xl">
                    {i + 1}. {q.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-white/70 sm:text-base">
                    {q.description}
                  </p>

                  <div className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2">
                    {RATINGS.map((r) => {
                      const active = userRating === r.key;
                      return (
                        <button
                          key={r.key}
                          onClick={() => rateQuest(q, r.key)}
                          className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-xs font-semibold transition active:scale-95 sm:flex-row sm:justify-center sm:gap-1.5 sm:text-sm ${
                            active ? r.active : r.idle
                          }`}
                          aria-pressed={active}
                          aria-label={`Rate ${r.label}`}
                        >
                          <span className="text-base sm:text-sm">{r.icon}</span>
                          <span>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            <p className="pt-2 text-center text-xs text-white/40">
              Stay safe. Be kind. Take photos.
            </p>
          </section>
        )}

        <div className="mt-10 flex justify-center">
          <button
            onClick={() => setSuggestOpen(true)}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:border-fuchsia-400/50 hover:text-fuchsia-200"
          >
            💡 Suggest a Quest
          </button>
        </div>
      </div>

      {suggestOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => !suggestBusy && !suggestSent && setSuggestOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">💡 Suggest a Quest</h3>
              <button
                onClick={() => setSuggestOpen(false)}
                disabled={suggestBusy}
                className="text-white/50 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-white/50">
              Got an idea for a quest? Drop it here. The maintainers see all
              suggestions.
            </p>
            <textarea
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value.slice(0, 500))}
              placeholder="At a hardware store, see who can build the tallest free-standing tower out of $10 of supplies in 15 minutes..."
              rows={4}
              maxLength={500}
              disabled={suggestBusy || suggestSent}
              className="w-full rounded-lg border border-white/10 bg-black/50 p-3 text-sm outline-none focus:border-fuchsia-400/60 focus:ring-2 focus:ring-fuchsia-400/30 disabled:opacity-60"
            />
            <div className="mt-1 text-right text-[10px] text-white/40">
              {suggestText.length}/500
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-xs uppercase tracking-wider text-white/50">
                Your self-rating (optional)
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(["cooked", "mid", "tuff", "fire"] as const).map((r) => {
                  const active = suggestSelfRating === r;
                  const icon =
                    r === "cooked" ? "🗑️" : r === "mid" ? "😐" : r === "tuff" ? "💪" : "🔥";
                  return (
                    <button
                      key={r}
                      onClick={() =>
                        setSuggestSelfRating((cur) => (cur === r ? null : r))
                      }
                      disabled={suggestBusy || suggestSent}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition ${
                        active
                          ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100"
                          : "border-white/10 text-white/60 hover:border-fuchsia-400/40"
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
              disabled={
                !suggestText.trim() || suggestBusy || suggestSent
              }
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {suggestSent
                ? "✓ Thanks! Sent."
                : suggestBusy
                  ? "Sending..."
                  : "Submit Suggestion"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
