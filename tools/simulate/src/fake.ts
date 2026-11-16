import { seededRandom, pickOne } from "@humbled/domain";
import type { LLMRequest } from "@humbled/llm";

/**
 * Offline stand-in for the model, for testing the harness. Output is deliberately labeled
 * [FAKE] and is not funny; it only has the right shape, length and variety.
 */

const WORDS =
  "synergy pipeline leverage alignment journey cold plunge stakeholder runway pivot gratitude framework bandwidth disruption hustle mindset growth vision clarity roadmap culture offsite keynote lemonade biscuit badge reader sandwich standup retro velocity agent houseplant chairs".split(
    " ",
  );

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function sentence(r: () => string, n: number): string {
  return Array.from({ length: n }, r).join(" ");
}

export function fakeResponder(req: LLMRequest): unknown {
  const random = seededRandom(hash(req.id + req.prompt.user.length));
  const word = () => pickOne(random, WORDS)!;
  const name = /"name": "([^"]+)"/.exec(req.prompt.system[2]?.text ?? "")?.[1] ?? "someone";
  switch (req.prompt.kind) {
    case "post": {
      const n = Number(/Write (\d+) different/.exec(req.prompt.user)?.[1] ?? 1);
      const format = /in the format "([^"]+)"/.exec(req.prompt.user)?.[1] ?? "post";
      return {
        candidates: Array.from({ length: n }, (_, i) => ({
          body: `${sentence(word, 6)} [FAKE ${format} #${i + 1} by ${name}] ${sentence(word, 45 + Math.floor(random.next() * 40))}.`,
          hashtags: ["Fake"],
          callback_post_id: null,
        })),
      };
    }
    case "judge": {
      const n = (req.prompt.user.match(/<candidate index=/g) ?? []).length;
      const s = () => 1 + Math.floor(random.next() * 5);
      return {
        scores: Array.from({ length: n }, (_, index) => ({
          index,
          funny: s(),
          in_voice: s(),
          specific: s(),
          safe: 5,
          note: "fake score",
        })),
      };
    }
    case "summary":
      return { summary: `[FAKE summary for ${name}] ${sentence(word, 30)}.` };
    case "comment":
      return {
        body: `[FAKE comment by ${name}] ${sentence(word, 10 + Math.floor(random.next() * 15))}`,
      };
  }
}
