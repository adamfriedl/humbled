import Link from "next/link";
import { REACTIONS, topReactions } from "../lib/format.ts";
import type { PostCardData } from "../lib/view.ts";
import { PersonaLine } from "./PersonaLine.tsx";
import { Timestamp } from "./Timestamp.tsx";

export function PostCard({ post, linked = true }: { post: PostCardData; linked?: boolean }) {
  const kinds = topReactions(post.reactions.byKind);
  return (
    <article className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_#ddd3c2]">
      <PersonaLine persona={post.author} meta={<Timestamp iso={post.createdAt} />} />
      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{post.body}</div>
      {post.hashtags.length > 0 ? (
        <p className="mt-3 text-sm text-pie">{post.hashtags.join(" ")}</p>
      ) : null}
      <footer className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm text-muted">
        <span className="flex items-center gap-2">
          {kinds.length > 0 ? (
            <span className="flex gap-1" aria-hidden>
              {kinds.map((k) => (
                <span
                  key={k}
                  title={REACTIONS[k].label}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-pie-soft text-[11px] text-pie"
                >
                  {REACTIONS[k].mark}
                </span>
              ))}
            </span>
          ) : null}
          <span>
            {post.reactions.total} {post.reactions.total === 1 ? "reaction" : "reactions"}
          </span>
        </span>
        {linked ? (
          <Link href={`/posts/${post.id}`} className="hover:text-pie">
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Link>
        ) : (
          <span>
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </span>
        )}
      </footer>
    </article>
  );
}
