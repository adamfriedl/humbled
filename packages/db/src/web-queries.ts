// Read side for the web app: the feed, post pages and profiles. The worker writes the world
// through Repositories; the web app only reads it here (plus human reactions, later).
import type { PersonaType, PostFormat, ReactionKind, RelationshipStage } from "@humbled/domain";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import {
  careerEvents,
  comments,
  endorsements,
  follows,
  personaMemory,
  personas,
  posts,
  reactions,
  relationships,
} from "./schema.ts";

export interface PersonaSummary {
  id: string;
  name: string;
  title: string;
  company: string;
  type: PersonaType;
  avatar: string | null;
  isHouse: boolean;
}

export interface PostView {
  id: string;
  body: string;
  hashtags: string[];
  format: PostFormat;
  createdAt: Date;
  engagementScore: number;
  author: PersonaSummary;
  reactions: { total: number; byKind: Partial<Record<ReactionKind, number>> };
  commentCount: number;
}

export interface CommentView {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  createdAt: Date;
  author: PersonaSummary;
}

export interface FeedPage {
  posts: PostView[];
  /** Pass back to get the next page; absent on the last page. */
  nextCursor?: string;
}

export interface Rivalry {
  persona: PersonaSummary;
  stage: RelationshipStage;
  affinity: number;
}

export interface ProfileView {
  persona: PersonaSummary & { origin: string; createdAt: Date };
  careerSummary: string | null;
  employers: string[];
  followers: number;
  following: number;
  endorsements: { skill: string; count: number }[];
  rivalries: Rivalry[];
  careerEvents: { kind: string; details: unknown; createdAt: Date }[];
}

const summaryColumns = {
  id: personas.id,
  name: personas.name,
  title: personas.title,
  company: personas.company,
  type: personas.type,
  avatar: personas.avatar,
  isHouse: personas.isHouse,
};

const postColumns = {
  id: posts.id,
  body: posts.body,
  hashtags: posts.hashtags,
  format: posts.format,
  createdAt: posts.createdAt,
  engagementScore: posts.engagementScore,
  author: summaryColumns,
};

type PostRow = Omit<PostView, "reactions" | "commentCount">;

/** Latest-feed cursor: the last post's (createdAt, id), so equal timestamps page stably. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!iso || !id) return undefined;
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id };
}

export class WebQueries {
  constructor(private readonly db: Db) {}

  /** FR-7 "Latest": newest first, keyset-paginated. An invalid cursor starts from the top. */
  async latest(opts: { cursor?: string; limit: number; personaId?: string }): Promise<FeedPage> {
    const after = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    const conditions = [];
    if (after) {
      conditions.push(
        or(
          lt(posts.createdAt, after.createdAt),
          and(eq(posts.createdAt, after.createdAt), lt(posts.id, after.id)),
        ),
      );
    }
    if (opts.personaId) conditions.push(eq(posts.personaId, opts.personaId));
    const rows = await this.db
      .select(postColumns)
      .from(posts)
      .innerJoin(personas, eq(posts.personaId, personas.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      posts: await this.withCounts(page),
      ...(rows.length > opts.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.id) }
        : {}),
    };
  }

  /**
   * FR-7 "Trending": posts from the last `windowDays`, by engagement score (which already
   * carries the judge's cringe bonus, FR-9). The cursor is an offset: scores move between
   * requests, so a keyset would skip or repeat posts just the same.
   */
  async trending(opts: {
    cursor?: string;
    limit: number;
    now: Date;
    windowDays: number;
  }): Promise<FeedPage> {
    const offset = Math.max(0, Number.parseInt(opts.cursor ?? "0", 10) || 0);
    const since = new Date(opts.now.getTime() - opts.windowDays * 86_400_000);
    const rows = await this.db
      .select(postColumns)
      .from(posts)
      .innerJoin(personas, eq(posts.personaId, personas.id))
      .where(gte(posts.createdAt, since))
      .orderBy(desc(posts.engagementScore), desc(posts.createdAt), desc(posts.id))
      .limit(opts.limit + 1)
      .offset(offset);
    const page = rows.slice(0, opts.limit);
    return {
      posts: await this.withCounts(page),
      ...(rows.length > opts.limit ? { nextCursor: String(offset + opts.limit) } : {}),
    };
  }

  /** A post and its whole comment thread (oldest first; the page nests it by parentId). */
  async post(id: string): Promise<{ post: PostView; comments: CommentView[] } | undefined> {
    const [row] = await this.db
      .select(postColumns)
      .from(posts)
      .innerJoin(personas, eq(posts.personaId, personas.id))
      .where(eq(posts.id, id));
    if (!row) return undefined;
    const [post] = await this.withCounts([row]);
    const thread = await this.db
      .select({
        id: comments.id,
        parentId: comments.parentId,
        depth: comments.depth,
        body: comments.body,
        createdAt: comments.createdAt,
        author: summaryColumns,
      })
      .from(comments)
      .innerJoin(personas, eq(comments.personaId, personas.id))
      .where(eq(comments.postId, id))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return { post: post!, comments: thread };
  }

  /** FR-10/FR-11: everything on a profile except the activity feed (use `latest`). */
  async profile(id: string, opts: { rivalries: number }): Promise<ProfileView | undefined> {
    const [row] = await this.db
      .select({
        ...summaryColumns,
        origin: personas.origin,
        createdAt: personas.createdAt,
        canon: personaMemory.canon,
        careerSummary: personaMemory.careerSummary,
      })
      .from(personas)
      .leftJoin(personaMemory, eq(personaMemory.personaId, personas.id))
      .where(eq(personas.id, id));
    if (!row) return undefined;
    const { canon, careerSummary, ...persona } = row;

    const count = async (column: typeof follows.toId | typeof follows.fromId) => {
      const [r] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(follows)
        .where(eq(column, id));
      return r?.n ?? 0;
    };
    const skillCount = sql<number>`count(*)::int`;
    const [followers, following, endorsed, rivals, events] = await Promise.all([
      count(follows.toId),
      count(follows.fromId),
      this.db
        .select({ skill: endorsements.skill, count: skillCount })
        .from(endorsements)
        .where(eq(endorsements.toId, id))
        .groupBy(endorsements.skill)
        .orderBy(desc(skillCount), asc(endorsements.skill)),
      // The feuds worth showing: furthest down the ladder first (lowest affinity).
      this.db
        .select({
          persona: summaryColumns,
          stage: relationships.stage,
          affinity: relationships.affinity,
        })
        .from(relationships)
        .innerJoin(personas, eq(relationships.bId, personas.id))
        .where(and(eq(relationships.aId, id), ne(relationships.stage, "neutral")))
        .orderBy(asc(relationships.affinity))
        .limit(opts.rivalries),
      this.db
        .select({
          kind: careerEvents.kind,
          details: careerEvents.details,
          createdAt: careerEvents.createdAt,
        })
        .from(careerEvents)
        .where(eq(careerEvents.personaId, id))
        .orderBy(desc(careerEvents.createdAt)),
    ]);

    const employers = (canon as { employers?: unknown } | null)?.employers;
    return {
      persona,
      careerSummary: careerSummary ?? null,
      employers: Array.isArray(employers) ? employers.filter((e) => typeof e === "string") : [],
      followers,
      following,
      endorsements: endorsed,
      rivalries: rivals,
      careerEvents: events,
    };
  }

  private async withCounts(rows: PostRow[]): Promise<PostView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [byKind, byPost] = await Promise.all([
      this.db
        .select({ postId: reactions.postId, kind: reactions.kind, n: sql<number>`count(*)::int` })
        .from(reactions)
        .where(inArray(reactions.postId, ids))
        .groupBy(reactions.postId, reactions.kind),
      this.db
        .select({ postId: comments.postId, n: sql<number>`count(*)::int` })
        .from(comments)
        .where(inArray(comments.postId, ids))
        .groupBy(comments.postId),
    ]);
    const commentsBy = new Map(byPost.map((r) => [r.postId, r.n]));
    return rows.map((r) => {
      const kinds = byKind.filter((k) => k.postId === r.id);
      return {
        ...r,
        reactions: {
          total: kinds.reduce((sum, k) => sum + k.n, 0),
          byKind: Object.fromEntries(kinds.map((k) => [k.kind, k.n])),
        },
        commentCount: commentsBy.get(r.id) ?? 0,
      };
    });
  }
}
