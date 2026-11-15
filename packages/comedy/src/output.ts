import { z } from "zod";
import type { Config } from "@humbled/config";
import { maxTrigramOverlap, opening, wordCount } from "./repetition.ts";

/** JSON Schemas for structured output. Kept to the supported subset (no numeric bounds). */
export const POST_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          body: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          callback_post_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["body", "hashtags", "callback_post_id"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

export const COMMENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: { body: { type: "string" } },
  required: ["body"],
  additionalProperties: false,
} as const;

export const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          funny: { type: "integer" },
          in_voice: { type: "integer" },
          specific: { type: "integer" },
          safe: { type: "integer" },
          note: { type: "string" },
        },
        required: ["index", "funny", "in_voice", "specific", "safe", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
} as const;

const hashtag = z
  .string()
  .transform((h) => h.trim().replace(/^#+/, ""))
  .pipe(z.string().regex(/^[\p{L}\p{N}_]{1,40}$/u));

export const PostCandidateSchema = z.object({
  body: z.string().min(1),
  hashtags: z.array(hashtag).max(3),
  callback_post_id: z.string().nullable(),
});
export type PostCandidate = z.infer<typeof PostCandidateSchema>;

export const PostOutputSchema = z.object({ candidates: z.array(z.unknown()).min(1) });
export const CommentOutputSchema = z.object({ body: z.string().min(1) });

const score = z.number().int().min(1).max(5);
export const JudgeScoreSchema = z.object({
  index: z.number().int().nonnegative(),
  funny: score,
  in_voice: score,
  specific: score,
  safe: score,
  note: z.string(),
});
export type JudgeScore = z.infer<typeof JudgeScoreSchema>;
export const JudgeOutputSchema = z.object({ scores: z.array(JudgeScoreSchema) });

export type CandidateRejection =
  "schema" | "length" | "repetition" | "copied_example" | "bad_callback";

export interface ParsedPostOutput {
  accepted: PostCandidate[];
  rejected: { reason: CandidateRejection; candidate: unknown }[];
}

function withinLength(
  text: string,
  range: { min: number; max: number },
  tolerance: number,
): boolean {
  const n = wordCount(text);
  return (
    n >= Math.floor(range.min * (1 - tolerance)) && n <= Math.ceil(range.max * (1 + tolerance))
  );
}

/**
 * Validate a post generation response. Candidates are judged individually: one bad candidate
 * doesn't sink the others. Throws only if the envelope itself is malformed (caller retries once).
 */
export function parsePostOutput(
  raw: unknown,
  opts: {
    config: Config["comedy"];
    recentPosts: readonly string[];
    allowedCallbackIds: ReadonlySet<string>;
    /** Few-shot/golden texts the model must not copy (house-bot canon echoes some of them). */
    referenceTexts?: readonly string[];
  },
): ParsedPostOutput {
  const envelope = PostOutputSchema.parse(raw);
  const out: ParsedPostOutput = { accepted: [], rejected: [] };
  const recentOpenings = new Set(opts.recentPosts.map((p) => opening(p)));
  for (const candidate of envelope.candidates) {
    const parsed = PostCandidateSchema.safeParse(candidate);
    if (!parsed.success) {
      out.rejected.push({ reason: "schema", candidate });
      continue;
    }
    const c = parsed.data;
    if (!withinLength(c.body, opts.config.postWords, opts.config.lengthTolerance)) {
      out.rejected.push({ reason: "length", candidate });
    } else if (
      recentOpenings.has(opening(c.body)) ||
      maxTrigramOverlap(c.body, opts.recentPosts) > opts.config.maxTrigramOverlap
    ) {
      out.rejected.push({ reason: "repetition", candidate });
    } else if (
      maxTrigramOverlap(c.body, opts.referenceTexts ?? []) > opts.config.maxTrigramOverlap
    ) {
      out.rejected.push({ reason: "copied_example", candidate });
    } else if (c.callback_post_id !== null && !opts.allowedCallbackIds.has(c.callback_post_id)) {
      out.rejected.push({ reason: "bad_callback", candidate });
    } else {
      out.accepted.push(c);
    }
  }
  return out;
}

/** Validate a comment response; returns undefined if it should be dropped. */
export function parseCommentOutput(raw: unknown, config: Config["comedy"]): string | undefined {
  const parsed = CommentOutputSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const body = parsed.data.body.trim();
  return withinLength(body, config.commentWords, config.lengthTolerance) ? body : undefined;
}
