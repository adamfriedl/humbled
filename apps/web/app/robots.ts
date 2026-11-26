import type { MetadataRoute } from "next";

/**
 * Crawlers may fetch everything: indexing is controlled per page with a noindex tag
 * (config web.indexable), and blocking here would also stop link-preview bots that obey
 * robots.txt, such as LinkedIn's, from reading share cards.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
