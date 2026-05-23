"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/lib/auth-context";
import {
  uploadQuestMedia,
  type UploadResult,
} from "@/lib/upload";

export type UploadJobStatus = "uploading" | "completed" | "failed";

export type UploadJob = {
  id: string;
  questId: string;
  eventId: string;
  total: number;
  completed: number;
  failed: number;
  status: UploadJobStatus;
  failedFiles: File[];
  error?: string;
};

type EnqueueArgs = {
  questId: string;
  eventId: string;
  files: File[];
};

type UploadQueueContextValue = {
  jobs: UploadJob[];
  pendingCount: number;
  enqueue: (args: EnqueueArgs) => string;
  retry: (jobId: string) => void;
  /** Increments any time a job finishes — consumers can use it as a refetch trigger. */
  version: number;
};

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

let nextId = 0;

export function UploadQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [version, setVersion] = useState(0);
  // Keep a ref to the latest user.id so an in-flight upload uses the right
  // value even after navigation.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const updateJob = useCallback(
    (jobId: string, patch: Partial<UploadJob>) => {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
      );
    },
    [],
  );

  const runJob = useCallback(
    async (job: UploadJob, files: File[]) => {
      const uid = userIdRef.current;
      if (!uid) {
        updateJob(job.id, {
          status: "failed",
          error: "Not signed in",
          failedFiles: files,
        });
        setVersion((v) => v + 1);
        return;
      }
      const { succeeded, failed } = await uploadQuestMedia({
        userId: uid,
        questId: job.questId,
        eventId: job.eventId,
        files,
      });
      updateJob(job.id, {
        completed: succeeded.length,
        failed: failed.length,
        status: failed.length === 0 ? "completed" : "failed",
        failedFiles: failed
          .filter((r): r is Extract<UploadResult, { ok: false }> => !r.ok)
          .map((r) => r.file),
      });
      setVersion((v) => v + 1);
    },
    [updateJob],
  );

  const enqueue = useCallback(
    ({ questId, eventId, files }: EnqueueArgs) => {
      const id = `upload_${++nextId}_${Date.now().toString(36)}`;
      const job: UploadJob = {
        id,
        questId,
        eventId,
        total: files.length,
        completed: 0,
        failed: 0,
        status: "uploading",
        failedFiles: [],
      };
      setJobs((prev) => [...prev, job]);
      // Fire-and-forget — keep running across navigations.
      void runJob(job, files);
      return id;
    },
    [runJob],
  );

  const retry = useCallback(
    (jobId: string) => {
      setJobs((prev) => {
        const job = prev.find((j) => j.id === jobId);
        if (!job || job.failedFiles.length === 0) return prev;
        const retryFiles = job.failedFiles;
        const reset: UploadJob = {
          ...job,
          total: retryFiles.length,
          completed: 0,
          failed: 0,
          status: "uploading",
          failedFiles: [],
          error: undefined,
        };
        void runJob(reset, retryFiles);
        return prev.map((j) => (j.id === jobId ? reset : j));
      });
    },
    [runJob],
  );

  // Garbage-collect completed jobs after a short while so the queue indicator
  // doesn't linger forever.
  useEffect(() => {
    const completedIds = jobs
      .filter((j) => j.status === "completed")
      .map((j) => j.id);
    if (completedIds.length === 0) return;
    const t = window.setTimeout(() => {
      setJobs((prev) =>
        prev.filter(
          (j) => j.status !== "completed" || !completedIds.includes(j.id),
        ),
      );
    }, 4000);
    return () => window.clearTimeout(t);
  }, [jobs]);

  const pendingCount = jobs.reduce(
    (sum, j) => (j.status === "uploading" ? sum + (j.total - j.completed) : sum),
    0,
  );

  return (
    <UploadQueueContext.Provider
      value={{ jobs, pendingCount, enqueue, retry, version }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext);
  if (!ctx)
    throw new Error("useUploadQueue must be used inside UploadQueueProvider");
  return ctx;
}

/** Find an upload job tied to a specific quest, if any. */
export function useQuestUploadJob(questId: string | undefined | null) {
  const { jobs } = useUploadQueue();
  if (!questId) return null;
  // Most recent job for this quest wins.
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].questId === questId) return jobs[i];
  }
  return null;
}
