"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [pwInput, setPwInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      if (res.ok) {
        router.replace("/admin");
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Try again later.");
      } else {
        setError("Incorrect password.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-purple-950 to-black p-6 text-white">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-amber-500/20 bg-black/60 p-6 shadow-2xl shadow-amber-500/10 backdrop-blur"
      >
        <div className="mb-6 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            Admin <span className="text-amber-400">Console</span>
          </h1>
          <p className="mt-1 text-xs text-white/50">
            Restricted access. Authorized personnel only.
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/60">
            Password
          </span>
          <input
            type="password"
            value={pwInput}
            onChange={(e) => {
              setPwInput(e.target.value);
              setError(null);
            }}
            autoFocus
            className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2.5 font-bold text-black transition hover:bg-amber-400 active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
