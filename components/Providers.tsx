"use client";

import type { User } from "@supabase/supabase-js";
import { AuthProvider } from "@/lib/auth-context";
import { ActiveQuestProvider } from "@/lib/active-quest-context";
import { UploadQueueProvider } from "@/components/UploadQueueProvider";
import { StatsProvider } from "@/lib/stats-context";

export default function Providers({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <UploadQueueProvider>
        <ActiveQuestProvider>
          <StatsProvider>{children}</StatsProvider>
        </ActiveQuestProvider>
      </UploadQueueProvider>
    </AuthProvider>
  );
}
