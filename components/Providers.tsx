"use client";

import type { User } from "@supabase/supabase-js";
import { AuthProvider } from "@/lib/auth-context";
import { ActiveQuestProvider } from "@/lib/active-quest-context";

export default function Providers({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <ActiveQuestProvider>{children}</ActiveQuestProvider>
    </AuthProvider>
  );
}
