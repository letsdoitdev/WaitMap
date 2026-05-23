"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, VideoCamera, X } from "@phosphor-icons/react/dist/ssr";
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_PER_COMPLETION,
  ACCEPTED_MEDIA_MIME,
} from "@/lib/database.types";
import {
  classifyMedia,
  formatBytes,
  validateFile,
} from "@/lib/upload";

export type PendingMedia = {
  id: string;
  file: File;
  kind: "image" | "video";
  previewUrl: string;
};

type Props = {
  pending: PendingMedia[];
  onChange: (next: PendingMedia[]) => void;
  disabled?: boolean;
  /** When non-null, all tiles render the upload spinner ring. */
  uploadingTotal?: number;
  uploadingCompleted?: number;
};

const ACCEPT_ATTR = ACCEPTED_MEDIA_MIME.join(",");
let pendingSeq = 0;

export default function MediaCapturePad({
  pending,
  onChange,
  disabled,
  uploadingTotal,
  uploadingCompleted,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Revoke any outstanding object URLs on unmount so we don't leak blobs.
  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const slots = useMemo(() => {
    const out: (PendingMedia | null)[] = [];
    for (let i = 0; i < MAX_MEDIA_PER_COMPLETION; i++) {
      out.push(pending[i] ?? null);
    }
    return out;
  }, [pending]);

  const filledCount = pending.length;
  const canAdd = filledCount < MAX_MEDIA_PER_COMPLETION;

  const isUploading =
    uploadingTotal !== undefined && uploadingCompleted !== undefined;
  const progress =
    isUploading && uploadingTotal! > 0
      ? Math.min(1, uploadingCompleted! / uploadingTotal!)
      : 0;

  const openPicker = () => {
    if (disabled || !canAdd) return;
    inputRef.current?.click();
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const accepted: PendingMedia[] = [];
    const errors: string[] = [];
    let remaining = MAX_MEDIA_PER_COMPLETION - pending.length;

    for (const file of incoming) {
      if (remaining <= 0) {
        errors.push(`Max ${MAX_MEDIA_PER_COMPLETION} files per completion`);
        break;
      }
      const validation = validateFile(file);
      if (validation) {
        if (validation.kind === "mime") {
          errors.push(`${file.name}: unsupported file type`);
        } else {
          errors.push(
            `${file.name}: ${formatBytes(file.size)} exceeds ${formatBytes(
              MAX_MEDIA_BYTES,
            )}`,
          );
        }
        continue;
      }
      const kind = classifyMedia(file.type);
      if (!kind) continue;
      accepted.push({
        id: `pm_${++pendingSeq}_${Date.now().toString(36)}`,
        file,
        kind,
        previewUrl: URL.createObjectURL(file),
      });
      remaining -= 1;
    }

    if (errors.length > 0) setToast(errors[0]);
    if (accepted.length > 0) onChange([...pending, ...accepted]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    if (disabled) return;
    const next = pending.filter((p) => p.id !== id);
    const removed = pending.find((p) => p.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onChange(next);
  };

  return (
    <div className="ds-capture-pad-wrap">
      <div
        className="ds-capture-pad-grid"
        role="group"
        aria-label="Quest media"
      >
        {slots.map((item, i) => {
          if (!item) {
            const isFirstEmpty =
              pending.length === i ||
              (pending.length < MAX_MEDIA_PER_COMPLETION && i === pending.length);
            return (
              <button
                key={`empty-${i}`}
                type="button"
                className="ds-capture-tile"
                data-empty="true"
                onClick={isFirstEmpty ? openPicker : undefined}
                disabled={disabled || !isFirstEmpty}
                aria-label={
                  isFirstEmpty ? "Add a photo or video" : "Empty slot"
                }
              >
                {isFirstEmpty && (
                  <Plus
                    weight="duotone"
                    size={22}
                    color="var(--text-tertiary)"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          }

          return (
            <div
              key={item.id}
              className="ds-capture-tile"
              data-kind={item.kind}
              data-uploading={isUploading ? "true" : "false"}
            >
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="ds-capture-tile-media"
                />
              ) : (
                <>
                  <video
                    src={item.previewUrl}
                    className="ds-capture-tile-media"
                    muted
                    playsInline
                  />
                  <span
                    className="ds-capture-tile-video-glyph"
                    aria-hidden="true"
                  >
                    <VideoCamera weight="duotone" size={16} />
                  </span>
                </>
              )}

              {isUploading ? (
                <span
                  className="ds-capture-progress-ring"
                  style={{
                    background: `conic-gradient(var(--accent-grad-start, #7dd3c0) 0deg, transparent ${
                      progress * 360
                    }deg)`,
                  }}
                  aria-hidden="true"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={disabled}
                  className="ds-capture-tile-remove"
                  aria-label="Remove file"
                >
                  <X weight="duotone" size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="ds-capture-pad-hint">
        Up to {MAX_MEDIA_PER_COMPLETION} files, {formatBytes(MAX_MEDIA_BYTES)}{" "}
        each. JPEG, PNG, HEIC, WebP, MP4, MOV.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        // capture="environment" so mobile Safari/Chrome opens the camera
        // directly rather than the file picker.
        capture="environment"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="ds-capture-toast glass"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
