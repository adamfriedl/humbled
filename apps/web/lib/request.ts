// Request helpers for route handlers.

/**
 * The client's IP. Cloud Run puts it first in X-Forwarded-For; anything after it was added
 * by proxies. Behind Cloudflare, CF-Connecting-IP is the reliable one.
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "unknown";
}

/**
 * CSRF guard for cookie-authenticated writes: the request must come from our own pages.
 * Browsers always send Origin on cross-site POST/PUT/DELETE; missing means a non-browser
 * client, which has no cookie to ride on anyway.
 */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === headers.get("host");
  } catch {
    return false;
  }
}
