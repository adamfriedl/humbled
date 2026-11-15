import type { PersonaType, PostFormat, RelationshipStage } from "@humbled/domain";

/** A system-prompt block. `cache` marks a cache breakpoint after this block (CR-2). */
export interface PromptBlock {
  text: string;
  cache: boolean;
}

export type PromptKind = "post" | "comment" | "judge";

/** SDK-agnostic prompt. `packages/llm` maps it onto a Messages API request. */
export interface BuiltPrompt {
  kind: PromptKind;
  system: PromptBlock[];
  user: string;
  maxTokens: number;
  /** JSON Schema for structured output (`output_config.format`). */
  outputSchema: Record<string, unknown>;
  estimatedInputTokens: number;
  /** What the token budget forced out, for logging. */
  trimmed: string[];
}

/** Everything the model may know about a persona. User-supplied fields are untrusted (SR-1). */
export interface PersonaCard {
  id: string;
  type: PersonaType;
  name: string;
  title: string;
  company: string;
  origin?: string;
  canon: { family: string[]; employers: string[]; facts: string[] };
  /** House bots only: what leaks but is never said. */
  subtext?: string;
}

export interface PersonaMemory {
  careerSummary?: string;
  greatestHits: { postId: string; body: string }[];
  /** Newest first; used for repetition avoidance in the prompt (openings only). */
  recentOpenings: string[];
}

export interface RelationshipContext {
  otherId: string;
  otherName: string;
  stage: RelationshipStage;
  affinity: number;
  history?: string;
  notes: string[];
}

export interface FeedSampleItem {
  postId: string;
  authorName: string;
  body: string;
  reactions: number;
}

export interface GenerationContext {
  persona: PersonaCard;
  memory: PersonaMemory;
  /** Strongest relationships (FR-20: 2 to 3). */
  relationships: RelationshipContext[];
  feed: FeedSampleItem[];
}

export interface PostTask {
  format: PostFormat;
  worldEvent?: { headline: string; body: string };
  /** Rival or ally this post should carry grudge or callback content about. */
  grudgeTarget?: RelationshipContext;
  /** At most one eligible callback to the persona's own earlier post. */
  callback?: { postId: string; body: string };
  /** For milestone posts: what happened. */
  milestone?: string;
}

export interface CommentTask {
  post: { postId: string; authorName: string; body: string };
  /** When replying to a comment rather than the post. */
  parent?: { authorName: string; body: string };
  /** Relationship to whoever is being replied to, if any. */
  relationship?: RelationshipContext;
}

export interface JudgeCandidate {
  body: string;
}
