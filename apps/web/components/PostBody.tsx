"use client";
import { useState } from "react";
import { excerpt } from "../lib/format.ts";

/**
 * A post's text. In feeds, a long post shows its first few lines and "…more" (the genre's
 * favourite engagement trick); a post's own page shows it whole.
 */
export function PostBody({
  body,
  hashtags,
  clamp,
}: {
  body: string;
  hashtags: string[];
  clamp: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const short = excerpt(body);
  const collapsed = clamp && !expanded && short.truncated;
  return (
    <>
      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">
        {/* Drop trailing dots so "sandwich." doesn't become "sandwich.…" */}
        {collapsed ? short.text.replace(/[.…]+$/, "") : body.trim()}
        {collapsed ? (
          <>
            {"… "}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="font-medium text-muted hover:text-pie hover:underline"
            >
              more
            </button>
          </>
        ) : null}
      </div>
      {!collapsed && hashtags.length > 0 ? (
        <p className="mt-3 text-sm text-pie">{hashtags.join(" ")}</p>
      ) : null}
    </>
  );
}
