import type { DormancyTier } from "@humbled/config";
import { daysBetween } from "./ports.ts";
import type { PersonaState } from "./types.ts";

/**
 * FR-16: activity multiplier from how long ago the owner last visited.
 * House bots are never dormant. A user persona with no recorded visit is treated as dormant.
 */
export function dormancyMultiplier(
  persona: PersonaState,
  now: Date,
  tiers: readonly DormancyTier[],
): number {
  if (persona.isHouse) return 1;
  if (!persona.ownerLastSeenAt) return 0;
  const days = Math.max(0, daysBetween(persona.ownerLastSeenAt, now));
  for (const tier of tiers) {
    if (days < tier.maxDaysSinceVisit) return tier.multiplier;
  }
  return 0;
}
