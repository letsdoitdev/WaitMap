import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;
      if (user) {
        const displayName =
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined);
        try {
          // Only write display_name when the provider gave us one — Apple
          // returns it on first auth only, so omitting it avoids clobbering
          // an existing name with null on later sign-ins.
          const { error: upsertError } = await supabase
            .from("profiles")
            .upsert({
              id: user.id,
              ...(displayName ? { display_name: displayName } : {}),
            });
          if (upsertError) throw upsertError;
        } catch (err) {
          // Profile write is best-effort — never block sign-in on it.
          console.error("[auth/callback] profile upsert failed:", err);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Send the user home — they can retry sign-in from there.
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
