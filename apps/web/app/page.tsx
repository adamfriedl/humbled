import { FeedList } from "../components/FeedList.tsx";
import { FeedTabs } from "../components/FeedTabs.tsx";
import { config, queries } from "../lib/server.ts";
import { toCard } from "../lib/view.ts";

export const dynamic = "force-dynamic";

export default async function LatestPage() {
  const page = await queries().latest({ limit: config().web.feedPageSize });
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
