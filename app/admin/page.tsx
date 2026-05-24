"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RatingRecord, RATING_STORAGE_KEY } from "@/lib/ratings";
import {
  ADMIN_STATE_KEY,
  AdminState,
  EMPTY_ADMIN_STATE,
  SUGGEST_STORAGE_KEY,
  Suggestion,
} from "@/lib/suggestions";

// ---------- Storage helpers ----------

function loadJSON<T>(key: string, fallback: T, storage: Storage | null = null): T {
  if (typeof window === "undefined") return fallback;
  const s = storage ?? localStorage;
  try {
    const raw = s.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, val: unknown, storage: Storage | null = null) {
  if (typeof window === "undefined") return;
  const s = storage ?? localStorage;
  try {
    s.setItem(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

// ---------- Types & computations ----------

type QuestAgg = {
  questId: string;
  questName: string;
  category: string;
  cooked: number;
  mid: number;
  tuff: number;
  fire: number;
  total: number;
  net: number;
  avgSpice: number;
  avgGroup: number;
  avgTime: number;
};

function netScore(a: { cooked: number; mid: number; tuff: number; fire: number }) {
  return a.fire * 5 + a.tuff * 2 + a.mid * -1 + a.cooked * -10;
}

function aggregate(records: RatingRecord[]): QuestAgg[] {
  const m = new Map<string, QuestAgg>();
  for (const r of records) {
    let a = m.get(r.questId);
    if (!a) {
      a = {
        questId: r.questId,
        questName: r.questName,
        category: r.category,
        cooked: 0,
        mid: 0,
        tuff: 0,
        fire: 0,
        total: 0,
        net: 0,
        avgSpice: 0,
        avgGroup: 0,
        avgTime: 0,
      };
      m.set(r.questId, a);
    }
    a.questName = r.questName;
    a.category = r.category;
    a[r.rating]++;
    a.total++;
    a.avgSpice += r.spiceLevel;
    a.avgGroup += r.groupSize;
    a.avgTime += r.timeAvailable;
  }
  const out = Array.from(m.values()).map((a) => ({
    ...a,
    avgSpice: a.total ? a.avgSpice / a.total : 0,
    avgGroup: a.total ? a.avgGroup / a.total : 0,
    avgTime: a.total ? a.avgTime / a.total : 0,
    net: netScore(a),
  }));
  out.sort((a, b) => b.net - a.net);
  return out;
}

function categoryAverages(aggs: QuestAgg[]) {
  const m = new Map<string, { total: number; sum: number }>();
  for (const a of aggs) {
    const c = m.get(a.category) ?? { total: 0, sum: 0 };
    c.total++;
    c.sum += a.net;
    m.set(a.category, c);
  }
  return Array.from(m.entries())
    .map(([category, v]) => ({ category, avg: v.sum / v.total, count: v.total }))
    .sort((a, b) => b.avg - a.avg);
}

function spicePerformance(records: RatingRecord[]) {
  const m = new Map<number, { sum: number; n: number }>();
  for (const r of records) {
    const b = m.get(r.spiceLevel) ?? { sum: 0, n: 0 };
    b.n++;
    b.sum +=
      r.rating === "fire"
        ? 5
        : r.rating === "tuff"
          ? 2
          : r.rating === "mid"
            ? -1
            : -10;
    m.set(r.spiceLevel, b);
  }
  return Array.from(m.entries())
    .map(([spice, v]) => ({ spice, avg: v.sum / v.n, n: v.n }))
    .sort((a, b) => a.spice - b.spice);
}

function timePerformance(records: RatingRecord[]) {
  const buckets = [
    { label: "<60 min", min: 0, max: 59 },
    { label: "60-120 min", min: 60, max: 120 },
    { label: "120-180 min", min: 121, max: 180 },
    { label: ">180 min", min: 181, max: 9999 },
  ];
  return buckets.map((b) => {
    const inBucket = records.filter(
      (r) => r.timeAvailable >= b.min && r.timeAvailable <= b.max,
    );
    const sum = inBucket.reduce(
      (s, r) =>
        s +
        (r.rating === "fire"
          ? 5
          : r.rating === "tuff"
            ? 2
            : r.rating === "mid"
              ? -1
              : -10),
      0,
    );
    return {
      label: b.label,
      avg: inBucket.length ? sum / inBucket.length : 0,
      n: inBucket.length,
    };
  });
}

function inferPatterns(aggs: QuestAgg[], records: RatingRecord[]) {
  const fireQuests = aggs.filter((a) => a.fire >= 2 && a.net > 5);
  if (fireQuests.length === 0) {
    return ["No clear patterns yet — need more 🔥 ratings."];
  }
  const patterns: string[] = [];
  const catCounts = new Map<string, number>();
  for (const q of fireQuests) {
    catCounts.set(q.category, (catCounts.get(q.category) ?? 0) + q.fire);
  }
  const sortedCats = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedCats[0]) {
    patterns.push(
      `Users love: ${sortedCats[0][0]} quests (${sortedCats[0][1]} 🔥 votes across this category)`,
    );
  }
  // Group size sweet spot among fire ratings
  const fireRecords = records.filter((r) => r.rating === "fire");
  if (fireRecords.length >= 3) {
    const avgGroup =
      fireRecords.reduce((s, r) => s + r.groupSize, 0) / fireRecords.length;
    const avgSpice =
      fireRecords.reduce((s, r) => s + r.spiceLevel, 0) / fireRecords.length;
    patterns.push(
      `🔥 quests skew toward groups of ${avgGroup.toFixed(1)} at spice ${avgSpice.toFixed(1)}/10`,
    );
  }
  // Specific quest example
  if (fireQuests[0]) {
    patterns.push(
      `Standout: "${fireQuests[0].questName}" (net ${fireQuests[0].net}, ${fireQuests[0].fire}🔥)`,
    );
  }
  return patterns;
}

type ProposedAdjustment = {
  questId: string;
  questName: string;
  net: number;
  action: "SUPPRESS" | "BOOST";
};

function proposedAdjustments(aggs: QuestAgg[]): ProposedAdjustment[] {
  const out: ProposedAdjustment[] = [];
  for (const a of aggs) {
    if (a.net < -5) {
      out.push({ questId: a.questId, questName: a.questName, net: a.net, action: "SUPPRESS" });
    } else if (a.net > 8) {
      out.push({ questId: a.questId, questName: a.questName, net: a.net, action: "BOOST" });
    }
  }
  return out;
}

// ---------- Components ----------

function Distribution({ a }: { a: QuestAgg }) {
  const max = Math.max(a.cooked, a.mid, a.tuff, a.fire, 1);
  const cell = (label: string, count: number, color: string) => (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-12 w-6 items-end overflow-hidden rounded-sm bg-white/5">
        <div
          className={color}
          style={{ height: `${(count / max) * 100}%`, width: "100%" }}
        />
      </div>
      <span className="text-[10px] text-white/60">{label}</span>
      <span className="text-xs font-semibold text-white/90">{count}</span>
    </div>
  );
  return (
    <div className="flex items-end gap-2">
      {cell("🗑️", a.cooked, "bg-zinc-400")}
      {cell("😐", a.mid, "bg-yellow-400")}
      {cell("💪", a.tuff, "bg-blue-400")}
      {cell("🔥", a.fire, "bg-orange-400")}
    </div>
  );
}

function Trend({ net }: { net: number }) {
  if (net > 0) return <span className="text-emerald-400">↑</span>;
  if (net < 0) return <span className="text-red-400">↓</span>;
  return <span className="text-white/50">→</span>;
}

// ---------- Page ----------

export default function AdminPage() {
  const router = useRouter();

  const [records, setRecords] = useState<RatingRecord[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [adminState, setAdminState] = useState<AdminState>(EMPTY_ADMIN_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [commitText, setCommitText] = useState("");
  const [copyOk, setCopyOk] = useState(false);

  useEffect(() => {
    setRecords(loadJSON<RatingRecord[]>(RATING_STORAGE_KEY, []));
    setSuggestions(loadJSON<Suggestion[]>(SUGGEST_STORAGE_KEY, []));
    setAdminState(loadJSON<AdminState>(ADMIN_STATE_KEY, EMPTY_ADMIN_STATE));
  }, []);

  // ----- derived -----
  const aggs = useMemo(() => aggregate(records), [records]);
  const catAvgs = useMemo(() => categoryAverages(aggs), [aggs]);
  const spicePerf = useMemo(() => spicePerformance(records), [records]);
  const timePerf = useMemo(() => timePerformance(records), [records]);
  const patterns = useMemo(() => inferPatterns(aggs, records), [aggs, records]);
  const proposals = useMemo(() => proposedAdjustments(aggs), [aggs]);

  const approvedProposals = proposals.filter(
    (p) => adminState.adjustmentActions[p.questId] === "approved",
  );
  const approvedSuggestions = suggestions.filter(
    (s) => adminState.suggestionActions[s.id] === "approved",
  );
  const pendingSuggestions = suggestions.filter(
    (s) => !adminState.suggestionActions[s.id],
  );

  // Auto-update the commit JSON editor when approvals change
  useEffect(() => {
    const payload = {
      generatedAt: new Date().toISOString(),
      approvedScoreAdjustments: approvedProposals.map((p) => ({
        questId: p.questId,
        questName: p.questName,
        action: p.action,
        netScore: p.net,
      })),
      approvedSuggestions: approvedSuggestions.map((s) => ({
        id: s.id,
        text: adminState.suggestionEdits[s.id] ?? s.text,
        selfRating: s.selfRating,
        timestamp: s.timestamp,
      })),
    };
    setCommitText(JSON.stringify(payload, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adminState.adjustmentActions,
    adminState.suggestionActions,
    adminState.suggestionEdits,
    records,
    suggestions,
  ]);

  const logout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }
    router.replace("/admin/login");
    router.refresh();
  };

  // ----- admin state mutators -----
  const setProposalAction = (
    questId: string,
    action: "approved" | "rejected" | null,
  ) => {
    setAdminState((prev) => {
      const next = {
        ...prev,
        adjustmentActions: { ...prev.adjustmentActions },
      };
      if (action === null) delete next.adjustmentActions[questId];
      else next.adjustmentActions[questId] = action;
      saveJSON(ADMIN_STATE_KEY, next);
      return next;
    });
  };

  const setSuggestionAction = (
    id: string,
    action: "approved" | "rejected" | null,
  ) => {
    setAdminState((prev) => {
      const next = {
        ...prev,
        suggestionActions: { ...prev.suggestionActions },
      };
      if (action === null) delete next.suggestionActions[id];
      else next.suggestionActions[id] = action;
      saveJSON(ADMIN_STATE_KEY, next);
      return next;
    });
  };

  const commitEdit = (id: string, text: string) => {
    setAdminState((prev) => {
      const next = {
        ...prev,
        suggestionEdits: { ...prev.suggestionEdits, [id]: text },
      };
      saveJSON(ADMIN_STATE_KEY, next);
      return next;
    });
    setEditingId(null);
  };

  // ----- export -----
  const copyCommit = async () => {
    try {
      await navigator.clipboard.writeText(commitText);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch {
      // ignore
    }
  };

  const downloadTrainingData = () => {
    const lines: string[] = [];
    for (const r of records) {
      lines.push(
        JSON.stringify({
          type: "rating",
          input: {
            quest: r.questName,
            category: r.category,
            spice: r.spiceLevel,
            groupSize: r.groupSize,
            timeMinutes: r.timeAvailable,
          },
          output: r.rating,
          timestamp: r.timestamp,
        }),
      );
    }
    for (const s of suggestions) {
      lines.push(
        JSON.stringify({
          type: "suggestion",
          input: { text: adminState.suggestionEdits[s.id] ?? s.text },
          output: s.selfRating,
          status: adminState.suggestionActions[s.id] ?? "pending",
          timestamp: s.timestamp,
        }),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sidequest-training-${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Render ----------

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-amber-500/20 pb-5">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-amber-400">
              Model Training
            </div>
            <h1 className="mt-1 text-3xl font-black sm:text-4xl">
              Admin <span className="text-amber-400">Dashboard</span>
            </h1>
            <p className="mt-1 text-sm text-white/50">
              {records.length} ratings · {suggestions.length} suggestions
            </p>
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:border-amber-400/40 hover:text-amber-300"
          >
            Lock console
          </button>
        </header>

        {/* ---------- Section 1: Rating Intelligence Feed ---------- */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-amber-400">
            1. Rating Intelligence Feed
          </h2>
          {aggs.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
              No ratings yet. Go rate some quests on the main page, then return
              here.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {aggs.map((a) => {
                const border =
                  a.net > 5
                    ? "border-emerald-400/50"
                    : a.net < -3
                      ? "border-red-400/50"
                      : "border-white/10";
                return (
                  <article
                    key={a.questId}
                    className={`rounded-xl border ${border} bg-white/[0.04] p-4`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-bold">
                          {a.questName}
                        </h3>
                        <div className="mt-0.5 text-xs text-white/50">
                          {a.category} · {a.total} rating{a.total === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-white/40">
                          Net
                        </div>
                        <div className="text-xl font-black">
                          {a.net > 0 ? "+" : ""}
                          {a.net} <Trend net={a.net} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-end justify-between">
                      <Distribution a={a} />
                      <div className="text-right text-[11px] text-white/40">
                        <div>spice {a.avgSpice.toFixed(1)}</div>
                        <div>group {a.avgGroup.toFixed(1)}</div>
                        <div>{Math.round(a.avgTime)}m</div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- Section 2: What the Model Is Learning ---------- */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-amber-400">
            2. What the Model Is Learning
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-300">
                🔥 Top Categories
              </h3>
              {catAvgs.slice(0, 3).map((c) => (
                <div key={c.category} className="flex justify-between py-1 text-sm">
                  <span>{c.category}</span>
                  <span className="font-mono text-emerald-300">
                    avg {c.avg.toFixed(1)} (n={c.count})
                  </span>
                </div>
              ))}
              {catAvgs.length === 0 && (
                <div className="text-xs text-white/40">No data.</div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-red-300">
                🗑️ Bottom Categories
              </h3>
              {[...catAvgs]
                .reverse()
                .slice(0, 3)
                .map((c) => (
                  <div
                    key={c.category}
                    className="flex justify-between py-1 text-sm"
                  >
                    <span>{c.category}</span>
                    <span className="font-mono text-red-300">
                      avg {c.avg.toFixed(1)} (n={c.count})
                    </span>
                  </div>
                ))}
              {catAvgs.length === 0 && (
                <div className="text-xs text-white/40">No data.</div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-amber-300">
                Spice Level Performance
              </h3>
              <div className="space-y-1">
                {spicePerf.length === 0 && (
                  <div className="text-xs text-white/40">No data.</div>
                )}
                {spicePerf.map((s) => (
                  <div key={s.spice} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-white/60">{s.spice}/10</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/5">
                      <div
                        className={s.avg >= 0 ? "bg-emerald-400" : "bg-red-400"}
                        style={{
                          height: "100%",
                          width: `${Math.min(100, Math.abs(s.avg) * 12)}%`,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-white/70">
                      {s.avg.toFixed(1)}
                    </span>
                    <span className="w-10 text-right text-white/40">n={s.n}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-amber-300">
                Time Available Performance
              </h3>
              <div className="space-y-1">
                {timePerf.map((t) => (
                  <div key={t.label} className="flex items-center gap-2 text-xs">
                    <span className="w-24 text-white/60">{t.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/5">
                      <div
                        className={t.avg >= 0 ? "bg-emerald-400" : "bg-red-400"}
                        style={{
                          height: "100%",
                          width: `${Math.min(100, Math.abs(t.avg) * 12)}%`,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-white/70">
                      {t.avg.toFixed(1)}
                    </span>
                    <span className="w-10 text-right text-white/40">n={t.n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Proposed Score Adjustments */}
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-300">
              Proposed Score Adjustments
            </h3>
            {proposals.length === 0 ? (
              <div className="text-xs text-white/40">
                No proposals — no quests yet exceed adjustment thresholds (&lt;-5 or &gt;+8).
              </div>
            ) : (
              <div className="space-y-2">
                {proposals.map((p) => {
                  const action = adminState.adjustmentActions[p.questId];
                  return (
                    <div
                      key={p.questId}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-3"
                    >
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-black ${
                          p.action === "SUPPRESS"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {p.action}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {p.questName}
                      </span>
                      <span className="font-mono text-xs text-white/50">
                        net {p.net > 0 ? "+" : ""}
                        {p.net}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() =>
                            setProposalAction(
                              p.questId,
                              action === "approved" ? null : "approved",
                            )
                          }
                          className={`rounded px-2 py-1 text-xs font-semibold ${
                            action === "approved"
                              ? "bg-emerald-500 text-black"
                              : "border border-white/10 text-white/70 hover:border-emerald-400/50"
                          }`}
                        >
                          ✅ Approve
                        </button>
                        <button
                          onClick={() => alert("Inline editing N/A for adjustments — adjust thresholds in code if needed.")}
                          className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-amber-400/50"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() =>
                            setProposalAction(
                              p.questId,
                              action === "rejected" ? null : "rejected",
                            )
                          }
                          className={`rounded px-2 py-1 text-xs font-semibold ${
                            action === "rejected"
                              ? "bg-red-500 text-white"
                              : "border border-white/10 text-white/70 hover:border-red-400/50"
                          }`}
                        >
                          ❌ Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Proposed New Patterns */}
          <div className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-5">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-purple-300">
              Proposed New Patterns
            </h3>
            <ul className="space-y-1.5 text-sm text-white/80">
              {patterns.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-purple-400">→</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Section 3: Suggestions Inbox ---------- */}
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-amber-400">
              3. Suggestions Inbox
            </h2>
            <div className="text-xs text-white/60">
              <span className="text-emerald-300">
                {approvedSuggestions.length} approved
              </span>
              {" · "}
              <span className="text-amber-300">
                {pendingSuggestions.length} pending
              </span>
            </div>
          </div>
          {suggestions.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
              No suggestions yet. Users can submit them from the main page.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {suggestions.map((s) => {
                const action = adminState.suggestionActions[s.id];
                const displayText = adminState.suggestionEdits[s.id] ?? s.text;
                const isEditing = editingId === s.id;
                const ringColor =
                  action === "approved"
                    ? "border-emerald-400/50"
                    : action === "rejected"
                      ? "border-red-400/40"
                      : "border-white/10";
                return (
                  <article
                    key={s.id}
                    className={`rounded-xl border ${ringColor} bg-white/[0.04] p-4`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      {s.selfRating && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                          {s.selfRating}
                        </span>
                      )}
                      <span className="text-[10px] text-white/40">
                        {new Date(s.timestamp).toLocaleString()}
                      </span>
                      {action && (
                        <span
                          className={`ml-auto rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            action === "approved"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {action}
                        </span>
                      )}
                    </div>
                    {isEditing ? (
                      <textarea
                        value={editText}
                        maxLength={500}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full rounded-lg border border-amber-400/50 bg-black/50 p-2 text-sm outline-none focus:border-amber-400"
                        rows={3}
                      />
                    ) : (
                      <p className="text-sm text-white/85">{displayText}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => commitEdit(s.id, editText.trim() || s.text)}
                            className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-black hover:bg-amber-400"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded border border-white/10 px-2 py-1 text-xs text-white/70"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              setSuggestionAction(
                                s.id,
                                action === "approved" ? null : "approved",
                              )
                            }
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              action === "approved"
                                ? "bg-emerald-500 text-black"
                                : "border border-white/10 text-white/70 hover:border-emerald-400/50"
                            }`}
                          >
                            ✅ Add to Quest DB
                          </button>
                          <button
                            onClick={() =>
                              setSuggestionAction(
                                s.id,
                                action === "rejected" ? null : "rejected",
                              )
                            }
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              action === "rejected"
                                ? "bg-red-500 text-white"
                                : "border border-white/10 text-white/70 hover:border-red-400/50"
                            }`}
                          >
                            ❌ Reject
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(s.id);
                              setEditText(displayText);
                            }}
                            className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-amber-400/50"
                          >
                            ✏️ Edit
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- Section 4: Commit Panel ---------- */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-amber-400">
            4. 🚀 Commit to Model
          </h2>
          <div className="rounded-xl border border-amber-500/30 bg-black/40 p-5">
            <div className="mb-3 rounded-lg border-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-center text-sm font-black uppercase tracking-wider text-red-300">
              ⚠️ DO NOT AUTO-COMMIT — Export only
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/50">
                  Approved Adjustments
                </div>
                <div className="text-2xl font-black text-emerald-300">
                  {approvedProposals.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/50">
                  Approved Suggestions
                </div>
                <div className="text-2xl font-black text-emerald-300">
                  {approvedSuggestions.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/50">
                  Training Records
                </div>
                <div className="text-2xl font-black text-amber-300">
                  {records.length + suggestions.length}
                </div>
              </div>
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                Proposed Commit (editable JSON)
              </span>
              <textarea
                value={commitText}
                onChange={(e) => setCommitText(e.target.value)}
                rows={14}
                className="w-full rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-xs outline-none focus:border-amber-400"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={copyCommit}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-black transition hover:bg-amber-400"
              >
                {copyOk ? "✓ Copied" : "📋 Copy as JSON"}
              </button>
              <button
                onClick={downloadTrainingData}
                className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-300 transition hover:bg-amber-500/20"
              >
                ⬇️ Download Training Data (.jsonl)
              </button>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-4 text-center text-[11px] text-white/30">
          Read-only training console · all writes are local-only or export-only
        </footer>
      </div>
    </main>
  );
}
