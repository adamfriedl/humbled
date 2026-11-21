import Link from "next/link";
import type { PostCardData } from "../lib/view.ts";
import { PersonaLine } from "./PersonaLine.tsx";
import { PostBody } from "./PostBody.tsx";
import { ReactionBar } from "./ReactionBar.tsx";
import { Timestamp } from "./Timestamp.tsx";

export function PostCard({ post, linked = true }: { post: PostCardData; linked?: boolean }) {
  return (
    <article className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_#ddd3c2]">
      <PersonaLine persona={post.author} meta={<Timestamp iso={post.createdAt} />} />
      <PostBody body={post.body} hashtags={post.hashtags} clamp={linked} />
      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm text-muted">
        <ReactionBar postId={post.id} initial={post.reactions} initialMine={post.mine} />
        {linked ? (
          <Link href={`/posts/${post.id}`} className="shrink-0 hover:text-pie">
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Link>
        ) : (
          <span className="shrink-0">
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </span>
        )}
      </footer>
    </article>
  );
}
