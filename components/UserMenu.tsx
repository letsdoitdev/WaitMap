"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { useAuth } from "@/lib/auth-context";
import SignInModal from "@/components/SignInModal";

export default function UserMenu() {
  const { user, displayName, initial, signOut } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const onOnboarding = pathname?.startsWith("/onboarding") ?? false;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (onOnboarding) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          className="ds-suggest-pill"
          onClick={() => setSignInOpen(true)}
        >
          <span>Sign in</span>
        </button>
        <SignInModal
          open={signInOpen}
          intent="save"
          onClose={() => setSignInOpen(false)}
        />
      </>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className="ds-avatar"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={displayName ?? "Account"}
      >
        {initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="glass ds-user-menu"
            role="menu"
          >
            <div className="ds-user-menu-name">{displayName}</div>
            <button
              type="button"
              className="ds-user-menu-item"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
            >
              <SignOut weight="duotone" size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
