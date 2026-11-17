"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PostCardData } from "../lib/view.ts";
import { PostCard } from "./PostCard.tsx";

export type FeedSource = { tab: "latest" | "trending" } | { tab: "latest"; persona: string };

/**
 * FR-7 infinite scroll: the server renders the first page; this fetches the rest from
 * /api/feed as the sentinel nears the viewport.
 */
export function FeedList({
  initial,
  initialCursor,
  source,
  empty,
}: {
  initial: PostCardData[];
  initialCursor: string | undefined;
  source: FeedSource;
  empty: string;
}) {
  const [posts, setPosts] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || state === "loading") return;
    setState("loading");
    const params = new URLSearchParams({ tab: source.tab, cursor });
    if ("persona" in source) params.set("persona", source.persona);
    try {
      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { posts: PostCardData[]; nextCursor?: string };
      // Trending pages by offset, so a post can move between pages; don't show it twice.
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [cursor, source, state]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  if (posts.length === 0) {
    return <p className="py-16 text-center font-serif text-muted">{empty}</p>;
  }
  return (
    <div className="space-y-4">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <div ref={sentinel} className="py-6 text-center text-sm text-muted">
        {state === "loading" ? "Circling back…" : null}
        {state === "error" ? (
          <button className="underline hover:text-pie" onClick={() => void loadMore()}>
            That didn&apos;t load. Try again?
          </button>
        ) : null}
        {!cursor ? "You've reached the end of thought leadership. For now." : null}
      </div>
    </div>
  );
}
