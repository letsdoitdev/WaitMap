import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { RatingRecord } from "@/lib/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ratings.json");
const VALID = new Set(["cooked", "mid", "tuff", "fire"]);

async function loadAll(): Promise<RatingRecord[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RatingRecord[]) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<RatingRecord>;
  try {
    body = (await req.json()) as Partial<RatingRecord>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const {
    questId,
    questName,
    category,
    spiceLevel,
    groupSize,
    timeAvailable,
    rating,
  } = body;

  if (
    !questId ||
    !questName ||
    !category ||
    typeof spiceLevel !== "number" ||
    typeof groupSize !== "number" ||
    typeof timeAvailable !== "number" ||
    !rating ||
    !VALID.has(rating)
  ) {
    return NextResponse.json(
      { ok: false, error: "missing or invalid fields" },
      { status: 400 },
    );
  }

  const record: RatingRecord = {
    questId,
    questName,
    category,
    spiceLevel,
    groupSize,
    timeAvailable,
    rating,
    timestamp: Date.now(),
  };

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const all = await loadAll();
    all.push(record);
    await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    // Vercel serverless filesystem is read-only at runtime — degrade gracefully.
    return NextResponse.json({
      ok: true,
      persisted: false,
      note: err instanceof Error ? err.message : "fs unavailable",
    });
  }
}

export async function GET() {
  const all = await loadAll();
  return NextResponse.json({ ok: true, count: all.length, ratings: all });
}
