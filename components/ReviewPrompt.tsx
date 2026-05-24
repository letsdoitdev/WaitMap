"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X } from "@phosphor-icons/react/dist/ssr";
import { track } from "@/lib/analytics";
import { APP_STORE_REVIEW_URL } from "@/lib/constants";

type Props = {
  /** Render with a 1.2s mount delay so the completion moment lands first. */
  open: boolean;
  /** Fires when the user picks either option (or closes via X). The caller
   * decides what to do next — usually mark the localStorage flag + redirect. */
  onClose: (outcome: "accepted" | "dismissed") => void;
};

const ENTRY_DELAY_MS = 1_200;

export default function ReviewPrompt({ open, onClose }: Props) {
  // Internal "should render" flag — defers mount by ENTRY_DELAY_MS so the
  // celebration animation gets the first beat.
  const [show, setShow] = useState(false);
  const shownTracked = useRef(false);

  useEffect(() => {
    if (!open) {
      setShow(false);
      shownTracked.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      setShow(true);
      if (!shownTracked.current) {
        shownTracked.current = true;
        track("review_prompt_shown", {});
      }
    }, ENTRY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  const accept = () => {
    track("review_prompt_accepted", {});
    if (typeof window !== "undefined") {
      window.open(APP_STORE_REVIEW_URL, "_blank", "noopener,noreferrer");
    }
    onClose("accepted");
  };

  const dismiss = () => {
    track("review_prompt_dismissed", {});
    onClose("dismissed");
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="overlay"
          className="ds-review-prompt-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={dismiss}
        >
          <motion.div
            key="sheet"
            className="glass ds-review-prompt-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-prompt-title"
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={dismiss}
              className="ds-review-prompt-close"
              aria-label="Dismiss"
            >
              <X weight="duotone" size={16} aria-hidden="true" />
            </button>

            <span className="ds-review-prompt-glyph" aria-hidden="true">
              <Star weight="duotone" size={22} />
            </span>

            <h2 id="review-prompt-title" className="ds-review-prompt-title">
              Loved that quest?
            </h2>
            <p className="ds-review-prompt-body">
              A quick review helps us make more.
            </p>

            <div className="ds-review-prompt-actions">
              <button
                type="button"
                onClick={accept}
                className="ds-review-prompt-primary"
              >
                Leave a review
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="ds-review-prompt-secondary"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
