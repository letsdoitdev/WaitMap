"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  Flame,
  ForkKnife,
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

export default function HistoryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { version } = useUploadQueue();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [lightboxQuest, setLightboxQuest] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

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
  }, [supabase, user, version]);

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
      </main>
    );
  }

  if (rows.length === 0) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-7) var(--space-4) var(--space-9)",
        }}
      >
        <h1 className="ds-page-title">History</h1>
        <div className="glass ds-empty-state">
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
      <div
        className="flex flex-col"
        style={{ gap: "var(--space-3)" }}
      >
        {rows.map((row) => (
          <HistoryRow
            key={row.quest.id}
            row={row}
            signedUrls={signedUrls}
            onOpenLightbox={(idx) => {
              setLightboxQuest(row.quest.id);
              setLightboxIndex(idx);
            }}
          />
        ))}
      </div>

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

function HistoryRow({
  row,
  signedUrls,
  onOpenLightbox,
}: {
  row: Row;
  signedUrls: Record<string, string>;
  onOpenLightbox: (index: number) => void;
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
}
