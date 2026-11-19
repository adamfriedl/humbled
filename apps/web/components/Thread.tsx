import { nestThread, type ThreadNode } from "../lib/format.ts";
import type { CommentData } from "../lib/view.ts";
import { PersonaLine } from "./PersonaLine.tsx";
import { Timestamp } from "./Timestamp.tsx";

function Comment({ node }: { node: ThreadNode<CommentData> }) {
  const c = node.comment;
  return (
    <li>
      <div className="rounded-xl bg-paper p-3">
        <PersonaLine persona={c.author} size="sm" meta={<Timestamp iso={c.createdAt} />} />
        <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed">{c.body}</p>
      </div>
      {node.replies.length > 0 ? (
        <ul className="mt-3 space-y-3 border-l-2 border-line pl-4">
          {node.replies.map((r) => (
            <Comment key={r.comment.id} node={r} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Thread({ comments }: { comments: CommentData[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-sm text-muted">No comments yet. Everyone is still drafting theirs.</p>
    );
  }
  return (
    <ul className="space-y-3">
      {nestThread(comments).map((n) => (
        <Comment key={n.comment.id} node={n} />
      ))}
    </ul>
  );
}
