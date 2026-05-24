"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CircleNotch,
  EnvelopeSimple,
  GoogleLogo,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { useAuth } from "@/lib/auth-context";

export type SignInIntent = "save" | "start";

// Official Apple mark, inlined per App Store review requirements (a
// third-party icon font glyph can be flagged on Sign in with Apple buttons).
function AppleMark() {
  return (
    <svg viewBox="0 0 14 18" width={16} height={18} fill="currentColor" aria-hidden="true">
      <path d="M10.3 9.6c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.6 2 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1 0 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4 0 0-2.2-.8-2.2-3.3zM8.5 3.6c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.2-.5.6-1 1.5-.8 2.5.9.1 1.8-.5 2.4-1.1z" />
    </svg>
  );
}

export default function SignInModal({
  open,
  intent,
  onClose,
}: {
  open: boolean;
  intent: SignInIntent;
  onClose: () => void;
}) {
  const { signInWithApple, signInWithGoogle, signInWithEmail } = useAuth();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"apple" | "google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  const title =
    intent === "start"
      ? "Sign in to start your quest"
      : "Sign in to save your quests";

  const close = () => {
    if (busy) return;
    setShowEmail(false);
    setEmail("");
    setError(null);
    setLinkSent(false);
    setBusy(null);
    onClose();
  };

  const handleApple = async () => {
    setBusy("apple");
    setError(null);
    const { error } = await signInWithApple();
    if (error) {
      setError(error);
      setBusy(null);
    }
    // success → page redirects to Apple
  };

  const handleGoogle = async () => {
    setBusy("google");
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setError(error);
      setBusy(null);
    }
    // success → page redirects to Google
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy("email");
    setError(null);
    const { error } = await signInWithEmail(email.trim());
    setBusy(null);
    if (error) {
      setError(error);
      return;
    }
    setLinkSent(true);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="ds-modal-overlay"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="glass ds-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
          >
            <div className="flex items-start justify-between">
              <h3 id="signin-title" className="ds-modal-title">
                {title}
              </h3>
              <button
                type="button"
                onClick={close}
                disabled={!!busy}
                className="ds-modal-close"
                aria-label="Close"
              >
                <X weight="duotone" size={16} aria-hidden="true" />
              </button>
            </div>

            {linkSent ? (
              <div style={{ marginTop: "var(--space-5)" }}>
                <p className="ds-modal-hint" style={{ marginTop: 0 }}>
                  Check your email
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-body, inherit)",
                    fontSize: "14px",
                    color: "var(--text-tertiary)",
                    lineHeight: 1.5,
                  }}
                >
                  We sent a sign-in link to <strong>{email}</strong>. Open it on
                  this device to finish signing in.
                </p>
              </div>
            ) : (
              <div
                className="flex flex-col"
                style={{ gap: "var(--space-3)", marginTop: "var(--space-5)" }}
              >
                <button
                  type="button"
                  onClick={handleApple}
                  disabled={!!busy}
                  className="ds-auth-btn"
                  style={{ background: "#000", color: "#fff", borderColor: "#000" }}
                >
                  {busy === "apple" ? (
                    <CircleNotch
                      weight="duotone"
                      size={18}
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : (
                    <AppleMark />
                  )}
                  <span>Continue with Apple</span>
                </button>

                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={!!busy}
                  className="ds-auth-btn"
                >
                  {busy === "google" ? (
                    <CircleNotch
                      weight="duotone"
                      size={18}
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : (
                    <GoogleLogo weight="duotone" size={18} aria-hidden="true" />
                  )}
                  <span>Continue with Google</span>
                </button>

                {showEmail ? (
                  <form
                    onSubmit={handleEmail}
                    className="flex flex-col"
                    style={{ gap: "var(--space-3)" }}
                  >
                    <input
                      type="email"
                      required
                      autoFocus
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy === "email"}
                      className="ds-loc-input"
                      style={{ paddingRight: 16 }}
                      aria-label="Email address"
                    />
                    <button
                      type="submit"
                      disabled={!email.trim() || busy === "email"}
                      className="ds-auth-btn"
                    >
                      {busy === "email" ? (
                        <>
                          <CircleNotch
                            weight="duotone"
                            size={18}
                            aria-hidden="true"
                            className="animate-spin"
                          />
                          <span>Sending link…</span>
                        </>
                      ) : (
                        <>
                          <EnvelopeSimple
                            weight="duotone"
                            size={18}
                            aria-hidden="true"
                          />
                          <span>Send link</span>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowEmail(true)}
                    disabled={!!busy}
                    className="ds-auth-btn"
                  >
                    <EnvelopeSimple
                      weight="duotone"
                      size={18}
                      aria-hidden="true"
                    />
                    <span>Continue with email</span>
                  </button>
                )}

                {error && (
                  <p
                    style={{
                      fontFamily: "var(--font-body, inherit)",
                      fontSize: "13px",
                      color: "var(--error)",
                      margin: 0,
                    }}
                  >
                    {error}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
