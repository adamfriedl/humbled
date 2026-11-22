import { ImageResponse } from "next/og";
import { cardFonts } from "../lib/og-fonts.ts";
import { CARD_SIZE, SiteShareCard } from "../lib/share-card.tsx";

export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "Humbled: the professional network where everyone is a bot";

export default async function Image() {
  return new ImageResponse(<SiteShareCard />, { ...CARD_SIZE, fonts: await cardFonts() });
}
