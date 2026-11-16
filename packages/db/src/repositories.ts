// Repositories: the worker's view of the database. Each method is one query (or one small
// transaction) so handlers stay readable and integration tests can cover them directly.
import type {
  ActionKind,
  CommentRef,
  DailyCounts,
  FeedItem,
  PersonaType,
  PlannedAction,
  PostFormat,
  PostingFrequency,
  ReactionKind,
  Relationship,
} from "@humbled/domain";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import {
  actions,
  comments,
  endorsements,
  follows,
  llmBatches,
  personaMemory,
  personas,
  posts,
  reactions,
  relationships,
  worldEvents,
} from "./schema.ts";

/** What's needed to create or refresh a house bot from content. */
export interface PersonaSeed {
  id: string;
  type: PersonaType;
  name: string;
  title: string;
  company: string;
  origin: string;
  frequency: PostingFrequency;
  canon: Record<string, unknown>;
}

export interface PersonaRow {
  id: string;
  type: PersonaType;
  name: string;
  title: string;
  company: string;
  origin: string;
  isHouse: boolean;
  frequency: PostingFrequency;
  activityMultiplier: number;
  ownerLastSeenAt: Date | null;
  canon: Record<string, unknown>;
  careerSummary: string | null;
}

export interface NewPost {
  personaId: string;
  format: PostFormat;
  body: string;
  hashtags?: string[];
  eventId?: string;
  callbackPostId?: string;
  grudgeTargetId?: string;
  createdAt?: Date;
}

export interface NewComment {
  postId: string;
  parentId?: string;
  personaId: string;
  body: string;
  depth: number;
  createdAt?: Date;
}

export interface ActionKey {
  tickId: string;
  personaId: string;
  actionType: ActionKind;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day bounds for `at`, matching the spend ledger's day. */
export function utcDay(at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export class Repositories {
  constructor(readonly db: Db) {}

  // ------------------------------------------------------------------ personas

  /** Insert house bots, or refresh their profile and canon from content (career summary kept). */
  async upsertHouseBots(seeds: readonly PersonaSeed[]): Promise<void> {
    if (seeds.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const s of seeds) {
        const profile = {
          type: s.type,
          name: s.name,
          title: s.title,
          company: s.company,
          origin: s.origin,
          frequency: s.frequency,
        };
        await tx
          .insert(personas)
          .values({ id: s.id, isHouse: true, ...profile })
          .onConflictDoUpdate({ target: personas.id, set: profile });
        await tx
          .insert(personaMemory)
          .values({ personaId: s.id, canon: s.canon })
          .onConflictDoUpdate({
            target: personaMemory.personaId,
            set: { canon: s.canon, updatedAt: sql`now()` },
          });
      }
    });
  }

  /** Every persona with its memory. Dormancy is applied by the caller (domain). */
  async listPersonas(): Promise<PersonaRow[]> {
    const rows = await this.db.query.personas.findMany({ orderBy: asc(personas.id) });
    const memories = await this.db.select().from(personaMemory);
    const byId = new Map(memories.map((m) => [m.personaId, m]));
    const owners = await this.db.query.owners.findMany();
    const seen = new Map(owners.map((o) => [o.id, o.lastSeenAt]));
    return rows.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      title: p.title,
      company: p.company,
      origin: p.origin,
      isHouse: p.isHouse,
      frequency: p.frequency,
      activityMultiplier: p.activityMultiplier,
      ownerLastSeenAt: p.ownerId ? (seen.get(p.ownerId) ?? null) : null,
      canon: (byId.get(p.id)?.canon as Record<string, unknown> | undefined) ?? {},
      careerSummary: byId.get(p.id)?.careerSummary ?? null,
    }));
  }

  async setCareerSummary(personaId: string, summary: string): Promise<void> {
    await this.db
      .insert(personaMemory)
      .values({ personaId, careerSummary: summary })
      .onConflictDoUpdate({
        target: personaMemory.personaId,
        set: { careerSummary: summary, updatedAt: sql`now()` },
      });
  }

  // -------------------------------------------------------------- relationships

  /** Seed a relationship only if it doesn't exist yet (content seeds never overwrite history). */
  async seedRelationship(r: Relationship): Promise<void> {
    await this.db
      .insert(relationships)
      .values(relationshipRow(r))
      .onConflictDoNothing({ target: [relationships.aId, relationships.bId] });
  }

  async saveRelationship(r: Relationship, lastEventAt?: Date): Promise<void> {
    const row = { ...relationshipRow(r), ...(lastEventAt ? { lastEventAt } : {}) };
    await this.db
      .insert(relationships)
      .values(row)
      .onConflictDoUpdate({ target: [relationships.aId, relationships.bId], set: row });
  }

  async relationshipsFrom(personaId: string): Promise<Relationship[]> {
    const rows = await this.db.select().from(relationships).where(eq(relationships.aId, personaId));
    return rows.map((r) => ({
      from: r.aId,
      to: r.bId,
      affinity: r.affinity,
      stage: r.stage,
      stageSince: r.stageSince,
      notes: r.notes,
    }));
  }

  // ---------------------------------------------------------------------- feed

  async insertPost(p: NewPost): Promise<string> {
    const [row] = await this.db
      .insert(posts)
      .values({
        personaId: p.personaId,
        format: p.format,
        body: p.body,
        hashtags: p.hashtags ?? [],
        eventId: p.eventId ?? null,
        callbackPostId: p.callbackPostId ?? null,
        grudgeTargetId: p.grudgeTargetId ?? null,
        ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      })
      .returning({ id: posts.id });
    return row!.id;
  }

  async insertComment(c: NewComment): Promise<string> {
    const [row] = await this.db
      .insert(comments)
      .values({
        postId: c.postId,
        parentId: c.parentId ?? null,
        personaId: c.personaId,
        body: c.body,
        depth: c.depth,
        ...(c.createdAt ? { createdAt: c.createdAt } : {}),
      })
      .returning({ id: comments.id });
    return row!.id;
  }

  /** Posts created in [since, now), newest first: the pool the planner's feed sample draws from. */
  async feedSince(since: Date): Promise<FeedItem[]> {
    const rows = await this.db
      .select({
        postId: posts.id,
        authorId: posts.personaId,
        engagementScore: posts.engagementScore,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .where(gte(posts.createdAt, since))
      .orderBy(desc(posts.createdAt));
    return rows;
  }

  async recentPostsBy(personaId: string, limit: number) {
    return this.db
      .select()
      .from(posts)
      .where(eq(posts.personaId, personaId))
      .orderBy(desc(posts.createdAt))
      .limit(limit);
  }

  async postsById(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(posts)
      .where(inArray(posts.id, [...ids]));
  }

  async commentsById(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(comments)
      .where(inArray(comments.id, [...ids]));
  }

  async setEngagementScore(postId: string, score: number): Promise<void> {
    await this.db.update(posts).set({ engagementScore: score }).where(eq(posts.id, postId));
  }

  async setJudgeScore(postId: string, score: Record<string, unknown>): Promise<void> {
    await this.db.update(posts).set({ judgeScore: score }).where(eq(posts.id, postId));
  }

  /** Posts this persona has left a top-level comment on (the planner skips them). */
  async commentedPostIds(personaId: string, since: Date): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ postId: comments.postId })
      .from(comments)
      .where(
        and(
          eq(comments.personaId, personaId),
          isNull(comments.parentId),
          gte(comments.createdAt, since),
        ),
      );
    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Comments by others on this persona's posts, and replies by others to this persona's
   * comments, since `since`: what the planner may reply to.
   */
  async replyCandidates(personaId: string, since: Date): Promise<CommentRef[]> {
    const rows = await this.db.execute<{
      id: string;
      post_id: string;
      persona_id: string;
      depth: number;
      parent_author: string | null;
    }>(sql`
      select c.id, c.post_id, c.persona_id, c.depth, parent.persona_id as parent_author
      from ${comments} c
      join ${posts} p on p.id = c.post_id
      left join ${comments} parent on parent.id = c.parent_id
      where c.created_at >= ${since}
        and c.persona_id <> ${personaId}
        and ((c.parent_id is null and p.persona_id = ${personaId})
             or parent.persona_id = ${personaId})
      order by c.created_at desc
    `);
    return rows.rows.map((r) => ({
      commentId: r.id,
      postId: r.post_id,
      authorId: r.persona_id,
      depth: Number(r.depth),
      ...(r.parent_author ? { parentAuthorId: r.parent_author } : {}),
    }));
  }

  /** Posts and comments (top-level and replies) a persona made on the UTC day of `at`. */
  async dailyCounts(personaId: string, at: Date): Promise<DailyCounts> {
    const { start, end } = utcDay(at);
    const [p] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(eq(posts.personaId, personaId), gte(posts.createdAt, start), lt(posts.createdAt, end)),
      );
    const [c] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(comments)
      .where(
        and(
          eq(comments.personaId, personaId),
          gte(comments.createdAt, start),
          lt(comments.createdAt, end),
        ),
      );
    return { posts: p?.n ?? 0, comments: c?.n ?? 0, nudges: 0 };
  }

  // ------------------------------------------------------------ code-only acts

  /** One reaction per actor and post: a repeat is a no-op. Returns whether it was new. */
  async react(postId: string, actorId: string, kind: ReactionKind, at?: Date): Promise<boolean> {
    const rows = await this.db
      .insert(reactions)
      .values({ postId, actorType: "bot", actorId, kind, ...(at ? { createdAt: at } : {}) })
      .onConflictDoNothing()
      .returning({ postId: reactions.postId });
    return rows.length > 0;
  }

  async follow(fromId: string, toId: string): Promise<boolean> {
    const rows = await this.db
      .insert(follows)
      .values({ fromId, toId })
      .onConflictDoNothing()
      .returning({ fromId: follows.fromId });
    return rows.length > 0;
  }

  async endorse(fromId: string, toId: string, skill: string): Promise<boolean> {
    const rows = await this.db
      .insert(endorsements)
      .values({ fromId, toId, skill })
      .onConflictDoNothing()
      .returning({ fromId: endorsements.fromId });
    return rows.length > 0;
  }

  async following(personaId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ toId: follows.toId })
      .from(follows)
      .where(eq(follows.fromId, personaId));
    return new Set(rows.map((r) => r.toId));
  }

  async endorsed(personaId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ toId: endorsements.toId })
      .from(endorsements)
      .where(eq(endorsements.fromId, personaId));
    return new Set(rows.map((r) => r.toId));
  }

  /** Reaction counts per post, for engagement rescoring. */
  async reactionCounts(postIds: readonly string[]): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.db
      .select({ postId: reactions.postId, n: sql<number>`count(*)::int` })
      .from(reactions)
      .where(inArray(reactions.postId, [...postIds]))
      .groupBy(reactions.postId);
    return new Map(rows.map((r) => [r.postId, r.n]));
  }

  // ----------------------------------------------------------------- actions

  /**
   * Claim an action for a tick. Returns false if it was already claimed (Pub/Sub redelivered
   * the tick), in which case the caller must skip it. This is the idempotency guarantee.
   */
  async claimAction(key: ActionKey, plan: PlannedAction): Promise<boolean> {
    const rows = await this.db
      .insert(actions)
      .values({ ...key, plan })
      .onConflictDoNothing()
      .returning({ tickId: actions.tickId });
    return rows.length > 0;
  }

  async finishAction(key: ActionKey, status: "done" | "dropped"): Promise<void> {
    await this.db
      .update(actions)
      .set({ status })
      .where(
        and(
          eq(actions.tickId, key.tickId),
          eq(actions.personaId, key.personaId),
          eq(actions.actionType, key.actionType),
        ),
      );
  }

  async attachBatch(keys: readonly ActionKey[], batchId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const k of keys) {
        await tx
          .update(actions)
          .set({ batchId })
          .where(
            and(
              eq(actions.tickId, k.tickId),
              eq(actions.personaId, k.personaId),
              eq(actions.actionType, k.actionType),
            ),
          );
      }
    });
  }

  async getAction(key: ActionKey) {
    const [row] = await this.db
      .select()
      .from(actions)
      .where(
        and(
          eq(actions.tickId, key.tickId),
          eq(actions.personaId, key.personaId),
          eq(actions.actionType, key.actionType),
        ),
      );
    return row;
  }

  // ----------------------------------------------------------------- batches

  async createBatch(
    providerBatchId: string,
    purpose: "tick" | "nightly",
    requests: Record<string, unknown>,
  ): Promise<string> {
    const [row] = await this.db
      .insert(llmBatches)
      .values({ providerBatchId, purpose, requests })
      .returning({ id: llmBatches.id });
    return row!.id;
  }

  async openBatches() {
    return this.db
      .select()
      .from(llmBatches)
      .where(eq(llmBatches.status, "submitted"))
      .orderBy(asc(llmBatches.submittedAt));
  }

  /**
   * Mark a batch collected, once. Returns false if another /collect already did, so two
   * overlapping runs can't both write its results.
   */
  async markBatch(id: string, status: "collected" | "failed", at: Date): Promise<boolean> {
    const rows = await this.db
      .update(llmBatches)
      .set({ status, completedAt: at })
      .where(and(eq(llmBatches.id, id), eq(llmBatches.status, "submitted")))
      .returning({ id: llmBatches.id });
    return rows.length > 0;
  }

  // ------------------------------------------------------------- world events

  /** Make sure every content event exists; existing rows (and their dates) are kept. */
  async syncWorldEvents(
    events: readonly { id: string; headline: string; body: string }[],
  ): Promise<void> {
    for (const e of events) {
      await this.db
        .insert(worldEvents)
        .values(e)
        .onConflictDoUpdate({
          target: worldEvents.id,
          set: { headline: e.headline, body: e.body },
        });
    }
  }

  /** The event published for a UTC day, if any. */
  async eventOn(day: string) {
    const [row] = await this.db.select().from(worldEvents).where(eq(worldEvents.date, day));
    return row;
  }

  /**
   * Publish the next unpublished event (in `order`) for `day`. Idempotent: if the day already
   * has an event, that one is returned. Returns undefined when every event has run.
   */
  async publishEvent(day: string, order: readonly string[]) {
    const existing = await this.eventOn(day);
    if (existing) return existing;
    const unpublished = await this.db
      .select({ id: worldEvents.id })
      .from(worldEvents)
      .where(isNull(worldEvents.date));
    const free = new Set(unpublished.map((r) => r.id));
    const next = order.find((id) => free.has(id));
    if (!next) return undefined;
    const [row] = await this.db
      .update(worldEvents)
      .set({ date: day })
      .where(and(eq(worldEvents.id, next), isNull(worldEvents.date)))
      .returning();
    // Lost a race with a concurrent publish for the same day: return the winner's event.
    return row ?? (await this.eventOn(day));
  }
}

function relationshipRow(r: Relationship) {
  return {
    aId: r.from,
    bId: r.to,
    affinity: r.affinity,
    stage: r.stage,
    stageSince: r.stageSince,
    notes: r.notes,
  };
}
