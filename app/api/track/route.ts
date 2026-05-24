import { NextResponse } from "next/server";

/**
 * Stub analytics sink. Returns 200 unconditionally; today this exists so
 * `lib/analytics.ts:track()` has somewhere to POST and the network panel
 * shows the event names during development. When we wire a vendor the
 * body of this handler is the only place that needs to change.
 */
export async function POST() {
  return NextResponse.json({ ok: true });
}

// GET is allowed too so probes / pings don't 405.
export async function GET() {
  return NextResponse.json({ ok: true });
}
