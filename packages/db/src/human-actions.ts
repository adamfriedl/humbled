// What humans can change from the web app: their reactions (FR-8), plus the bookkeeping that
// keeps it honest: owner rows (dormancy, later), rate limits (SR-5) and salted IP hashes (SR-8).
import { createHash, randomBytes } from "node:crypto";
import type { ReactionKind } from "@humbled/domain";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "./client.ts";
import { ipSalts, owners, posts, rateEvents, reactions } from "./schema.ts";

const DAY_MS = 86_400_000;
/** SR-8: IP salts (and so any hash made with them) live 30 days at most. */
const SALT_RETENTION_DAYS = 30;
/** Rate-limit windows are at most an hour; keep a day of events, then prune. */
const RATE_EVENT_RETENTION_MS = DAY_MS;

export class HumanActions {
  constructor(private readonly db: Db) {}

  /** Record that an owner cookie was seen (creates the owner on first sight). */
  async touchOwner(ownerId: string, at: Date): Promise<void> {
    await this.db
      .insert(owners)
      .values({ id: ownerId, createdAt: at, lastSeenAt: at })
      .onConflictDoUpdate({ target: owners.id, set: { lastSeenAt: at } });
  }

  /**
   * Set this owner's reaction on a post, replacing any earlier one (one per post per owner).
   * Returns false if the post doesn't exist.
   */
  async react(postId: string, ownerId: string, kind: ReactionKind, at: Date): Promise<boolean> {
    const [post] = await this.db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
    if (!post) return false;
    await this.db
      .insert(reactions)
      .values({ postId, actorType: "human", actorId: ownerId, kind, createdAt: at })
      .onConflictDoUpdate({
        target: [reactions.postId, reactions.actorType, reactions.actorId],
        set: { kind, createdAt: at },
      });
    return true;
  }

  async unreact(postId: string, ownerId: string): Promise<void> {
    await this.db
      .delete(reactions)
      .where(
        and(
          eq(reactions.postId, postId),
          eq(reactions.actorType, "human"),
          eq(reactions.actorId, ownerId),
        ),
      );
  }

  /** This owner's reactions on the given posts. */
  async reactionsOf(ownerId: string, postIds: readonly string[]) {
    if (postIds.length === 0) return new Map<string, ReactionKind>();
    const rows = await this.db
      .select({ postId: reactions.postId, kind: reactions.kind })
      .from(reactions)
      .where(
        and(
          eq(reactions.actorType, "human"),
          eq(reactions.actorId, ownerId),
          inArray(reactions.postId, [...postIds]),
        ),
      );
    return new Map(rows.map((r) => [r.postId, r.kind]));
  }

  /**
   * Count an action against `key` and say whether it's within `limit` per `windowMs`.
   * An action over the limit isn't recorded, so a blocked client doesn't extend its own ban.
   */
  async allow(key: string, limit: number, windowMs: number, at: Date): Promise<boolean> {
    const since = new Date(at.getTime() - windowMs);
    const [row] = await this.db
      .select({ n: count() })
      .from(rateEvents)
      .where(and(eq(rateEvents.key, key), gte(rateEvents.at, since)));
    if ((row?.n ?? 0) >= limit) return false;
    await this.db.insert(rateEvents).values({ key, at });
    return true;
  }

  /**
   * SR-8: a salted hash of an IP address, never the address itself. The salt changes every
   * UTC day, so hashes from different days can't be linked, and it's deleted after 30 days.
   */
  async hashIp(ip: string, at: Date): Promise<string> {
    const day = at.toISOString().slice(0, 10);
    await this.db
      .insert(ipSalts)
      .values({ day, salt: randomBytes(32).toString("hex"), createdAt: at })
      .onConflictDoNothing();
    const [row] = await this.db
      .select({ salt: ipSalts.salt })
      .from(ipSalts)
      .where(eq(ipSalts.day, day));
    return createHash("sha256").update(`${row!.salt}:${ip}`).digest("hex").slice(0, 32);
  }

  /** Delete expired salts and rate events. Cheap (indexed); safe to call on every request. */
  async prune(at: Date): Promise<void> {
    const saltCutoff = new Date(at.getTime() - SALT_RETENTION_DAYS * DAY_MS);
    await this.db.delete(ipSalts).where(lt(ipSalts.createdAt, saltCutoff));
    await this.db
      .delete(rateEvents)
      .where(lt(rateEvents.at, new Date(at.getTime() - RATE_EVENT_RETENTION_MS)));
  }
}
