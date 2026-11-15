import type { Config } from "@humbled/config";
import type { ContentBundle } from "@humbled/content";
import type { Random } from "@humbled/domain";
import { assemble, listSection, optionalSection, type Section } from "./assemble.ts";
import { globalBlock, personaBlock, typeBlock } from "./blocks.ts";
import { pickFewShot } from "./fewshot.ts";
import { POST_OUTPUT_SCHEMA } from "./output.ts";
import { sanitizeUntrusted } from "./quoting.ts";
import {
  feedSection,
  fewShotSection,
  grudgeGuidance,
  memorySection,
  relationshipsSection,
} from "./sections.ts";
import type { BuiltPrompt, GenerationContext, PostTask } from "./types.ts";

export function buildPostPrompt(
  content: ContentBundle,
  ctx: GenerationContext,
  task: PostTask,
  random: Random,
  config: Config,
  candidates = config.comedy.postCandidates,
): BuiltPrompt {
  const mod = content.personaTypes.get(ctx.persona.type);
  if (!mod) throw new Error(`unknown persona type: ${ctx.persona.type}`);
  const format = content.formats[task.format];
  if (!format) throw new Error(`no instructions for format: ${task.format}`);

  const system = [globalBlock(content), typeBlock(mod), personaBlock(ctx.persona)];
  const examples = pickFewShot(
    content.golden,
    ctx.persona.type,
    config.comedy.fewShotExamples,
    random,
  );
  const { postWords } = config.comedy;

  const taskLines = [
    `# Your task`,
    `Write ${candidates === 1 ? "a post" : `${candidates} different candidate posts`} in the format "${format.label}".`,
    format.instructions.trim(),
  ];
  if (task.worldEvent) {
    taskLines.push(
      `Today's industry news (fictional):\n<news>\n${sanitizeUntrusted(task.worldEvent.headline, 200)}\n${sanitizeUntrusted(task.worldEvent.body, 400)}\n</news>`,
    );
  }
  if (task.milestone) taskLines.push(`The milestone: ${sanitizeUntrusted(task.milestone, 200)}`);
  if (task.grudgeTarget) taskLines.push(grudgeGuidance(task.grudgeTarget));
  if (task.callback) {
    taskLines.push(
      `You may call back to your own earlier post (id ${task.callback.postId}) if it makes this funnier; set callback_post_id to that id if you do, otherwise null:\n<earlier_post>\n${sanitizeUntrusted(task.callback.body, 900)}\n</earlier_post>`,
    );
  } else {
    taskLines.push("Set callback_post_id to null.");
  }
  if (candidates > 1) {
    taskLines.push(
      `Make the ${candidates} candidates genuinely different takes: different premises and different specific details, not variations of one joke.`,
    );
  }
  taskLines.push(
    `Each post: ${postWords.min} to ${postWords.max} words. Put hashtags (0 to 3, without the # sign) in the hashtags field, not in the body.`,
  );

  const sections: Section[] = [
    optionalSection("memory", 4, memorySection(ctx.memory, true)),
    listSection("relationships", 5, ctx.relationships, (rs) => relationshipsSection(rs, 2), 1),
    listSection("feed", 1, ctx.feed.slice(0, config.comedy.promptFeedItems), feedSection),
    listSection("few_shot", 2, examples, fewShotSection, 1),
    { name: "task", trimPriority: Infinity, render: () => taskLines.join("\n\n") },
  ];

  return assemble(
    "post",
    system,
    sections,
    config.llm.maxOutputTokens.post * candidates,
    POST_OUTPUT_SCHEMA,
    config.llm,
  );
}
