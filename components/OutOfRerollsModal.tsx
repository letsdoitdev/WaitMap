"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock } from "@phosphor-icons/react/dist/ssr";
import { FREE_DAILY_REROLLS } from "@/lib/constants";

export default function OutOfRerollsModal({
  open,
  onClose,
  onGoPro,
}: {
  open: boolean;
  onClose: () => void;
  onGoPro: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // ESC to close + focus trap. Focus the card on open; keep Tab cycling within
  // the modal's focusable elements.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = cardRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="ds-modal-overlay"
          onClick={onClose}
        >
          <motion.div
            ref={cardRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="glass ds-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="out-of-rerolls-title"
          >
            <h3 id="out-of-rerolls-title" className="ds-modal-title">
              <Lock weight="duotone" size={20} aria-hidden="true" />
              Out of rerolls
            </h3>
            <p className="ds-modal-hint">
              You&rsquo;ve used all {FREE_DAILY_REROLLS} free rerolls for today.
              Go Pro for unlimited rerolls.
            </p>
            <div
              className="flex"
              style={{ gap: "var(--space-3)", marginTop: "var(--space-5)" }}
            >
              <button
                type="button"
                onClick={onClose}
                className="ds-auth-btn"
                style={{ flex: 1 }}
              >
                <span>Maybe later</span>
              </button>
              <button
                type="button"
                onClick={onGoPro}
                className="ds-cta"
                style={{ flex: 1 }}
              >
                <span>Go Pro</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
