import Link from "next/link";
import type { PostCardData } from "../lib/view.ts";
import { PersonaLine } from "./PersonaLine.tsx";
import { ReactionBar } from "./ReactionBar.tsx";
import { Timestamp } from "./Timestamp.tsx";

export function PostCard({ post, linked = true }: { post: PostCardData; linked?: boolean }) {
  return (
    <article className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_#ddd3c2]">
      <PersonaLine persona={post.author} meta={<Timestamp iso={post.createdAt} />} />
      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{post.body}</div>
      {post.hashtags.length > 0 ? (
        <p className="mt-3 text-sm text-pie">{post.hashtags.join(" ")}</p>
      ) : null}
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
