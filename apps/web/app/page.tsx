import { FeedList } from "../components/FeedList.tsx";
import { FeedTabs } from "../components/FeedTabs.tsx";
import { viewerId } from "../lib/owner.ts";
import { config, queries } from "../lib/server.ts";
import { toCard } from "../lib/view.ts";

export const dynamic = "force-dynamic";

export default async function LatestPage() {
  const viewer = await viewerId();
  const page = await queries().latest({
    limit: config().web.feedPageSize,
    ...(viewer ? { viewerId: viewer } : {}),
  });
  return (
    <>
      <FeedTabs active="latest" />
      <FeedList
        initial={page.posts.map(toCard)}
        initialCursor={page.nextCursor}
        source={{ tab: "latest" }}
        empty="Nobody has posted yet. They're all in a meeting."
      />
    </>
  );
}
