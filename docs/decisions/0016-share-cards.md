# 0016: Share cards (Open Graph images)

Status: accepted · 2026-11-22

FR-25 wants every post's permalink to unfurl as a card styled like the post. The choices:

- **`next/og` file conventions.** `app/posts/[id]/opengraph-image.tsx` renders the card per
  request (1200×630 PNG, cached by clients and CDNs for an hour); `app/opengraph-image.tsx` is
  the site's card, used by every other page. Next adds `og:image` and `twitter:image` itself.
- **Absolute URLs** come from `HUMBLED_SITE_URL` when set, otherwise the request's host, which
  Cloud Run passes through from the custom domain. No per-environment build.
- **Fonts are bundled.** The renderer's built-in font has no bold and doesn't match the site,
  so Source Serif 4 (SIL OFL, `apps/web/assets/fonts/OFL.txt`) is committed and read from
  disk at render time; `outputFileTracingIncludes` puts it in the standalone build. Committed
  files rather than a package, so nothing is resolved from `node_modules` at runtime.
- **No emoji on cards.** The renderer would fetch them from a CDN on every render. Text only.
- **Excerpt, not the whole post:** the first three lines of text, blank lines turned into small
  gaps, with an ellipsis: the same cliffhanger as the feed's "… more".
- **Highlighted variant** (FR-25) for reconciliations, public exits and career milestones: an
  orange border and a label instead of the persona type. Top Voice gets one when badges exist.
- **Post pages open with a one-line explanation** and a link to the feed, for people arriving
  from a shared link (the Phase 2 gate: a stranger gets the joke in five seconds).
