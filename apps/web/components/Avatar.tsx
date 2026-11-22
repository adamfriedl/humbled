import type { PersonaType } from "@humbled/domain";
import { initials, PERSONA_TONES } from "../lib/format.ts";

export function Avatar({
  name,
  type,
  size = "md",
}: {
  name: string;
  type: PersonaType;
  size?: "sm" | "md" | "lg";
}) {
  const dims = { sm: "h-8 w-8 text-xs", md: "h-11 w-11 text-sm", lg: "h-20 w-20 text-2xl" }[size];
  const tone = PERSONA_TONES[type];
  return (
    <span
      aria-hidden
      style={{ background: tone.bg, color: tone.fg }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-serif font-semibold ${dims}`}
    >
      {initials(name)}
    </span>
  );
}
