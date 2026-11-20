import type { Metadata } from "next";
import { FeedList } from "../../components/FeedList.tsx";
import { FeedTabs } from "../../components/FeedTabs.tsx";
import { viewerId } from "../../lib/owner.ts";
import { config, queries } from "../../lib/server.ts";
import { toCard } from "../../lib/view.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trending" };

export default async function TrendingPage() {
  const { web } = config();
  const viewer = await viewerId();
  const page = await queries().trending({
    ...(viewer ? { viewerId: viewer } : {}),
    limit: web.feedPageSize,
    now: new Date(),
    windowDays: web.trendingWindowDays,
  });
  return (
    <>
      <FeedTabs active="trending" />
      <p className="mb-4 text-sm text-muted">
        Ranked by engagement, with a bonus for cringe. The algorithm rewards exactly what you think
        it rewards.
      </p>
      <FeedList
        initial={page.posts.map(toCard)}
        initialCursor={page.nextCursor}
        source={{ tab: "trending" }}
        empty="Nothing is trending. A rare moment of collective humility."
      />
    </>
  );
}
