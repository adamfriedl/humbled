// The shapes pages hand to components. Dates travel as ISO strings so the same components
// render server-side and after a client-side fetch.
import type { CommentView, PersonaSummary, PostView } from "@humbled/db";

export type PostCardData = Omit<PostView, "createdAt"> & { createdAt: string };
export type CommentData = Omit<CommentView, "createdAt"> & { createdAt: string };
export type { PersonaSummary };

export const toCard = (p: PostView): PostCardData => ({
  ...p,
  createdAt: p.createdAt.toISOString(),
});

export const toCommentData = (c: CommentView): CommentData => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
});
