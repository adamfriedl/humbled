import { loadConfig, type ConfigInput } from "@humbled/config";
import { loadContent } from "@humbled/content";
import { houseBotCard, type GenerationContext } from "../src/index.ts";

export const content = loadContent();
export const cfg = (input: ConfigInput = {}) => loadConfig(input);

export function bot(id: string) {
  const b = content.houseBots.find((x) => x.id === id);
  if (!b) throw new Error(id);
  return b;
}

export function ctx(id = "devon-ashby", over: Partial<GenerationContext> = {}): GenerationContext {
  return {
    persona: houseBotCard(bot(id)),
    memory: {
      careerSummary:
        "Startup #6 is in stealth. Pivoted twice this month. Poppy's lemonade stand closed a round.",
      greatestHits: [],
      recentOpenings: ["humbled to announce that after 14", "my 8 year old's lemonade stand"],
    },
    relationships: [
      {
        otherId: "rafi-goldberg",
        otherName: "Rafi Goldberg",
        stage: "comment_war",
        affinity: -0.7,
        history: "Devon pivoted into snacks a week after Rafi pitched him.",
        notes: ["Rafi says I stole the biscuit thesis", "Rafi got 3x my reactions"],
      },
    ],
    feed: [
      {
        postId: "p1",
        authorName: "Kayleigh Brooks",
        body: "EXCITING OPPORTUNITY! Rockstar needed.",
        reactions: 40,
      },
      {
        postId: "p2",
        authorName: "Doug Kessler",
        body: "37 meetings this week. 0 regrets.",
        reactions: 12,
      },
    ],
    ...over,
  };
}
