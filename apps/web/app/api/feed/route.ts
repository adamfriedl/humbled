import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE, validOwnerId } from "../../../lib/owner.ts";
import { config, queries } from "../../../lib/server.ts";
import { toCard } from "../../../lib/view.ts";

export const dynamic = "force-dynamic";

/** Feed pages after the first, for infinite scroll. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tab = params.get("tab") === "trending" ? "trending" : "latest";
  const cursor = params.get("cursor") ?? undefined;
  const persona = params.get("persona") ?? undefined;
  const viewer = validOwnerId(req.cookies.get(OWNER_COOKIE)?.value);
  const { web } = config();
  const page =
    tab === "trending"
      ? await queries().trending({
          limit: web.feedPageSize,
          now: new Date(),
          windowDays: web.trendingWindowDays,
          ...(viewer ? { viewerId: viewer } : {}),
          ...(cursor ? { cursor } : {}),
        })
      : await queries().latest({
          limit: web.feedPageSize,
          ...(cursor ? { cursor } : {}),
          ...(persona ? { personaId: persona } : {}),
          ...(viewer ? { viewerId: viewer } : {}),
        });
  return NextResponse.json(
    { posts: page.posts.map(toCard), nextCursor: page.nextCursor },
    { headers: { "cache-control": "no-store" } },
  );
}
