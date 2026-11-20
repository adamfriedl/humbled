"use client";
import type { ReactionKind } from "@humbled/domain";
import { useState } from "react";
import { applyReaction, REACTIONS, topReactions, type ReactionCounts } from "../lib/format.ts";

/** FR-8: the post's reaction summary, and the viewer's own reaction (one per post). */
export function ReactionBar({
  postId,
  initial,
  initialMine,
}: {
  postId: string;
  initial: ReactionCounts;
  initialMine: ReactionKind | undefined;
}) {
  const [counts, setCounts] = useState(initial);
  const [mine, setMine] = useState<ReactionKind | null>(initialMine ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function choose(kind: ReactionKind) {
    if (busy) return;
    const next = kind === mine ? null : kind;
    const before = { counts, mine };
    setCounts(applyReaction(counts, mine, next));
    setMine(next);
    setOpen(false);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/posts/${postId}/reaction`, {
        method: next ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        ...(next ? { body: JSON.stringify({ kind: next }) } : {}),
      });
      const body = (await res.json()) as {
        reactions?: ReactionCounts;
        mine?: ReactionKind | null;
        error?: string;
      };
      if (!res.ok || !body.reactions) throw new Error(body.error ?? "That didn't go through.");
      setCounts(body.reactions);
      setMine(body.mine ?? null);
    } catch (e) {
      setCounts(before.counts);
      setMine(before.mine);
      setNote(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const kinds = topReactions(counts.byKind);
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`rounded-full border px-3 py-1 text-sm transition ${
          mine
            ? "border-pie bg-pie-soft text-pie"
            : "border-line text-muted hover:border-ink hover:text-ink"
        }`}
      >
        {mine ? `${REACTIONS[mine].mark} ${REACTIONS[mine].label}` : "React"}
      </button>
      <span className="flex items-center gap-1" aria-hidden>
        {kinds.map((k) => (
          <span
            key={k}
            title={REACTIONS[k].label}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-pie-soft text-[11px] text-pie"
          >
            {REACTIONS[k].mark}
          </span>
        ))}
      </span>
      <span className="text-sm text-muted">
        {counts.total} {counts.total === 1 ? "reaction" : "reactions"}
      </span>
      {open ? (
        <div
          role="group"
          aria-label="Choose a reaction"
          className="absolute bottom-full left-0 z-10 mb-2 flex w-max max-w-[calc(100vw-4rem)] flex-wrap gap-1 rounded-2xl border border-line bg-card p-1 shadow-md"
        >
          {(Object.keys(REACTIONS) as ReactionKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void choose(k)}
              aria-pressed={mine === k}
              title={REACTIONS[k].label}
              className={`rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${
                mine === k ? "bg-pie text-white" : "hover:bg-pie-soft hover:text-pie"
              }`}
            >
              {REACTIONS[k].mark} {REACTIONS[k].label}
            </button>
          ))}
        </div>
      ) : null}
      {note ? <span className="w-full text-xs text-feud">{note}</span> : null}
    </div>
  );
}
