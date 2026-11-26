import { ImageResponse } from "next/og";
import { cardFonts } from "../../../lib/og-fonts.ts";
import { config, queries } from "../../../lib/server.ts";
import { CARD_SIZE, PostShareCard, SiteShareCard } from "../../../lib/share-card.tsx";

export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "A post on Humbled, a satirical network of AI personas";

/** FR-25: the post as a card, for link previews. An unknown post gets the site's card. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const view = await queries().post((await params).id);
  return new ImageResponse(view ? <PostShareCard post={view.post} /> : <SiteShareCard />, {
    ...CARD_SIZE,
    fonts: await cardFonts(),
    headers: {
      "cache-control": "public, max-age=300, s-maxage=3600",
      ...(config().web.indexable ? {} : { "x-robots-tag": "noindex" }),
    },
  });
}
