"use client";

import { useMemo, useState } from "react";
import { generateQuests, GeneratedQuest } from "@/lib/generate";
import { QuestCategory } from "@/lib/quests";

const CATEGORY_STYLES: Record<QuestCategory, string> = {
  Chaos: "bg-red-500/15 text-red-300 border-red-500/30",
  Outdoor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Social: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Creative: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Food: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Late Night": "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
};

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

export default function Home() {
  const [city, setCity] = useState("");
  const [groupSize, setGroupSize] = useState(3);
  const [timeMinutes, setTimeMinutes] = useState(90);
  const [spice, setSpice] = useState(5);
  const [quests, setQuests] = useState<GeneratedQuest[] | null>(null);
  const [rolling, setRolling] = useState(false);

  const canGenerate = city.trim().length > 0;

  const generate = () => {
    if (!canGenerate) return;
    setRolling(true);
    // small delay so the reroll feels alive
    setTimeout(() => {
      const count = 3 + Math.floor(Math.random() * 3); // 3-5
      setQuests(generateQuests({ city, groupSize, timeMinutes, spice }, count));
      setRolling(false);
    }, 250);
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
            {quests ? (rolling ? "Rolling..." : "🎲 Reroll Quests") : rolling ? "Rolling..." : "Generate Quests"}
          </button>
          {!canGenerate && (
            <p className="mt-2 text-center text-xs text-white/40">
              Add a city to begin your adventure.
            </p>
          )}
        </section>

        {quests && (
          <section className="mt-8 space-y-4">
            {quests.map((q, i) => (
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
              </article>
            ))}
            <p className="pt-2 text-center text-xs text-white/40">
              Stay safe. Be kind. Take photos.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
