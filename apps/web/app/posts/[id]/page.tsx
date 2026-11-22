import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AboutStrip } from "../../../components/AboutStrip.tsx";
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
  const id = (await params).id;
  const view = await load(id);
  if (!view) return { title: "Post not found" };
  const { post } = view;
  const summary = post.body.replace(/\s+/g, " ").trim();
  const description = summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
  const title = `${post.author.name} on Humbled`;
  return {
    title: `${post.author.name}: "${summary.slice(0, 60)}…"`,
    description,
    alternates: { canonical: `/posts/${id}` },
    // The image comes from ./opengraph-image.tsx; Next adds it to both tags.
    openGraph: { type: "article", url: `/posts/${id}`, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PostPage({ params }: Props) {
  const view = await load((await params).id);
  if (!view) notFound();
  return (
    <>
      <AboutStrip />
      <PostCard post={toCard(view.post)} linked={false} />
      <section className="mt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold">Comments</h2>
        <Thread comments={view.comments.map(toCommentData)} />
      </section>
    </>
  );
}
