/** Core domain types. Pure data, no I/O. */

export type PersonaId = string;
export type PostId = string;
export type CommentId = string;

export const PERSONA_TYPES = [
  "hustle_bro",
  "ai_evangelist",
  "recruiter",
  "perma_founder",
  "grateful_layoff",
  "thought_leader",
  "middle_manager",
  "gen_z_disruptor",
] as const;
export type PersonaType = (typeof PERSONA_TYPES)[number];

export const POST_FORMATS = [
  "lesson",
  "humblebrag",
  "contrarian",
  "hiring_story",
  "listicle",
  "vulnerability",
  "vague_post",
  "event_reaction",
  "milestone",
  "public_exit",
  "reconciliation",
] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

/**
 * Formats that are only produced by specific triggers (grudge stage, world event, career
 * event, ladder transition), never by ordinary weighted selection.
 */
export const TRIGGERED_FORMATS: ReadonlySet<PostFormat> = new Set([
  "vague_post",
  "event_reaction",
  "milestone",
  "public_exit",
  "reconciliation",
]);

export const REACTION_KINDS = [
  "like",
  "celebrate",
  "insightful",
  "support",
  "love",
  "curious",
] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export type PostingFrequency = "low" | "normal" | "high";

/** The escalation ladder (PRD "Escalation ladder"). `neutral` is the resting state. */
export const RELATIONSHIP_STAGES = [
  "neutral",
  "cold",
  "vague_posting",
  "comment_war",
  "public_exit",
  "reconciled",
] as const;
export type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];

/** Directed relationship: how `from` feels about `to`. */
export interface Relationship {
  from: PersonaId;
  to: PersonaId;
  /** -1 (nemesis) .. 1 (pod partner). */
  affinity: number;
  stage: RelationshipStage;
  stageSince: Date;
  notes: string[];
}

/** Per-type behavioral tuning, loaded from content/personas/*.yaml. */
export interface PersonaTypeProfile {
  type: PersonaType;
  /** Per-tick base probabilities, before multipliers. */
  actionRates: {
    post: number;
    comment: number;
    reply: number;
    react: number;
    follow: number;
    endorse: number;
  };
  /** Relative format weights; formats absent or 0 are never picked for this type. */
  formatWeights: Partial<Record<PostFormat, number>>;
  /** Relative reaction preferences. */
  reactionWeights: Partial<Record<ReactionKind, number>>;
}

export interface PersonaState {
  id: PersonaId;
  type: PersonaType;
  isHouse: boolean;
  frequency: PostingFrequency;
  /** Only for user personas; drives dormancy. */
  ownerLastSeenAt?: Date;
}

/** Actions taken today, for quotas. */
export interface DailyCounts {
  posts: number;
  comments: number;
  nudges: number;
}

export interface FeedItem {
  postId: PostId;
  authorId: PersonaId;
  engagementScore: number;
  createdAt: Date;
}

export interface CommentRef {
  commentId: CommentId;
  postId: PostId;
  authorId: PersonaId;
  depth: number;
  /** Author of the comment this one replies to, if any. */
  parentAuthorId?: PersonaId;
}

export type PlannedAction =
  | {
      kind: "post";
      personaId: PersonaId;
      format: PostFormat;
      /** Relationship to draw grudge content from, if any. */
      grudgeTargetId?: PersonaId;
      worldEventId?: string;
    }
  | {
      kind: "comment";
      personaId: PersonaId;
      postId: PostId;
      postAuthorId: PersonaId;
      grudge: boolean;
    }
  | {
      kind: "reply";
      personaId: PersonaId;
      postId: PostId;
      parentCommentId: CommentId;
      parentAuthorId: PersonaId;
      depth: number;
    }
  | { kind: "react"; personaId: PersonaId; postId: PostId; reaction: ReactionKind }
  | { kind: "follow"; personaId: PersonaId; targetId: PersonaId }
  | { kind: "endorse"; personaId: PersonaId; targetId: PersonaId };

export type ActionKind = PlannedAction["kind"];

/** Actions that require an LLM call (FR-14). */
export const GENERATIVE_ACTIONS: ReadonlySet<ActionKind> = new Set(["post", "comment", "reply"]);
