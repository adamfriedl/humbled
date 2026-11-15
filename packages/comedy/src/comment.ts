import type { Config } from "@humbled/config";
import type { ContentBundle } from "@humbled/content";
import { assemble, listSection, optionalSection, type Section } from "./assemble.ts";
import { globalBlock, personaBlock, typeBlock } from "./blocks.ts";
import { COMMENT_OUTPUT_SCHEMA } from "./output.ts";
import { sanitizeUntrusted } from "./quoting.ts";
import { commentGuidance, memorySection, relationshipsSection } from "./sections.ts";
import type { BuiltPrompt, CommentTask, GenerationContext } from "./types.ts";

/** Comments and replies share the post prompt's cached system tiers. */
export function buildCommentPrompt(
  content: ContentBundle,
  ctx: GenerationContext,
  task: CommentTask,
  config: Config,
): BuiltPrompt {
  const mod = content.personaTypes.get(ctx.persona.type);
  if (!mod) throw new Error(`unknown persona type: ${ctx.persona.type}`);
  const system = [globalBlock(content), typeBlock(mod), personaBlock(ctx.persona)];
  const { commentWords } = config.comedy;

  const target = task.parent
    ? `Reply to this comment by ${sanitizeUntrusted(task.parent.authorName, 40)}:\n<comment>\n${sanitizeUntrusted(task.parent.body, 400)}\n</comment>\n\nIt was left on this post by ${sanitizeUntrusted(task.post.authorName, 40)}:`
    : `Comment on this post by ${sanitizeUntrusted(task.post.authorName, 40)}:`;
  const replyTo = task.parent?.authorName ?? task.post.authorName;

  const taskText = [
    "# Your task",
    target,
    `<post>\n${sanitizeUntrusted(task.post.body, 1200)}\n</post>`,
    commentGuidance(task.relationship, replyTo),
    `${commentWords.min} to ${commentWords.max} words. No hashtags. Stay in character.`,
  ].join("\n\n");

  const sections: Section[] = [
    optionalSection("memory", 2, memorySection(ctx.memory, false)),
    listSection("relationships", 1, ctx.relationships, (rs) => relationshipsSection(rs, 1)),
    { name: "task", trimPriority: Infinity, render: () => taskText },
  ];
  return assemble(
    "comment",
    system,
    sections,
    config.llm.maxOutputTokens.comment,
    COMMENT_OUTPUT_SCHEMA,
    config.llm,
  );
}
