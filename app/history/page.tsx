"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Clock,
  Flame,
  ForkKnife,
  List as ListIcon,
  MapTrifold,
  Hand,
  Lightning,
  MapPinSimpleArea,
  Minus,
  Moon,
  PaintBrush,
  Snowflake,
  Sparkle,
  Tree,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import { formatDistanceToNow } from "date-fns";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  computeElapsedMs,
  formatElapsed,
} from "@/lib/quest-lifecycle";
import { getSignedMediaUrls } from "@/lib/upload";
import type {
  Quest,
  QuestEvent,
  QuestMedia,
  QuestReaction,
} from "@/lib/database.types";
import Lightbox, { type LightboxItem } from "@/components/Lightbox";
import StatsStrip from "@/components/StatsStrip";
import HistoryMap from "@/components/HistoryMap";
import { useStats } from "@/lib/stats-context";
import {
  useQuestUploadJob,
  useUploadQueue,
} from "@/components/UploadQueueProvider";

const CATEGORY_ICONS: Record<string, Icon> = {
  Social: UsersThree,
  Outdoor: Tree,
  Chaos: Lightning,
  Creative: PaintBrush,
  Food: ForkKnife,
  "Late Night": Moon,
};

const REACTION_ICONS: Record<QuestReaction, Icon> = {
  cooked: Snowflake,
  mid: Minus,
  tuff: Hand,
  fire: Flame,
};

type Row = {
  quest: Quest;
  events: QuestEvent[];
  completedAt: string;
  media: QuestMedia[];
};

const MAX_VISIBLE_THUMBS = 3;

type ViewMode = "list" | "map";

export default function HistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { version } = useUploadQueue();
  const { quests: statsQuests } = useStats();
  const view: ViewMode = searchParams?.get("view") === "map" ? "map" : "list";
  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "map") params.set("view", "map");
    else params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/history?${qs}` : "/history", { scroll: false });
  };
  const filter = searchParams?.get("filter") ?? null;
  const savedView = filter === "saved";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [lightboxQuest, setLightboxQuest] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [savedBookmarks, setSavedBookmarks] = useState<
    { id: string; title: string; category: string; description: string }[]
  >([]);

  useEffect(() => {
    if (!savedView) return;
    try {
      const raw = localStorage.getItem("sqBookmarks");
      if (!raw) {
        setSavedBookmarks([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setSavedBookmarks(parsed);
    } catch {
      // ignore
    }
  }, [savedView]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data: completedEvents } = await supabase
        .from("quest_events")
        .select("*")
        .eq("user_id", user.id)
        .eq("event_type", "completed")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!completedEvents || completedEvents.length === 0) {
        if (!cancelled) {
          setRows([]);
          setSignedUrls({});
        }
        return;
      }

      const questIds = Array.from(
        new Set(completedEvents.map((e) => e.quest_id)),
      );

      const [
        { data: quests },
        { data: allEvents },
        { data: media },
      ] = await Promise.all([
        supabase.from("quests").select("*").in("id", questIds),
        supabase
          .from("quest_events")
          .select("*")
          .in("quest_id", questIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("quest_media")
          .select("*")
          .in("quest_id", questIds)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;

      const eventsByQuest = new Map<string, QuestEvent[]>();
      for (const e of allEvents ?? []) {
        const arr = eventsByQuest.get(e.quest_id);
        if (arr) arr.push(e);
        else eventsByQuest.set(e.quest_id, [e]);
      }

      const mediaByQuest = new Map<string, QuestMedia[]>();
      for (const m of media ?? []) {
        const arr = mediaByQuest.get(m.quest_id);
        if (arr) arr.push(m);
        else mediaByQuest.set(m.quest_id, [m]);
      }

      const questById = new Map((quests ?? []).map((q) => [q.id, q]));
      const seen = new Set<string>();
      const built: Row[] = [];
      for (const ev of completedEvents) {
        if (seen.has(ev.quest_id)) continue;
        seen.add(ev.quest_id);
        const q = questById.get(ev.quest_id);
        if (!q) continue;
        built.push({
          quest: q,
          events: eventsByQuest.get(q.id) ?? [],
          completedAt: ev.created_at,
          media: mediaByQuest.get(q.id) ?? [],
        });
      }

      setRows(built);

      // Sign every media URL in one batch (60 minutes is fine for a list page).
      const allMedia = built.flatMap((r) => r.media);
      const urls = await getSignedMediaUrls(allMedia);
      if (!cancelled) setSignedUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user, version, statsQuests]);

  const lightboxItems = useMemo<LightboxItem[]>(() => {
    if (!lightboxQuest || !rows) return [];
    const row = rows.find((r) => r.quest.id === lightboxQuest);
    if (!row) return [];
    return row.media
      .map((m): LightboxItem | null => {
        const url = signedUrls[m.id];
        if (!url) return null;
        return {
          id: m.id,
          url,
          kind: m.mime_type.startsWith("video/") ? "video" : "image",
        };
      })
      .filter((x): x is LightboxItem => x !== null);
  }, [lightboxQuest, rows, signedUrls]);

  if (!user || rows === null) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-7) var(--space-4) var(--space-9)",
        }}
      >
        <h1 className="ds-page-title">History</h1>
        <StatsStrip />
      </main>
    );
  }

  if (savedView) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-7) var(--space-4) var(--space-9)",
        }}
      >
        <Link
          href="/history"
          className="ds-secondary-pill"
          style={{ marginBottom: "var(--space-5)" }}
        >
          <ArrowRight
            weight="duotone"
            size={14}
            aria-hidden="true"
            style={{ transform: "scaleX(-1)" }}
          />
          <span>All history</span>
        </Link>
        <h1 className="ds-page-title">Saved</h1>

        {savedBookmarks.length === 0 ? (
          <div className="glass ds-empty-state">
            <p
              className="ds-empty-state-text"
              style={{
                fontFamily: "var(--font-display, serif)",
                fontSize: "clamp(24px, 6vw, 32px)",
                color: "var(--text-primary)",
                lineHeight: 1.1,
              }}
            >
              Nothing saved yet.
            </p>
            <p className="ds-empty-state-text">
              Tap the bookmark on any quest card to save it for later.
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col"
            style={{ gap: "var(--space-3)" }}
          >
            {savedBookmarks.map((b) => (
              <div key={b.id} className="glass ds-history-row">
                <span
                  className="ds-cat-chip"
                  style={{ alignSelf: "flex-start" }}
                >
                  {b.category}
                </span>
                <h3 className="ds-history-row-title">{b.title}</h3>
                <p
                  className="ds-card-desc"
                  style={{ marginTop: 0 }}
                >
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "var(--space-7) var(--space-4) var(--space-9)",
      }}
    >
      <h1 className="ds-page-title">History</h1>
      <StatsStrip />

      <div
        className="ds-view-toggle"
        role="tablist"
        aria-label="History view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          onClick={() => setView("list")}
          className="ds-view-toggle-btn"
          data-active={view === "list" ? "true" : "false"}
        >
          <ListIcon
            weight={view === "list" ? "fill" : "duotone"}
            size={16}
            aria-hidden="true"
          />
          <span>List</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "map"}
          onClick={() => setView("map")}
          className="ds-view-toggle-btn"
          data-active={view === "map" ? "true" : "false"}
          data-accent={view === "map" ? "true" : "false"}
        >
          <MapTrifold
            weight={view === "map" ? "fill" : "duotone"}
            size={16}
            aria-hidden="true"
          />
          <span>Map</span>
        </button>
      </div>

      {/* HistoryMap stays mounted across List/Map toggles so Mapbox doesn't
        * re-initialize on every flip. Hidden via the `hidden` attribute when
        * the user is in List mode. */}
      <div style={{ marginTop: "var(--space-5)" }}>
        <HistoryMap visible={view === "map"} />
      </div>

      {view === "list" &&
        (rows.length === 0 ? (
          <div
            className="glass ds-empty-state"
            style={{ marginTop: "var(--space-5)" }}
          >
            <MapPinSimpleArea
              weight="duotone"
              size={36}
              className="ds-empty-state-icon"
              aria-hidden="true"
            />
            <p
              className="ds-empty-state-text"
              style={{
                fontFamily: "var(--font-display, serif)",
                fontSize: "clamp(28px, 6vw, 36px)",
                lineHeight: 1.1,
                color: "var(--text-primary)",
              }}
            >
              Your first quest awaits.
            </p>
            <Link
              href="/"
              className="ds-suggest-pill"
              style={{ marginTop: "var(--space-3)" }}
            >
              <ArrowRight weight="duotone" size={14} aria-hidden="true" />
              <span>Generate quests</span>
            </Link>
          </div>
        ) : (
          <div
            className="flex flex-col"
            style={{ gap: "var(--space-3)", marginTop: "var(--space-5)" }}
          >
            {rows.map((row, idx) => (
              <HistoryRow
                key={row.quest.id}
                row={row}
                signedUrls={signedUrls}
                priority={idx < 2}
                onOpenLightbox={(thumbIdx) => {
                  setLightboxQuest(row.quest.id);
                  setLightboxIndex(thumbIdx);
                }}
              />
            ))}
          </div>
        ))}

      {lightboxQuest && lightboxItems.length > 0 && (
        <Lightbox
          items={lightboxItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxQuest(null)}
        />
      )}
    </main>
  );
}

const HistoryRow = memo(function HistoryRow({
  row,
  signedUrls,
  onOpenLightbox,
  priority = false,
}: {
  row: Row;
  signedUrls: Record<string, string>;
  onOpenLightbox: (index: number) => void;
  /** First two rows render eagerly with normal fetch priority; rows below
   * the fold load lazily with low priority. */
  priority?: boolean;
}) {
  const { retry } = useUploadQueue();
  const job = useQuestUploadJob(row.quest.id);
  const CategoryIcon = CATEGORY_ICONS[row.quest.category] ?? Sparkle;
  const totalMs = computeElapsedMs(row.events, row.completedAt);
  const ReactionIcon = row.quest.reaction
    ? REACTION_ICONS[row.quest.reaction]
    : null;

  const visible = row.media.slice(0, MAX_VISIBLE_THUMBS);
  const extra = row.media.length - visible.length;

  const pending =
    job && job.status === "uploading"
      ? job.total - job.completed
      : 0;
  const failed = job && job.status === "failed" ? job.failedFiles.length : 0;

  return (
    <div className="glass ds-history-row">
      <Link
        href={`/quest/${row.quest.id}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <span className="ds-cat-chip" style={{ alignSelf: "flex-start" }}>
          <span className="ds-cat-chip-icon" aria-hidden="true">
            <CategoryIcon weight="duotone" size={12} />
          </span>
          {row.quest.category}
        </span>
        <h3 className="ds-history-row-title">{row.quest.title}</h3>
        <div className="ds-history-row-meta">
          <span className="ds-meta-item">
            <Clock weight="duotone" size={14} aria-hidden="true" />
            {formatElapsed(totalMs)}
          </span>
          <span>
            completed{" "}
            {formatDistanceToNow(new Date(row.completedAt), {
              addSuffix: true,
            })}
          </span>
          {ReactionIcon && row.quest.reaction && (
            <ReactionIcon
              weight="fill"
              size={14}
              color="var(--text-secondary)"
              aria-label={`Rated ${row.quest.reaction}`}
            />
          )}
          {row.quest.location_text &&
            (row.quest.lat == null || row.quest.lng == null) && (
              <span className="ds-pin-pending" aria-label="Pin pending">
                Pin pending
              </span>
            )}
        </div>
      </Link>

      {visible.length > 0 && (
        <div className="ds-history-thumbs" role="group" aria-label="Media">
          {visible.map((m, i) => {
            const url = signedUrls[m.id];
            const isVideo = m.mime_type.startsWith("video/");
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenLightbox(i)}
                className="ds-history-thumb"
                aria-label={
                  isVideo ? "Open video" : "Open photo"
                }
              >
                {url ? (
                  isVideo ? (
                    <>
                      <video
                        src={url}
                        className="ds-history-thumb-media"
                        muted
                        playsInline
                        preload={priority ? "metadata" : "none"}
                      />
                      <span
                        className="ds-history-thumb-video-glyph"
                        aria-hidden="true"
                      >
                        <VideoCamera weight="duotone" size={12} />
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      className="ds-history-thumb-media"
                      loading={priority ? "eager" : "lazy"}
                      // @ts-expect-error — fetchpriority isn't in lib.dom yet.
                      fetchpriority={priority ? "high" : "low"}
                      decoding="async"
                    />
                  )
                ) : null}
              </button>
            );
          })}
          {extra > 0 && (
            <button
              type="button"
              onClick={() => onOpenLightbox(MAX_VISIBLE_THUMBS)}
              className="ds-history-thumb ds-history-thumb-more"
              aria-label={`Open ${extra} more`}
            >
              +{extra}
            </button>
          )}
        </div>
      )}

      {pending > 0 && (
        <span className="ds-pending-pill" data-variant="pending">
          <span
            className="ds-queue-indicator-dot"
            aria-hidden="true"
          />
          {pending} {pending === 1 ? "upload" : "uploads"} in progress
        </span>
      )}
      {failed > 0 && job && (
        <button
          type="button"
          className="ds-pending-pill"
          data-variant="failed"
          onClick={() => retry(job.id)}
        >
          {failed} upload{failed === 1 ? "" : "s"} failed · retry
        </button>
      )}
    </div>
  );
});
