import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRO_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

// Demo-only tier flip (M12.2). Not gated on NODE_ENV — must work in the
// production Vercel deploy the TestFlight wrapper points at. The admin check
// is re-evaluated server-side on every request; the client visibility gate in
// DemoTierToggle is convenience only.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { tier?: unknown };
  try {
    body = (await req.json()) as { tier?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.tier !== "free" && body.tier !== "pro") {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }

  const tier_expires_at =
    body.tier === "pro"
      ? new Date(Date.now() + PRO_DURATION_MS).toISOString()
      : null;

  const { data, error } = await supabase
    .from("profiles")
    .update({ tier: body.tier, tier_expires_at })
    .eq("id", user.id)
    .select("tier, tier_expires_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: data });
}
