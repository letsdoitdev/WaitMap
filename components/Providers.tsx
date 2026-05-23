"use client";

import type { User } from "@supabase/supabase-js";
import { AuthProvider } from "@/lib/auth-context";
import { ActiveQuestProvider } from "@/lib/active-quest-context";
import { UploadQueueProvider } from "@/components/UploadQueueProvider";

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
        <ActiveQuestProvider>{children}</ActiveQuestProvider>
      </UploadQueueProvider>
    </AuthProvider>
  );
}
