import type { JudgeScore, PersonaCard, RelationshipContext } from "@humbled/comedy";
import type { ContentBundle, HouseBot, RelationshipSeed } from "@humbled/content";
import { toPlannerProfile } from "@humbled/content";
import {
  MS_PER_DAY,
  type DailyCounts,
  type PersonaState,
  type PersonaTypeProfile,
  type PostFormat,
  type ReactionKind,
  type Relationship,
  type StageTransition,
} from "@humbled/domain";
import { houseBotCard } from "@humbled/comedy";

export interface SimPost {
  id: string;
  authorId: string;
  format: PostFormat;
  body: string;
  hashtags: string[];
  createdAt: Date;
  day: number;
  judge?: JudgeScore;
  /** Other accepted candidates the judge passed over. */
  losers: { body: string; judge?: JudgeScore }[];
  worldEventId?: string;
  grudgeTargetId?: string;
  callbackPostId?: string;
  reactions: Map<string, ReactionKind>;
  commentIds: string[];
  engagementScore: number;
}

export interface SimComment {
  id: string;
  postId: string;
  parentId?: string;
  authorId: string;
  body: string;
  depth: number;
  createdAt: Date;
  grudge: boolean;
}

export interface SimPersona {
  card: PersonaCard;
  state: PersonaState;
  profile: PersonaTypeProfile;
  careerSummary?: string;
  /** Newest first. */
  recentPostIds: string[];
  countsByDay: Map<number, DailyCounts>;
  following: Set<string>;
  endorsed: Set<string>;
  lastRepliedAt: Map<string, Date>;
  repliedTo: Set<string>;
  reactedToEventOnDay: Set<number>;
  /** Ladder posts owed after a nightly transition. */
  pendingStagePosts: { format: "public_exit" | "reconciliation"; targetId: string }[];
}

export interface SimRelationship {
  rel: Relationship;
  history?: string;
}

export interface TransitionLog {
  day: number;
  fromId: string;
  toId: string;
  transition: StageTransition;
}

export const relKey = (from: string, to: string) => `${from}|${to}`;

export class World {
  readonly personas = new Map<string, SimPersona>();
  readonly relationships = new Map<string, SimRelationship>();
  readonly posts = new Map<string, SimPost>();
  readonly comments = new Map<string, SimComment>();
  readonly transitions: TransitionLog[] = [];
  private nextId = 1;

  constructor(
    readonly content: ContentBundle,
    readonly start: Date,
  ) {}

  id(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  dayOf(d: Date): number {
    return Math.floor((d.getTime() - this.start.getTime()) / MS_PER_DAY);
  }

  addHouseBot(bot: HouseBot): void {
    const mod = this.content.personaTypes.get(bot.type);
    if (!mod) throw new Error(`unknown type ${bot.type}`);
    this.personas.set(bot.id, {
      card: houseBotCard(bot),
      state: { id: bot.id, type: bot.type, isHouse: true, frequency: bot.frequency },
      profile: toPlannerProfile(mod),
      recentPostIds: [],
      countsByDay: new Map(),
      following: new Set(),
      endorsed: new Set(),
      lastRepliedAt: new Map(),
      repliedTo: new Set(),
      reactedToEventOnDay: new Set(),
      pendingStagePosts: [],
    });
  }

  seedRelationship(seed: RelationshipSeed): void {
    const side = (from: string, to: string, s: RelationshipSeed["a_to_b"], notes: string[]) => {
      this.relationships.set(relKey(from, to), {
        rel: {
          from,
          to,
          affinity: s.affinity,
          stage: s.stage,
          stageSince: new Date(this.start.getTime() - s.days_in_stage * MS_PER_DAY),
          notes,
        },
        history: seed.history,
      });
    };
    // Notes are written from a's perspective first, then b's, in the seed file; give each side
    // the notes that mention the other by name, falling back to all of them.
    const nameOf = (id: string) => this.personas.get(id)?.card.name.split(" ")[0] ?? id;
    const about = (other: string) =>
      seed.notes.filter((n) => n.toLowerCase().includes(nameOf(other).toLowerCase()));
    side(seed.a, seed.b, seed.a_to_b, about(seed.b).length ? about(seed.b) : seed.notes);
    side(seed.b, seed.a, seed.b_to_a, about(seed.a));
  }

  persona(id: string): SimPersona {
    const p = this.personas.get(id);
    if (!p) throw new Error(`unknown persona ${id}`);
    return p;
  }

  counts(personaId: string, day: number): DailyCounts {
    const p = this.persona(personaId);
    let c = p.countsByDay.get(day);
    if (!c) {
      c = { posts: 0, comments: 0, nudges: 0 };
      p.countsByDay.set(day, c);
    }
    return c;
  }

  relationshipsFrom(id: string): SimRelationship[] {
    return [...this.relationships.values()].filter((r) => r.rel.from === id);
  }

  relationship(from: string, to: string): SimRelationship | undefined {
    return this.relationships.get(relKey(from, to));
  }

  context(r: SimRelationship): RelationshipContext {
    return {
      otherId: r.rel.to,
      otherName: this.persona(r.rel.to).card.name,
      stage: r.rel.stage,
      affinity: r.rel.affinity,
      ...(r.history ? { history: r.history } : {}),
      notes: r.rel.notes,
    };
  }

  recentPosts(personaId: string, n: number): SimPost[] {
    return this.persona(personaId)
      .recentPostIds.slice(0, n)
      .map((id) => this.posts.get(id)!)
      .filter(Boolean);
  }

  commentsOn(postId: string): SimComment[] {
    return (this.posts.get(postId)?.commentIds ?? []).map((id) => this.comments.get(id)!);
  }
}
