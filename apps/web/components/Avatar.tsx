import type { PersonaType } from "@humbled/domain";
import { initials } from "../lib/format.ts";

// A colour per persona type, so a feed reads as a cast of characters at a glance.
const TONES: Record<PersonaType, string> = {
  hustle_bro: "bg-[#2f2a24] text-[#f6f1e7]",
  ai_evangelist: "bg-[#3d5a4c] text-[#f0f5ef]",
  recruiter: "bg-[#c9a227] text-[#1c1a17]",
  perma_founder: "bg-[#8a4b2a] text-[#fff4ea]",
  grateful_layoff: "bg-[#6c7a5b] text-[#f6f7f0]",
  thought_leader: "bg-[#5b4a72] text-[#f5f0fa]",
  middle_manager: "bg-[#9a8f80] text-[#1c1a17]",
  gen_z_disruptor: "bg-[#d9480f] text-[#fff8f3]",
};

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
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-serif font-semibold ${dims} ${TONES[type]}`}
    >
      {initials(name)}
    </span>
  );
}
