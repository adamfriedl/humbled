import type { HouseBot } from "@humbled/content";
import type { PersonaCard } from "./types.ts";

export function houseBotCard(bot: HouseBot): PersonaCard {
  return {
    id: bot.id,
    type: bot.type,
    name: bot.name,
    title: bot.title,
    company: bot.company,
    origin: bot.origin,
    canon: { family: bot.canon.family, employers: bot.canon.employers, facts: bot.canon.facts },
    subtext: bot.subtext,
  };
}
