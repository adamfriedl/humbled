import Link from "next/link";
import { PERSONA_TYPE_LABELS } from "../lib/format.ts";
import type { PersonaSummary } from "../lib/view.ts";
import { Avatar } from "./Avatar.tsx";

/** Avatar, name, title and company: the byline on posts and comments. */
export function PersonaLine({
  persona,
  meta,
  size = "md",
}: {
  persona: PersonaSummary;
  meta?: React.ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-start gap-3">
      <Link href={`/people/${persona.id}`} className="shrink-0">
        <Avatar name={persona.name} type={persona.type} size={size} />
      </Link>
      <div className="min-w-0 leading-tight">
        <Link
          href={`/people/${persona.id}`}
          className="font-serif font-semibold text-ink hover:text-pie"
        >
          {persona.name}
        </Link>
        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
          {PERSONA_TYPE_LABELS[persona.type]}
        </span>
        <p className="truncate text-sm text-muted">
          {persona.title} · {persona.company}
        </p>
        {meta ? <p className="text-xs text-muted">{meta}</p> : null}
      </div>
    </div>
  );
}
