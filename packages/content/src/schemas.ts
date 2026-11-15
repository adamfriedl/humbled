import { z } from "zod";
import { PERSONA_TYPES, POST_FORMATS, REACTION_KINDS, RELATIONSHIP_STAGES } from "@humbled/domain";

export const CAREER_EVENT_KINDS = [
  "layoff",
  "promotion",
  "startup_founded",
  "pivot",
  "acquisition",
  "book_deal",
] as const;
export type CareerEventKind = (typeof CAREER_EVENT_KINDS)[number];

const personaType = z.enum(PERSONA_TYPES);
const format = z.enum(POST_FORMATS);
const rate = z.number().min(0).max(1);
const weight = z.number().nonnegative();

export const PersonaTypeModuleSchema = z
  .object({
    type: personaType,
    label: z.string().min(1),
    voice: z.string().min(50),
    tics: z.array(z.string().min(1)).min(3),
    avoid: z.array(z.string().min(1)).default([]),
    /** The first joke everyone thinks of for this type. A post may use one as texture, never as its premise. */
    obvious_jokes: z.array(z.string().min(1)).min(2),
    comment_style: z.string().min(20),
    arc: z.string().min(20),
    skills: z.array(z.string().min(1)).min(3),
    career_event_weights: z.partialRecord(z.enum(CAREER_EVENT_KINDS), weight),
    action_rates: z.strictObject({
      post: rate,
      comment: rate,
      reply: rate,
      react: rate,
      follow: rate,
      endorse: rate,
    }),
    format_weights: z.partialRecord(format, weight),
    reaction_weights: z.partialRecord(z.enum(REACTION_KINDS), weight),
  })
  .strict();
export type PersonaTypeModule = z.infer<typeof PersonaTypeModuleSchema>;

export const FormatGuideSchema = z.record(
  format,
  z.strictObject({ label: z.string().min(1), instructions: z.string().min(20) }),
);
export type FormatGuide = z.infer<typeof FormatGuideSchema>;

export const CompanySchema = z.strictObject({
  name: z.string().min(1).max(40),
  industry: z.string().min(1),
  vibe: z.string().min(1),
});
export type Company = z.infer<typeof CompanySchema>;

export const WorldEventSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  launch: z.boolean().optional(),
  headline: z.string().min(10).max(140),
  body: z.string().min(10),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

export const NudgeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  career_event: z.enum(CAREER_EVENT_KINDS).optional(),
  target: z.literal("persona").optional(),
  affinity_delta: z.number().min(-1).max(1).optional(),
});
export type Nudge = z.infer<typeof NudgeSchema>;

export const GoldenPostSchema = z
  .strictObject({
    id: z.string().min(1),
    type: personaType,
    format,
    approved: z.boolean(),
    /** Laugh-out-loud: used as the judge's calibration examples for a 5 on "funny". */
    anchor: z.boolean().optional(),
    /** What makes it land. Shown to the judge alongside anchors. */
    why: z.string().min(1).optional(),
    body: z.string().min(1),
  })
  .refine((g) => !g.anchor || (g.approved && g.why), {
    message: "an anchor must be approved and have a `why`",
  });
export type GoldenPost = z.infer<typeof GoldenPostSchema>;

export const HouseBotSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: personaType,
  name: z.string().min(2).max(40),
  title: z.string().min(1).max(90),
  company: z.string().min(1).max(40),
  origin: z.string().min(1).max(140),
  frequency: z.enum(["low", "normal", "high"]),
  canon: z.strictObject({
    family: z.array(z.string().min(1)).default([]),
    employers: z.array(z.string().min(1)).min(1),
    facts: z.array(z.string().min(1)).default([]),
  }),
  /**
   * What the persona never says outright but leaks into everything. The gap between this and
   * the persona's confident surface is where the self-undercut comes from.
   */
  subtext: z.string().min(10),
});
export type HouseBot = z.infer<typeof HouseBotSchema>;

const RelationshipSideSchema = z.strictObject({
  affinity: z.number().min(-1).max(1),
  stage: z.enum(RELATIONSHIP_STAGES),
  days_in_stage: z.number().nonnegative(),
});

export const RelationshipSeedSchema = z.strictObject({
  a: z.string().min(1),
  b: z.string().min(1),
  a_to_b: RelationshipSideSchema,
  b_to_a: RelationshipSideSchema,
  history: z.string().min(10),
  notes: z.array(z.string().min(1)).default([]),
});
export type RelationshipSeed = z.infer<typeof RelationshipSeedSchema>;
