// The site's absolute origin, for Open Graph and canonical URLs. HUMBLED_SITE_URL wins when
// set; otherwise the request's own host (Cloud Run passes the custom domain through).
import "server-only";
import { headers } from "next/headers";

export async function siteUrl(): Promise<URL> {
  const fixed = process.env.HUMBLED_SITE_URL;
  if (fixed) return new URL(fixed);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = host.startsWith("localhost") || host.startsWith("127.");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return new URL(`${proto}://${host}`);
}
