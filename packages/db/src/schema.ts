// Drizzle schema for the PRD data model ("Architecture and data model"). Enums come from the
// domain's own constants so the database can't drift from the code. Ids are text: house bots
// use their content slugs ("brock-halvorsen"), everything else a UUID.
import { PERSONA_TYPES, POST_FORMATS, REACTION_KINDS, RELATIONSHIP_STAGES } from "@humbled/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const personaType = pgEnum("persona_type", PERSONA_TYPES);
export const postFormat = pgEnum("post_format", POST_FORMATS);
export const reactionKind = pgEnum("reaction_kind", REACTION_KINDS);
export const relationshipStage = pgEnum("relationship_stage", RELATIONSHIP_STAGES);
export const postingFrequency = pgEnum("posting_frequency", ["low", "normal", "high"]);
export const actorType = pgEnum("actor_type", ["bot", "human"]);
export const actionType = pgEnum("action_type", [
  "post",
  "comment",
  "reply",
  "react",
  "follow",
  "endorse",
]);
export const actionStatus = pgEnum("action_status", ["pending", "done", "dropped"]);
export const batchPurpose = pgEnum("batch_purpose", ["tick", "nightly"]);
export const batchStatus = pgEnum("batch_status", ["submitted", "collected", "failed"]);
export const transport = pgEnum("transport", ["realtime", "batch"]);
export const callType = pgEnum("call_type", [
  "post",
  "comment",
  "summary",
  "judge",
  "relationshipNote",
]);

/** Embedding width: Vertex AI text embeddings (the default Embedder) are 768-dimensional. */
export const EMBEDDING_DIMENSIONS = 768;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const uuidId = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`);

export const owners = pgTable("owners", {
  id: text("id").primaryKey(), // the owner cookie
  emailHash: text("email_hash"),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const personas = pgTable(
  "personas",
  {
    id: uuidId(),
    ownerId: text("owner_id").references(() => owners.id),
    type: personaType("type").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    origin: text("origin").notNull(),
    avatar: text("avatar"),
    isHouse: boolean("is_house").notNull().default(false),
    frequency: postingFrequency("frequency").notNull().default("normal"),
    activityMultiplier: real("activity_multiplier").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("personas_owner_idx").on(t.ownerId)],
);

export const personaMemory = pgTable("persona_memory", {
  personaId: text("persona_id")
    .primaryKey()
    .references(() => personas.id, { onDelete: "cascade" }),
  /** Append-only via career events: family, employers, facts, subtext. */
  canon: jsonb("canon").notNull().default({}),
  careerSummary: text("career_summary"),
  greatestHits: text("greatest_hits").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const relationships = pgTable(
  "relationships",
  {
    aId: text("a_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    bId: text("b_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    affinity: real("affinity").notNull(),
    stage: relationshipStage("stage").notNull().default("neutral"),
    stageSince: timestamp("stage_since", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes").array().notNull().default([]),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.aId, t.bId] }), index("relationships_b_idx").on(t.bId)],
);

export const worldEvents = pgTable("world_events", {
  /** The content id (content/world/events.yaml). */
  id: text("id").primaryKey(),
  /** The day it ran; null until published. One event per day. */
  date: date("date").unique(),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
});

export const posts = pgTable(
  "posts",
  {
    id: uuidId(),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    format: postFormat("format").notNull(),
    body: text("body").notNull(),
    hashtags: text("hashtags").array().notNull().default([]),
    eventId: text("event_id").references(() => worldEvents.id),
    callbackPostId: text("callback_post_id"),
    /** Persona this post's grudge content is aimed at, if any (escalation ladder). */
    grudgeTargetId: text("grudge_target_id").references(() => personas.id),
    /** Judge scores ({ funny, in_voice, specific, safe }), filled by the nightly job. */
    judgeScore: jsonb("judge_score"),
    engagementScore: doublePrecision("engagement_score").notNull().default(0),
    /** Drives the similar-take trigger. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    index("posts_persona_created_idx").on(t.personaId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuidId(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** 0 for a top-level comment; capped at 3 (FR quotas). */
    depth: smallint("depth").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_post_idx").on(t.postId, t.createdAt),
    index("comments_persona_idx").on(t.personaId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    kind: reactionKind("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.actorType, t.actorId] })],
);

export const follows = pgTable(
  "follows",
  {
    fromId: text("from_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
);

export const endorsements = pgTable(
  "endorsements",
  {
    fromId: text("from_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId, t.skill] })],
);

export const careerEvents = pgTable(
  "career_events",
  {
    id: uuidId(),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("career_events_persona_idx").on(t.personaId, t.createdAt)],
);

export const nudges = pgTable(
  "nudges",
  {
    id: uuidId(),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => owners.id),
    kind: text("kind").notNull(),
    targetPersonaId: text("target_persona_id").references(() => personas.id),
    createdAt: createdAt(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("nudges_persona_idx").on(t.personaId, t.createdAt)],
);

/** Idempotency: a redelivered tick can't plan or write the same action twice. */
export const actions = pgTable(
  "actions",
  {
    tickId: text("tick_id").notNull(),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    actionType: actionType("action_type").notNull(),
    status: actionStatus("status").notNull().default("pending"),
    /** The planned action, so /collect can commit a generation result against it. */
    plan: jsonb("plan").notNull(),
    batchId: text("batch_id"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.personaId, t.actionType] }),
    index("actions_batch_idx").on(t.batchId),
  ],
);

export const llmBatches = pgTable("llm_batches", {
  id: uuidId(),
  providerBatchId: text("provider_batch_id").notNull().unique(),
  purpose: batchPurpose("purpose").notNull(),
  status: batchStatus("status").notNull().default("submitted"),
  /** Per-request context keyed by custom_id (action key, call type), for /collect. */
  requests: jsonb("requests").notNull().default({}),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    callType: callType("call_type").notNull(),
    model: text("model").notNull(),
    transport: transport("transport").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estCostUsd: doublePrecision("est_cost_usd").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("spend_ledger_created_idx").on(t.createdAt)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuidId(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reporterId: text("reporter_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("reports_once_idx").on(t.targetType, t.targetId, t.reporterId),
    index("reports_open_idx").on(t.resolvedAt),
  ],
);
