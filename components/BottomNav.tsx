"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, House } from "@phosphor-icons/react/dist/ssr";
import { useAuth } from "@/lib/auth-context";

export default function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  const isHome = pathname === "/";
  const isHistory = pathname?.startsWith("/history") ?? false;

  return (
    <nav className="ds-bottom-nav" aria-label="Main">
      <div className="glass ds-bottom-nav-inner">
        <Link
          href="/"
          className="ds-bottom-nav-tab"
          data-active={isHome ? "true" : "false"}
        >
          <House
            weight={isHome ? "fill" : "duotone"}
            size={18}
            aria-hidden="true"
          />
          <span>Home</span>
        </Link>
        <Link
          href="/history"
          className="ds-bottom-nav-tab"
          data-active={isHistory ? "true" : "false"}
        >
          <Clock
            weight={isHistory ? "fill" : "duotone"}
            size={18}
            aria-hidden="true"
          />
          <span>History</span>
        </Link>
      </div>
    </nav>
  );
}
