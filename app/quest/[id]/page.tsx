"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Flame,
  ForkKnife,
  Hand,
  Lightning,
  MapPin,
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
  getQuestState,
} from "@/lib/quest-lifecycle";
import { getSignedMediaUrls } from "@/lib/upload";
import type {
  Quest,
  QuestEvent,
  QuestMedia,
  QuestReaction,
} from "@/lib/database.types";
import Lightbox, { type LightboxItem } from "@/components/Lightbox";

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

const REACTION_LABELS: Record<QuestReaction, string> = {
  cooked: "Cooked",
  mid: "Mid",
  tuff: "Tuff",
  fire: "Fire",
};

export default function QuestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [quest, setQuest] = useState<Quest | null>(null);
  const [events, setEvents] = useState<QuestEvent[]>([]);
  const [media, setMedia] = useState<QuestMedia[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user || !params?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: q }, { data: ev }, { data: m }] = await Promise.all([
        supabase.from("quests").select("*").eq("id", params.id).maybeSingle(),
        supabase
          .from("quest_events")
          .select("*")
          .eq("quest_id", params.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("quest_media")
          .select("*")
          .eq("quest_id", params.id)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setQuest(q ?? null);
      setEvents(ev ?? []);
      setMedia(m ?? []);
      if ((m ?? []).length > 0) {
        const urls = await getSignedMediaUrls(m!);
        if (!cancelled) setSignedUrls(urls);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.id, supabase, user]);

  const state = getQuestState(events);
  const completedEvent = [...events]
    .reverse()
    .find((e) => e.event_type === "completed");

  const referenceIso = completedEvent
    ? completedEvent.created_at
    : new Date(Date.now()).toISOString();
  const totalMs = computeElapsedMs(events, referenceIso);

  if (loading) {
    return (
      <main
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "var(--space-7) var(--space-4)",
        }}
      >
        <p
          style={{
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-body, inherit)",
            fontSize: 14,
          }}
        >
          Loading…
        </p>
      </main>
    );
  }

  if (!quest) {
    return (
      <main
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "var(--space-7) var(--space-4)",
        }}
      >
        <p className="ds-empty-state-text">Quest not found.</p>
      </main>
    );
  }

  const CategoryIcon = CATEGORY_ICONS[quest.category] ?? Sparkle;
  const spicePct = Math.max(0, Math.min(100, (quest.spice / 10) * 100));
  const ReactionIcon = quest.reaction ? REACTION_ICONS[quest.reaction] : null;

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "var(--space-6) var(--space-4) var(--space-7)",
      }}
    >
      <Link
        href="/history"
        className="ds-secondary-pill"
        style={{ marginBottom: "var(--space-5)" }}
      >
        <ArrowLeft weight="duotone" size={16} aria-hidden="true" />
        <span>Back to history</span>
      </Link>

      <div className="glass" style={{ padding: "var(--space-6)" }}>
        <span className="ds-cat-chip">
          <span className="ds-cat-chip-icon" aria-hidden="true">
            <CategoryIcon weight="duotone" size={12} />
          </span>
          {quest.category}
        </span>
        <h1
          className="ds-active-title"
          style={{ marginTop: "var(--space-3)" }}
        >
          {quest.title}
        </h1>

        <div className="ds-spice" style={{ marginTop: "var(--space-4)" }}>
          <div className="ds-spice-track" role="img" aria-label={`Spice ${quest.spice} of 10`}>
            <div className="ds-spice-fill" style={{ width: `${spicePct}%` }} />
          </div>
          <span className="ds-spice-label">Spice · {quest.spice}/10</span>
        </div>

        <p
          style={{
            fontFamily: "var(--font-body, inherit)",
            fontSize: 16,
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            margin: "var(--space-5) 0 0",
          }}
        >
          {quest.description}
        </p>

        <div className="ds-meta-row">
          <span className="ds-meta-item">
            <Clock weight="duotone" size={14} aria-hidden="true" />
            {formatElapsed(totalMs)}
          </span>
          {quest.location_text && (
            <span className="ds-meta-item">
              <MapPin weight="duotone" size={14} aria-hidden="true" />
              {quest.location_text}
            </span>
          )}
          {completedEvent && (
            <span className="ds-meta-item">
              {state === "completed" ? "Completed" : "Last event"}{" "}
              {formatDistanceToNow(new Date(completedEvent.created_at), {
                addSuffix: true,
              })}
            </span>
          )}
          {ReactionIcon && quest.reaction && (
            <span className="ds-meta-item">
              <ReactionIcon weight="fill" size={14} aria-hidden="true" />
              {REACTION_LABELS[quest.reaction]}
            </span>
          )}
        </div>

        {media.length > 0 && (
          <div
            className="ds-history-thumbs"
            style={{ marginTop: "var(--space-5)", flexWrap: "wrap" }}
            role="group"
            aria-label="Quest media"
          >
            {media.map((m, i) => {
              const url = signedUrls[m.id];
              const isVideo = m.mime_type.startsWith("video/");
              return (
                <button
                  key={m.id}
                  type="button"
                  className="ds-history-thumb"
                  onClick={() => setLightboxIndex(i)}
                  aria-label={isVideo ? "Open video" : "Open photo"}
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
          </div>
        )}
      </div>

      {lightboxIndex !== null && media.length > 0 && (
        <Lightbox
          items={media
            .map((m): LightboxItem | null => {
              const url = signedUrls[m.id];
              if (!url) return null;
              return {
                id: m.id,
                url,
                kind: m.mime_type.startsWith("video/") ? "video" : "image",
              };
            })
            .filter((x): x is LightboxItem => x !== null)}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </main>
  );
}
