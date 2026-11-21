"use client";
import type { ReactionKind } from "@humbled/domain";
import { useRef, useState } from "react";
import { applyReaction, REACTIONS, topReactions, type ReactionCounts } from "../lib/format.ts";

const KINDS = Object.keys(REACTIONS) as ReactionKind[];

/**
 * FR-8: one tap on 👍 agrees (or undoes your reaction); the ▾ button, or hovering on a
 * desktop, offers the other reactions. One reaction per post per viewer.
 */
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
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function set(next: ReactionKind | null) {
    if (busy || next === mine) return;
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

  const shown = mine ?? "like";
  const kinds = topReactions(counts.byKind);
  return (
    <div
      className="relative flex flex-wrap items-center gap-2"
      onMouseLeave={() => {
        clearTimeout(hover.current);
        hover.current = setTimeout(() => setOpen(false), 300);
      }}
    >
      <div className="flex items-stretch overflow-hidden rounded-full border border-line">
        <button
          type="button"
          onClick={() => void set(mine ? null : "like")}
          onMouseEnter={() => {
            clearTimeout(hover.current);
            hover.current = setTimeout(() => setOpen(true), 500);
          }}
          aria-pressed={mine !== null}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm transition ${
            mine ? "bg-pie-soft font-medium text-pie" : "text-muted hover:bg-paper hover:text-ink"
          }`}
        >
          <span aria-hidden className="text-base leading-none">
            {REACTIONS[shown].mark}
          </span>
          {REACTIONS[shown].label}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="More reactions"
          className="border-l border-line px-2 text-xs text-muted hover:bg-paper hover:text-ink"
        >
          ▾
        </button>
      </div>
      {counts.total > 0 ? (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <span aria-hidden className="flex -space-x-0.5 text-sm leading-none">
            {kinds.map((k) => (
              <span key={k} title={REACTIONS[k].label}>
                {REACTIONS[k].mark}
              </span>
            ))}
          </span>
          {counts.total}
        </span>
      ) : null}
      {open ? (
        <div
          role="group"
          aria-label="Choose a reaction"
          onMouseEnter={() => clearTimeout(hover.current)}
          className="absolute bottom-full left-0 z-10 mb-2 flex w-max max-w-[calc(100vw-4rem)] flex-wrap gap-1 rounded-2xl border border-line bg-card p-1.5 shadow-md"
        >
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void set(mine === k ? null : k)}
              aria-pressed={mine === k}
              title={REACTIONS[k].label}
              className={`flex flex-col items-center rounded-xl px-2 py-1 text-[11px] transition ${
                mine === k ? "bg-pie-soft text-pie" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              <span aria-hidden className="text-2xl leading-none transition hover:scale-125">
                {REACTIONS[k].mark}
              </span>
              {REACTIONS[k].label}
            </button>
          ))}
        </div>
      ) : null}
      {note ? <span className="w-full text-xs text-feud">{note}</span> : null}
    </div>
  );
}
