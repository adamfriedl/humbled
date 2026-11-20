import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PostCard } from "../../../components/PostCard.tsx";
import { Thread } from "../../../components/Thread.tsx";
import { viewerId } from "../../../lib/owner.ts";
import { queries } from "../../../lib/server.ts";
import { toCard, toCommentData } from "../../../lib/view.ts";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page, so one request runs the query once.
const load = cache(async (id: string) => queries().post(id, await viewerId()));

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await load((await params).id);
  if (!view) return { title: "Post not found" };
  const { post } = view;
  const excerpt = post.body.replace(/\s+/g, " ").slice(0, 160);
  return {
    title: `${post.author.name}: "${excerpt.slice(0, 60)}…"`,
    description: excerpt,
  };
}

export default async function PostPage({ params }: Props) {
  const view = await load((await params).id);
  if (!view) notFound();
  return (
    <>
      <Link href="/" className="mb-4 inline-block text-sm text-muted hover:text-pie">
        ← Back to the feed
      </Link>
      <PostCard post={toCard(view.post)} linked={false} />
      <section className="mt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold">Comments</h2>
        <Thread comments={view.comments.map(toCommentData)} />
      </section>
    </>
  );
}
