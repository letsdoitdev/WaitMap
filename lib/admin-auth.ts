import "server-only";

export const ADMIN_COOKIE_NAME = "sq_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

// Constant-time string compare. If lengths differ, still walks the longer
// input to avoid leaking length via timing, then returns false.
export function constantTimeStringEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function hmacHex(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(sigBuf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function createSessionCookieValue(
  now: number = Date.now(),
): Promise<string> {
  const issuedAt = String(now);
  const sig = await hmacHex(issuedAt);
  return `${issuedAt}.${sig}`;
}

export async function verifyCookieValue(
  value: string | undefined,
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const issuedAt = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(issuedAt)) return false;
  const expected = await hmacHex(issuedAt);
  if (!constantTimeStringEqual(sig, expected)) return false;
  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;
  if (Date.now() - issuedAtMs > SESSION_TTL_MS) return false;
  return true;
}

export async function verifyAdminCookieFromHeader(
  cookieHeader: string | null,
): Promise<boolean> {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === ADMIN_COOKIE_NAME) {
      const value = decodeURIComponent(part.slice(eq + 1));
      return verifyCookieValue(value);
    }
  }
  return false;
}

export function sessionMaxAgeSeconds(): number {
  return Math.floor(SESSION_TTL_MS / 1000);
}
