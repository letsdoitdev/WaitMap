"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretLeft,
  CaretRight,
  X,
} from "@phosphor-icons/react/dist/ssr";

export type LightboxItem = {
  id: string;
  url: string;
  kind: "image" | "video";
};

type Props = {
  items: LightboxItem[];
  initialIndex: number;
  onClose: () => void;
};

export default function Lightbox({ items, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight")
        setIndex((i) => Math.min(items.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  if (!current) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="ds-lightbox-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Media viewer"
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          className="ds-lightbox-close"
          aria-label="Close"
        >
          <X weight="duotone" size={20} aria-hidden="true" />
        </button>

        <div
          className="ds-lightbox-stage"
          onClick={(e) => e.stopPropagation()}
        >
          {current.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url}
              alt=""
              className="ds-lightbox-media"
            />
          ) : (
            <video
              src={current.url}
              controls
              playsInline
              className="ds-lightbox-media"
            />
          )}
        </div>

        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.max(0, i - 1));
            }}
            className="ds-lightbox-nav"
            data-side="prev"
            aria-label="Previous"
          >
            <CaretLeft weight="duotone" size={22} aria-hidden="true" />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            }}
            className="ds-lightbox-nav"
            data-side="next"
            aria-label="Next"
          >
            <CaretRight weight="duotone" size={22} aria-hidden="true" />
          </button>
        )}

        <div className="ds-lightbox-counter" aria-hidden="true">
          {index + 1} / {items.length}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
