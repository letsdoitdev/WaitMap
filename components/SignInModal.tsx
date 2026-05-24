"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AppleLogo,
  CircleNotch,
  EnvelopeSimple,
  GoogleLogo,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { useAuth } from "@/lib/auth-context";

export type SignInIntent = "save" | "start";

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
                >
                  {busy === "apple" ? (
                    <CircleNotch
                      weight="duotone"
                      size={18}
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : (
                    <AppleLogo weight="fill" size={18} aria-hidden="true" />
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
