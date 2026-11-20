// Shared pieces of the tick pipeline, over Postgres: relationship triggers, engagement
// rescoring, prompt context, and the batch request records /collect reads back.
import type {
  BuiltPrompt,
  FeedSampleItem,
  GenerationContext,
  PostCandidate,
  RelationshipContext,
} from "@humbled/comedy";
import type { ActionKey, PersonaRow, StoredRelationship } from "@humbled/db";
import {
  applyTrigger,
  newRelationship,
  strongestRelationships,
  type PlannedAction,
  type RelationshipTrigger,
} from "@humbled/domain";
import type { CallType, LLMRequest } from "@humbled/llm";
import { personaCard, type WorkerDeps } from "./deps.ts";

/** What /collect needs to finish a request, stored in llm_batches.requests by request id. */
export type RequestContext =
  | {
      stage: "post";
      key: ActionKey;
      action: Extract<PlannedAction, { kind: "post" }>;
      prompt: BuiltPrompt;
      attempt: number;
      recentBodies: string[];
      callbackIds: string[];
    }
  | {
      stage: "judge";
      key: ActionKey;
      action: Extract<PlannedAction, { kind: "post" }>;
      prompt: BuiltPrompt;
      attempt: number;
      candidates: PostCandidate[];
    }
  | {
      stage: "comment";
      key: ActionKey;
      action: Extract<PlannedAction, { kind: "comment" | "reply" }>;
      prompt: BuiltPrompt;
      attempt: number;
    }
  | { stage: "summary"; personaId: string; prompt: BuiltPrompt; attempt: number };

const CALL_TYPE: Record<RequestContext["stage"], CallType> = {
  post: "post",
  judge: "judge",
  comment: "comment",
  summary: "summary",
};

/** Turn contexts into batch requests with short ids (the batch API allows [A-Za-z0-9_-]{1,64}). */
export function toBatch(contexts: readonly RequestContext[]): {
  requests: LLMRequest[];
  byId: Record<string, RequestContext>;
} {
  const byId: Record<string, RequestContext> = {};
  const requests = contexts.map((ctx, i) => {
    const id = `r${i}_${ctx.stage}`;
    byId[id] = ctx;
    return { id, callType: CALL_TYPE[ctx.stage], prompt: ctx.prompt };
  });
  return { requests, byId };
}

/** One tick's view of personas and relationships, loaded once. */
export class Snapshot {
  readonly personas: Map<string, PersonaRow>;
  /** `${from}->${to}` */
  readonly relationships: Map<string, StoredRelationship>;

  constructor(personas: readonly PersonaRow[], relationships: readonly StoredRelationship[]) {
    this.personas = new Map(personas.map((p) => [p.id, p]));
    this.relationships = new Map(relationships.map((r) => [relKey(r.rel.from, r.rel.to), r]));
  }

  static async load(deps: WorkerDeps): Promise<Snapshot> {
    return new Snapshot(await deps.repos.listPersonas(), await deps.repos.allRelationships());
  }

  name(id: string): string {
    return this.personas.get(id)?.name ?? "someone";
  }

  relationshipsFrom(id: string) {
    return [...this.relationships.values()].filter((r) => r.rel.from === id).map((r) => r.rel);
  }

  context(from: string, to: string): RelationshipContext | undefined {
    const r = this.relationships.get(relKey(from, to));
    if (!r) return undefined;
    return {
      otherId: to,
      otherName: this.name(to),
      stage: r.rel.stage,
      affinity: r.rel.affinity,
      ...(r.history ? { history: r.history } : {}),
      notes: r.rel.notes,
    };
  }

  /**
   * Apply a relationship trigger to how `aggrieved` feels about `other` (FR-18), creating the
   * relationship if it's new, and save it.
   */
  async trigger(
    deps: WorkerDeps,
    aggrieved: string,
    other: string,
    trigger: RelationshipTrigger,
    now: Date,
  ): Promise<void> {
    if (aggrieved === other || !this.personas.has(aggrieved)) return;
    const key = relKey(aggrieved, other);
    const existing = this.relationships.get(key);
    const rel = applyTrigger(
      existing?.rel ?? newRelationship(aggrieved, other, now),
      trigger,
      deps.config.grudge,
    );
    this.relationships.set(key, { rel, history: existing?.history ?? null });
    await deps.repos.saveRelationship(rel, now);
  }

  /** Prompt context: card, memory, 2-3 strongest relationships, and the feed sample. */
  async generationContext(
    deps: WorkerDeps,
    personaId: string,
    feedPostIds: readonly string[],
  ): Promise<GenerationContext> {
    const p = this.personas.get(personaId)!;
    const rels = strongestRelationships(this.relationshipsFrom(personaId), 3)
      .map((r) => this.context(r.from, r.to))
      .filter((r): r is RelationshipContext => r !== undefined);
    const feedPosts = (await deps.repos.postsById(feedPostIds)).filter(
      (post) => post.personaId !== personaId,
    );
    const reactions = await deps.repos.reactionCounts(feedPosts.map((x) => x.id));
    const order = new Map(feedPostIds.map((id, i) => [id, i]));
    const feed: FeedSampleItem[] = feedPosts
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((post) => ({
        postId: post.id,
        authorName: this.name(post.personaId),
        body: post.body,
        reactions: reactions.get(post.id) ?? 0,
      }));
    const recent = await deps.repos.recentPostsBy(personaId, 5);
    return {
      persona: personaCard(p),
      memory: {
        ...(p.careerSummary ? { careerSummary: p.careerSummary } : {}),
        greatestHits: [],
        recentOpenings: recent.map((x) => x.body.split(/\s+/).slice(0, 6).join(" ")),
      },
      relationships: rels,
      feed,
    };
  }
}

export const relKey = (from: string, to: string) => `${from}->${to}`;

/** Recompute a post's engagement score from its reactions, comments and judge score. */
export async function rescore(deps: WorkerDeps, postId: string): Promise<void> {
  await deps.repos.rescore(postId, deps.config.engagement);
}
