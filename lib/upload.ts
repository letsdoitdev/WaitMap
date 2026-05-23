"use client";

import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_IMAGE_MIME,
  ACCEPTED_MEDIA_MIME,
  ACCEPTED_VIDEO_MIME,
  IMAGE_COMPRESS_THRESHOLD_BYTES,
  MAX_MEDIA_BYTES,
  QUEST_MEDIA_BUCKET,
  type QuestMedia,
} from "@/lib/database.types";

export type MediaKind = "image" | "video";

export type ValidationError =
  | { kind: "mime"; file: File }
  | { kind: "size"; file: File }
  | { kind: "limit"; reason: string };

export type UploadResult =
  | {
      ok: true;
      file: File;
      media: QuestMedia;
    }
  | {
      ok: false;
      file: File;
      error: string;
    };

export function classifyMedia(mime: string): MediaKind | null {
  if ((ACCEPTED_IMAGE_MIME as readonly string[]).includes(mime)) return "image";
  if ((ACCEPTED_VIDEO_MIME as readonly string[]).includes(mime)) return "video";
  return null;
}

export function validateFile(file: File): ValidationError | null {
  if (!(ACCEPTED_MEDIA_MIME as readonly string[]).includes(file.type)) {
    return { kind: "mime", file };
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return { kind: "size", file };
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileExtensionFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default:
      return "bin";
  }
}

async function readImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function readVideoMeta(
  blob: Blob,
): Promise<{ width: number; height: number; durationMs: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const out = {
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : 0,
      };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

/**
 * Canvas-resize an image so the longest edge is `maxEdge` px. Returns a JPEG
 * Blob at the requested quality. Best-effort: if anything throws (HEIC,
 * tainted canvas, etc.) the original blob is returned untouched.
 */
export async function compressImage(
  file: File,
  maxEdge = 2048,
  quality = 0.85,
): Promise<Blob> {
  if (typeof window === "undefined") return file;
  if (file.type === "image/heic") {
    // Browser can't decode HEIC reliably to canvas. Upload as-is.
    return file;
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });

    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (longest <= maxEdge) {
      return file;
    }
    const scale = maxEdge / longest;
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

function safeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);
}

export type UploadQuestMediaArgs = {
  userId: string;
  questId: string;
  eventId: string;
  files: File[];
};

export async function uploadQuestMedia({
  userId,
  questId,
  eventId,
  files,
}: UploadQuestMediaArgs): Promise<{
  succeeded: UploadResult[];
  failed: UploadResult[];
}> {
  const supabase = createClient();
  const settled = await Promise.allSettled(
    files.map(async (file): Promise<UploadResult> => {
      const validation = validateFile(file);
      if (validation) {
        return {
          ok: false,
          file,
          error:
            validation.kind === "mime"
              ? "Unsupported file type"
              : "File over 25 MB",
        };
      }

      const kind = classifyMedia(file.type);
      let payload: Blob = file;
      let mime = file.type;

      if (kind === "image" && file.size > IMAGE_COMPRESS_THRESHOLD_BYTES) {
        payload = await compressImage(file);
        // Compression always emits JPEG (unless HEIC pass-through).
        if (payload !== file) mime = "image/jpeg";
      }

      let width: number | null = null;
      let height: number | null = null;
      let durationMs: number | null = null;

      if (kind === "image") {
        const dims = await readImageDimensions(payload);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      } else if (kind === "video") {
        const meta = await readVideoMeta(payload);
        if (meta) {
          width = meta.width || null;
          height = meta.height || null;
          durationMs = meta.durationMs || null;
        }
      }

      const ext = fileExtensionFromMime(mime);
      const stamp = Date.now().toString(36);
      const rand = Math.random().toString(36).slice(2, 8);
      const filename = `${stamp}_${rand}_${safeFilename(
        file.name.replace(/\.[^.]+$/, ""),
      )}.${ext}`;
      const path = `${userId}/${questId}/${eventId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from(QUEST_MEDIA_BUCKET)
        .upload(path, payload, {
          contentType: mime,
          upsert: false,
        });

      if (uploadError) {
        return { ok: false, file, error: uploadError.message };
      }

      const { data: row, error: insertError } = await supabase
        .from("quest_media")
        .insert({
          quest_id: questId,
          quest_event_id: eventId,
          user_id: userId,
          storage_path: path,
          mime_type: mime,
          bytes: payload.size,
          width,
          height,
          duration_ms: durationMs,
        })
        .select()
        .single();

      if (insertError || !row) {
        // Roll back the uploaded object so we don't leak storage rows.
        await supabase.storage.from(QUEST_MEDIA_BUCKET).remove([path]);
        return {
          ok: false,
          file,
          error: insertError?.message ?? "Couldn't record media row",
        };
      }

      return { ok: true, file, media: row };
    }),
  );

  const succeeded: UploadResult[] = [];
  const failed: UploadResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      if (result.value.ok) succeeded.push(result.value);
      else failed.push(result.value);
    } else {
      failed.push({
        ok: false,
        file: files[i],
        error: String(result.reason ?? "Upload failed"),
      });
    }
  }
  return { succeeded, failed };
}

/**
 * Batch signed URL creation for display. Storage URLs are never exposed
 * directly — every render path goes through this with a 60-minute expiry.
 */
export async function getSignedMediaUrls(
  mediaRows: Pick<QuestMedia, "id" | "storage_path">[],
): Promise<Record<string, string>> {
  if (mediaRows.length === 0) return {};
  const supabase = createClient();
  const { data } = await supabase.storage
    .from(QUEST_MEDIA_BUCKET)
    .createSignedUrls(
      mediaRows.map((m) => m.storage_path),
      60 * 60,
    );
  const map: Record<string, string> = {};
  for (let i = 0; i < mediaRows.length; i++) {
    const signed = data?.[i];
    if (signed?.signedUrl) {
      map[mediaRows[i].id] = signed.signedUrl;
    }
  }
  return map;
}
