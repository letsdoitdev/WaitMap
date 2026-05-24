"use client";

import { CircleNotch } from "@phosphor-icons/react/dist/ssr";
import { useUploadQueue } from "@/components/UploadQueueProvider";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function UploadQueueIndicator() {
  const { user } = useAuth();
  const { jobs, pendingCount } = useUploadQueue();
  const pathname = usePathname();
  if (!user) return null;
  if (pathname?.startsWith("/onboarding")) return null;

  const activeJobs = jobs.filter((j) => j.status === "uploading");
  if (activeJobs.length === 0 || pendingCount === 0) return null;

  const totalAcross = activeJobs.reduce((s, j) => s + j.total, 0);
  const completedAcross = activeJobs.reduce((s, j) => s + j.completed, 0);

  return (
    <div className="ds-queue-indicator-wrap" aria-live="polite">
      <div className="ds-queue-indicator">
        <CircleNotch
          weight="duotone"
          size={14}
          aria-hidden="true"
          className="animate-spin"
        />
        <span>
          Uploading {completedAcross + 1} of {totalAcross}…
        </span>
      </div>
    </div>
  );
}
