import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Server-side Supabase client.
 *
 * Default (web app): reads the session from Next.js cookies via @supabase/ssr.
 * Every existing call site passes nothing and keeps this behavior.
 *
 * Mobile (M12.3): the native app has no cookies — it sends
 * `Authorization: Bearer <supabase_access_token>`. When a request is passed in,
 * there is no cookie session, and that header is present, we build a plain
 * @supabase/supabase-js client whose global Authorization header carries the
 * token, so `supabase.auth.getUser()` resolves the mobile user and RLS runs as
 * them. Cookie auth always wins when present, so the web app is untouched.
 */
export function createClient(req?: Request) {
  const cookieStore = cookies();

  const hasCookieSession = cookieStore
    .getAll()
    .some((c) => c.name.includes("-auth-token") && c.value);

  if (!hasCookieSession && req) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return createSupabaseClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: { headers: { Authorization: authHeader } },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );
    }
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component; safe to ignore — middleware
            // refreshes the session.
          }
        },
      },
    },
  );
}
