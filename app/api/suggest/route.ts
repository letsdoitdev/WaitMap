import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { Suggestion } from "@/lib/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "suggestions.json");
const VALID = new Set(["cooked", "mid", "tuff", "fire"]);

async function loadAll(): Promise<Suggestion[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Suggestion[]) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<Suggestion>;
  try {
    body = (await req.json()) as Partial<Suggestion>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) {
    return NextResponse.json(
      { ok: false, error: "text must be 1-500 chars" },
      { status: 400 },
    );
  }
  const selfRating =
    body.selfRating && VALID.has(body.selfRating) ? body.selfRating : null;

  const record: Suggestion = {
    id: crypto.randomUUID(),
    text,
    selfRating,
    timestamp: Date.now(),
  };

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const all = await loadAll();
    all.push(record);
    await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
    return NextResponse.json({ ok: true, persisted: true, suggestion: record });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      suggestion: record,
      note: err instanceof Error ? err.message : "fs unavailable",
    });
  }
}

export async function GET() {
  const all = await loadAll();
  return NextResponse.json({ ok: true, count: all.length, suggestions: all });
}
