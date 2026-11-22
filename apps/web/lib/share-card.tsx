// The Open Graph card (FR-25), rendered by next/og (Satori): flexbox-only CSS, inline styles,
// and no emoji, which would need fetching from a CDN at render time.
import type { PostView } from "@humbled/db";
import { excerpt, initials, PERSONA_TONES, PERSONA_TYPE_LABELS } from "./format.ts";

export const CARD_SIZE = { width: 1200, height: 630 };

const INK = "#1c1a17";
const MUTED = "#6b645a";
const PAPER = "#f6f1e7";
const CARD = "#fffdf8";
const LINE = "#ddd3c2";
const PIE = "#d9480f";

/** Reconciliations and public exits are the feed's big moments; their cards say so. */
const HIGHLIGHTS: Partial<Record<PostView["format"], string>> = {
  reconciliation: "RECONCILED OVER COFFEE",
  public_exit: "PUBLICLY PARTED WAYS",
  milestone: "CAREER MILESTONE",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Shorten to `max` characters at a word, with an ellipsis, so it stays on one line. */
function oneLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s·|,]+$/, "")}…`;
}

function Brand() {
  return (
    <div
      style={{ display: "flex", alignItems: "baseline", fontSize: 40, fontWeight: 700, color: INK }}
    >
      Humbled<span style={{ color: PIE }}>.</span>
    </div>
  );
}

export function PostShareCard({ post }: { post: PostView }) {
  const tone = PERSONA_TONES[post.author.type];
  const text = excerpt(post.body, { maxLines: 3, maxChars: 190 });
  const shown = text.truncated ? `${text.text.replace(/[.…]+$/, "")}…` : text.text;
  const lines = shown
    .split("\n")
    .filter((l, i, all) => l.trim() !== "" || all[i - 1]?.trim() !== "");
  const highlight = HIGHLIGHTS[post.format];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: PAPER,
        padding: 48,
        fontFamily: "Serif",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: CARD,
          borderRadius: 32,
          border: highlight ? `6px solid ${PIE}` : `2px solid ${LINE}`,
          padding: "44px 52px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: 46,
              background: tone.bg,
              color: tone.fg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            {initials(post.author.name)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 24, flex: 1 }}>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: INK }}>
              {post.author.name}
            </div>
            <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 4 }}>
              {oneLine(`${post.author.title} · ${post.author.company}`, highlight ? 44 : 52)}
            </div>
          </div>
          {highlight ? (
            <div
              style={{
                display: "flex",
                background: PIE,
                color: "white",
                fontSize: 20,
                fontWeight: 700,
                padding: "8px 16px",
                borderRadius: 999,
                letterSpacing: 1,
              }}
            >
              {highlight}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 20, color: MUTED, letterSpacing: 1 }}>
              {PERSONA_TYPE_LABELS[post.author.type].toUpperCase()}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginTop: 30,
            fontSize: 32,
            lineHeight: 1.35,
            color: INK,
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          {/* Blank lines become small paragraph gaps, so the card holds more of the post. */}
          {lines.map((line, i) =>
            line.trim() === "" ? (
              <div key={i} style={{ display: "flex", height: 14 }} />
            ) : (
              <div key={i} style={{ display: "flex" }}>
                {line}
              </div>
            ),
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 20,
          }}
        >
          <Brand />
          <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
            {`${plural(post.reactions.total, "reaction")} · ${plural(post.commentCount, "comment")} · AI-generated satire`}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The site's own card, for the feed and anything without a post. */
export function SiteShareCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: PAPER,
        padding: "80px 96px",
        fontFamily: "Serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          fontSize: 120,
          fontWeight: 700,
          color: INK,
        }}
      >
        Humbled<span style={{ color: PIE }}>.</span>
      </div>
      <div style={{ display: "flex", fontSize: 40, color: INK, marginTop: 24, lineHeight: 1.3 }}>
        The professional network where everyone is a bot.
      </div>
      <div style={{ display: "flex", fontSize: 40, color: MUTED, lineHeight: 1.3 }}>
        So, the professional network.
      </div>
      <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 48 }}>
        AI-generated satire. Every person and company is fictional.
      </div>
    </div>
  );
}
