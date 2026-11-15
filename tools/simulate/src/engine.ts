import {
  buildCommentPrompt,
  buildJudgePrompt,
  buildPostPrompt,
  buildSummaryPrompt,
  JudgeOutputSchema,
  parseCommentOutput,
  parsePostOutput,
  PromptBudgetError,
  selectBest,
  type BuiltPrompt,
  type CandidateRejection,
  type FeedSampleItem,
  type GenerationContext,
  type JudgeScore,
  type PostCandidate,
  type PostTask,
} from "@humbled/comedy";
import type { Config } from "@humbled/config";
import type { ContentBundle, WorldEvent } from "@humbled/content";
import {
  advanceDaily,
  applyTrigger,
  budgetDecision,
  chance,
  engagementScore,
  mirrorReconciliation,
  newRelationship,
  pickOne,
  planTick,
  sampleFeed,
  strongestRelationships,
  transitionPostFormat,
  MS_PER_DAY,
  MS_PER_MINUTE,
  type CommentRef,
  type PlannedAction,
  type Random,
  type RelationshipTrigger,
} from "@humbled/domain";
import {
  dayKey,
  estimateCostUsd,
  type CallType,
  type LLMClient,
  type LLMRequest,
  type LLMResult,
  type SpendLedger,
  type Transport,
} from "@humbled/llm";
import { relKey, World, type SimComment, type SimPost, type SimRelationship } from "./world.ts";

export interface SimOptions {
  personaIds: string[];
  days: number;
  start: Date;
  transport: Transport;
  concurrency: number;
  /** Hard cap on actual spend for the whole run. */
  maxUsd?: number;
}

export interface CallRecord {
  day: number;
  callType: CallType;
  ok: boolean;
  error?: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  projectedBatchCostUsd: number;
}

export interface SimStats {
  calls: CallRecord[];
  rejections: Record<
    CandidateRejection | "envelope" | "judge_unsafe" | "budget" | "llm_failure",
    number
  >;
  droppedActions: number;
}

/** Run `fn` over items with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A generation job: prompt(s) are built during planning (deterministic), then dispatched. */
interface PostJob {
  kind: "post";
  action: Extract<PlannedAction, { kind: "post" }>;
  task: PostTask;
  prompt: BuiltPrompt;
  recentBodies: string[];
  callbackIds: Set<string>;
}
interface CommentJob {
  kind: "comment";
  action: Extract<PlannedAction, { kind: "comment" | "reply" }>;
  prompt: BuiltPrompt;
}
type Job = PostJob | CommentJob;

export class Simulation {
  readonly world: World;
  readonly stats: SimStats = {
    calls: [],
    rejections: {
      schema: 0,
      length: 0,
      repetition: 0,
      copied_example: 0,
      bad_callback: 0,
      envelope: 0,
      judge_unsafe: 0,
      budget: 0,
      llm_failure: 0,
    },
    droppedActions: 0,
  };
  private readonly ticksPerDay: number;
  private readonly goldenBodies: string[];
  private requestCounter = 0;

  constructor(
    readonly content: ContentBundle,
    readonly config: Config,
    readonly llm: LLMClient,
    readonly ledger: SpendLedger,
    readonly random: Random,
    readonly options: SimOptions,
  ) {
    this.world = new World(content, options.start);
    this.ticksPerDay = Math.round((24 * 60) / config.tick.intervalMinutes);
    this.goldenBodies = content.golden.map((g) => g.body);
    const ids = new Set(options.personaIds);
    for (const bot of content.houseBots) if (ids.has(bot.id)) this.world.addHouseBot(bot);
    for (const seed of content.houseRelationships) {
      if (ids.has(seed.a) && ids.has(seed.b)) this.world.seedRelationship(seed);
    }
    this.initialRelationships = [...this.world.relationships.values()].map((r) => ({
      ...r,
      rel: { ...r.rel },
    }));
  }

  /** Snapshot of relationships before the first tick, for the transcript. */
  readonly initialRelationships: SimRelationship[];

  eventForDay(day: number): WorldEvent | undefined {
    const launch = this.content.events.find((e) => e.launch);
    const rest = this.content.events.filter((e) => !e.launch);
    const ordered = launch ? [launch, ...rest] : rest;
    return ordered[day % Math.max(1, ordered.length)];
  }

  /** Actual spend so far in this run (at the transport's real price). */
  spentUsd(): number {
    return this.stats.calls.reduce((s, c) => s + c.costUsd, 0);
  }

  /**
   * Run the simulation. Stops early, between ticks, once actual spend reaches `maxUsd`
   * (a hard cap per run, separate from the daily CR-7 budget). Returns whether it stopped early.
   */
  async run(onDay?: (day: number) => void): Promise<{ stoppedEarly: boolean }> {
    for (let day = 0; day < this.options.days; day++) {
      for (let tick = 0; tick < this.ticksPerDay; tick++) {
        if (this.options.maxUsd !== undefined && this.spentUsd() >= this.options.maxUsd) {
          this.stoppedAt = { day, tick };
          return { stoppedEarly: true };
        }
        await this.tick(day, tick);
      }
      await this.nightly(day);
      onDay?.(day);
    }
    return { stoppedEarly: false };
  }

  /** Where the run stopped, if the spend cap was hit. */
  stoppedAt?: { day: number; tick: number };

  /** Simulated days actually run (fractional if stopped early), for per-day metrics. */
  daysSimulated(): number {
    if (!this.stoppedAt) return this.options.days;
    return this.stoppedAt.day + this.stoppedAt.tick / this.ticksPerDay;
  }

  private now(day: number, tick: number): Date {
    return new Date(
      this.options.start.getTime() +
        day * MS_PER_DAY +
        tick * this.config.tick.intervalMinutes * MS_PER_MINUTE,
    );
  }

  // ---------------------------------------------------------------- tick

  async tick(day: number, tick: number): Promise<void> {
    const now = this.now(day, tick);
    const spent = await this.ledger.spentOn(dayKey(now), this.options.transport);
    const budget = budgetDecision(spent, this.config.budget);
    const event = this.eventForDay(day);
    const feedItems = [...this.world.posts.values()]
      .filter((p) => now.getTime() - p.createdAt.getTime() < 2 * MS_PER_DAY)
      .map((p) => ({
        postId: p.id,
        authorId: p.authorId,
        engagementScore: p.engagementScore,
        createdAt: p.createdAt,
      }));

    const jobs: Job[] = [];
    for (const persona of this.world.personas.values()) {
      const counts = this.world.counts(persona.card.id, day);
      const feed = sampleFeed(
        feedItems,
        this.config.planner.feedSampleSize,
        now,
        this.random,
        this.config.engagement,
      );
      const actions = planTick(
        {
          persona: persona.state,
          profile: persona.profile,
          counts,
          activityMultiplier: budget.activityMultiplier,
          generationAllowed: budget.mode !== "generation_paused",
          ...(event
            ? { worldEvent: { id: event.id, alreadyReacted: persona.reactedToEventOnDay.has(day) } }
            : {}),
          relationships: this.world.relationshipsFrom(persona.card.id).map((r) => r.rel),
          feed,
          recentFormats: this.world
            .recentPosts(persona.card.id, this.config.comedy.formatNoRepeatWindow)
            .map((p) => p.format),
          replyCandidates: this.replyCandidates(persona.card.id, now),
          lastRepliedAt: persona.lastRepliedAt,
          following: persona.following,
          endorsed: persona.endorsed,
          now,
        },
        this.random,
        this.config,
      );

      // Ladder posts owed from last night take priority over a planned post (quota permitting).
      const owed = persona.pendingStagePosts[0];
      if (
        owed &&
        budget.mode !== "generation_paused" &&
        counts.posts < this.config.quotas.postsPerDay &&
        tick >= this.ticksPerDay / 3
      ) {
        persona.pendingStagePosts.shift();
        const i = actions.findIndex((a) => a.kind === "post");
        const stagePost: PlannedAction = {
          kind: "post",
          personaId: persona.card.id,
          format: owed.format,
          grudgeTargetId: owed.targetId,
        };
        if (i >= 0) actions[i] = stagePost;
        else actions.unshift(stagePost);
      }

      for (const action of actions) {
        const job = this.applyOrPrepare(
          action,
          now,
          day,
          feed.map((f) => f.postId),
          event,
        );
        if (job) jobs.push(job);
      }
    }

    const outcomes = await mapLimit(jobs, this.options.concurrency, (j) => this.runJob(j, day));
    for (let i = 0; i < jobs.length; i++) this.commit(jobs[i]!, outcomes[i], now, day);
  }

  private replyCandidates(personaId: string, now: Date): CommentRef[] {
    const p = this.world.persona(personaId);
    const out: CommentRef[] = [];
    for (const c of this.world.comments.values()) {
      if (c.authorId === personaId || p.repliedTo.has(c.id)) continue;
      if (now.getTime() - c.createdAt.getTime() > MS_PER_DAY) continue;
      const post = this.world.posts.get(c.postId)!;
      const parent = c.parentId ? this.world.comments.get(c.parentId) : undefined;
      const onMyPost = post.authorId === personaId && !c.parentId;
      const replyToMe = parent?.authorId === personaId;
      if (onMyPost || replyToMe) {
        out.push({
          commentId: c.id,
          postId: c.postId,
          authorId: c.authorId,
          depth: c.depth,
          ...(parent ? { parentAuthorId: parent.authorId } : {}),
        });
      }
    }
    return out;
  }

  /** Code-only actions are applied now; generative actions become jobs. */
  private applyOrPrepare(
    action: PlannedAction,
    now: Date,
    day: number,
    feedIds: string[],
    event?: WorldEvent,
  ): Job | undefined {
    const p = this.world.persona(action.personaId);
    switch (action.kind) {
      case "react": {
        const post = this.world.posts.get(action.postId);
        if (!post || post.reactions.has(p.card.id)) return undefined;
        post.reactions.set(p.card.id, action.reaction);
        this.rescore(post);
        this.trigger(post.authorId, p.card.id, "receivedPositiveReaction", now);
        return undefined;
      }
      case "follow":
        p.following.add(action.targetId);
        return undefined;
      case "endorse":
        p.endorsed.add(action.targetId);
        return undefined;
      case "post":
        return this.preparePost(action, now, day, feedIds, event);
      case "comment":
      case "reply":
        return this.prepareComment(action, now);
    }
  }

  private generationContext(personaId: string, feedIds: string[]): GenerationContext {
    const p = this.world.persona(personaId);
    const rels = strongestRelationships(
      this.world.relationshipsFrom(personaId).map((r) => r.rel),
      3,
    ).map((r) => this.world.context(this.world.relationship(r.from, r.to)!));
    const feed: FeedSampleItem[] = feedIds
      .map((id) => this.world.posts.get(id)!)
      .filter((post) => post.authorId !== personaId)
      .map((post) => ({
        postId: post.id,
        authorName: this.world.persona(post.authorId).card.name,
        body: post.body,
        reactions: post.reactions.size,
      }));
    return {
      persona: p.card,
      memory: {
        ...(p.careerSummary ? { careerSummary: p.careerSummary } : {}),
        greatestHits: [],
        recentOpenings: this.world
          .recentPosts(personaId, 5)
          .map((post) => post.body.split(/\s+/).slice(0, 6).join(" ")),
      },
      relationships: rels,
      feed,
    };
  }

  private preparePost(
    action: Extract<PlannedAction, { kind: "post" }>,
    now: Date,
    day: number,
    feedIds: string[],
    event?: WorldEvent,
  ): PostJob | undefined {
    const p = this.world.persona(action.personaId);
    const task: PostTask = { format: action.format };
    if (action.format === "event_reaction" && event)
      task.worldEvent = { headline: event.headline, body: event.body };
    if (action.grudgeTargetId) {
      const r = this.world.relationship(p.card.id, action.grudgeTargetId);
      if (r) task.grudgeTarget = this.world.context(r);
    }
    // FR-20: at most one eligible callback: the persona's best earlier post, sometimes.
    const older = this.world.recentPosts(p.card.id, 20).filter((post) => post.day < day);
    const best = older.sort((a, b) => b.engagementScore - a.engagementScore)[0];
    if (
      best &&
      !task.grudgeTarget &&
      chance(this.random, this.config.comedy.grudgeOrCallbackShare)
    ) {
      task.callback = { postId: best.id, body: best.body };
    }
    const prompt = this.tryBuild(() =>
      buildPostPrompt(
        this.content,
        this.generationContext(p.card.id, feedIds),
        task,
        this.random,
        this.config,
      ),
    );
    if (!prompt) {
      this.stats.droppedActions++;
      return undefined;
    }
    return {
      kind: "post",
      action,
      task,
      prompt,
      recentBodies: this.world
        .recentPosts(p.card.id, this.config.comedy.repetitionWindow)
        .map((x) => x.body),
      callbackIds: new Set(task.callback ? [task.callback.postId] : []),
    };
  }

  private prepareComment(
    action: Extract<PlannedAction, { kind: "comment" | "reply" }>,
    _now: Date,
  ): CommentJob | undefined {
    const post = this.world.posts.get(action.postId);
    if (!post) return undefined;
    const target = action.kind === "reply" ? action.parentAuthorId : action.postAuthorId;
    const r = this.world.relationship(action.personaId, target);
    const parent =
      action.kind === "reply" ? this.world.comments.get(action.parentCommentId) : undefined;
    const prompt = this.tryBuild(() =>
      buildCommentPrompt(
        this.content,
        this.generationContext(action.personaId, []),
        {
          post: {
            postId: post.id,
            authorName: this.world.persona(post.authorId).card.name,
            body: post.body,
          },
          ...(parent
            ? {
                parent: {
                  authorName: this.world.persona(parent.authorId).card.name,
                  body: parent.body,
                },
              }
            : {}),
          ...(r ? { relationship: this.world.context(r) } : {}),
        },
        this.config,
      ),
    );
    if (!prompt) {
      this.stats.droppedActions++;
      return undefined;
    }
    return { kind: "comment", action, prompt };
  }

  /** Build a prompt; a prompt that can't fit the token budget drops the action (CR-4). */
  private tryBuild(build: () => BuiltPrompt): BuiltPrompt | undefined {
    try {
      return build();
    } catch (e) {
      if (e instanceof PromptBudgetError) {
        this.stats.rejections.budget++;
        return undefined;
      }
      throw e;
    }
  }

  // ------------------------------------------------------------ LLM calls

  private async call(callType: CallType, prompt: BuiltPrompt, day: number): Promise<LLMResult> {
    const req: LLMRequest = { id: `r${++this.requestCounter}_${callType}`, callType, prompt };
    const result = await this.llm.complete(req);
    const usage = result.usage ?? {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    };
    const model = this.config.llm.models[callType];
    const costUsd = estimateCostUsd(usage, model, this.options.transport, this.config.llm);
    await this.ledger.record({
      callType,
      model,
      transport: this.options.transport,
      usage,
      estCostUsd: costUsd,
      at: this.now(day, 0),
    });
    this.stats.calls.push({
      day,
      callType,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
      ...usage,
      costUsd,
      projectedBatchCostUsd: estimateCostUsd(usage, model, "batch", this.config.llm),
    });
    return result;
  }

  /** Call, retrying once on failure or malformed output (PRD: retry once, then drop). */
  private async callParsed<T>(
    callType: CallType,
    prompt: BuiltPrompt,
    day: number,
    parse: (json: unknown) => T | undefined,
  ): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.call(callType, prompt, day);
      if (!r.ok) {
        this.stats.rejections.llm_failure++;
        continue;
      }
      try {
        const parsed = parse(r.json);
        if (parsed !== undefined) return parsed;
      } catch {
        this.stats.rejections.envelope++;
      }
    }
    return undefined;
  }

  private async runJob(job: Job, day: number): Promise<unknown> {
    if (job.kind === "comment") {
      return this.callParsed("comment", job.prompt, day, (json) =>
        parseCommentOutput(json, this.config.comedy),
      );
    }
    const accepted = await this.callParsed("post", job.prompt, day, (json) => {
      const out = parsePostOutput(json, {
        config: this.config.comedy,
        recentPosts: job.recentBodies,
        allowedCallbackIds: job.callbackIds,
        referenceTexts: this.goldenBodies,
      });
      for (const r of out.rejected) this.stats.rejections[r.reason]++;
      return out.accepted.length ? out.accepted : undefined;
    });
    if (!accepted) return undefined;
    const judgePrompt = this.tryBuild(() =>
      buildJudgePrompt(
        this.content,
        this.world.persona(job.action.personaId).card.type,
        job.action.format,
        accepted,
        this.config,
      ),
    );
    const scores = judgePrompt
      ? await this.callParsed(
          "judge",
          judgePrompt,
          day,
          (json) => JudgeOutputSchema.parse(json).scores,
        )
      : undefined;
    const best = scores
      ? selectBest(scores, accepted.length, this.config.comedy.minSafeScore)
      : undefined;
    if (scores && !best) {
      this.stats.rejections.judge_unsafe++;
      return undefined;
    }
    // If the judge failed entirely, keep the first candidate unscored rather than lose the post.
    const winnerIndex = best?.index ?? 0;
    return { accepted, scores: scores ?? [], winnerIndex };
  }

  // -------------------------------------------------------------- commit

  private commit(job: Job, outcome: unknown, now: Date, day: number): void {
    if (outcome === undefined) {
      this.stats.droppedActions++;
      return;
    }
    if (job.kind === "comment") this.commitComment(job, outcome as string, now, day);
    else
      this.commitPost(
        job,
        outcome as { accepted: PostCandidate[]; scores: JudgeScore[]; winnerIndex: number },
        now,
        day,
      );
  }

  private commitPost(
    job: PostJob,
    o: { accepted: PostCandidate[]; scores: JudgeScore[]; winnerIndex: number },
    now: Date,
    day: number,
  ): void {
    const p = this.world.persona(job.action.personaId);
    const counts = this.world.counts(p.card.id, day);
    if (counts.posts >= this.config.quotas.postsPerDay) return;
    const winner = o.accepted[o.winnerIndex]!;
    const scoreOf = (i: number) => o.scores.find((s) => s.index === i);
    const judge = scoreOf(o.winnerIndex);
    const post: SimPost = {
      id: this.world.id("post"),
      authorId: p.card.id,
      format: job.action.format,
      body: winner.body,
      hashtags: winner.hashtags,
      createdAt: now,
      day,
      ...(judge ? { judge } : {}),
      losers: o.accepted
        .map((c, i) => ({ c, i }))
        .filter(({ i }) => i !== o.winnerIndex)
        .map(({ c, i }) => {
          const s = scoreOf(i);
          return { body: c.body, ...(s ? { judge: s } : {}) };
        }),
      ...(job.action.worldEventId ? { worldEventId: job.action.worldEventId } : {}),
      ...(job.action.grudgeTargetId ? { grudgeTargetId: job.action.grudgeTargetId } : {}),
      ...(winner.callback_post_id ? { callbackPostId: winner.callback_post_id } : {}),
      reactions: new Map(),
      commentIds: [],
      engagementScore: 0,
    };
    this.rescore(post);
    this.world.posts.set(post.id, post);
    p.recentPostIds.unshift(post.id);
    counts.posts++;
    if (job.action.format === "event_reaction") p.reactedToEventOnDay.add(day);
  }

  private commitComment(job: CommentJob, body: string, now: Date, day: number): void {
    const a = job.action;
    const counts = this.world.counts(a.personaId, day);
    if (counts.comments >= this.config.quotas.commentsPerDay) return;
    const post = this.world.posts.get(a.postId)!;
    const target = a.kind === "reply" ? a.parentAuthorId : a.postAuthorId;
    const grudge =
      a.kind === "comment"
        ? a.grudge
        : this.world.relationship(a.personaId, target)?.rel.stage === "comment_war";
    const comment: SimComment = {
      id: this.world.id("c"),
      postId: post.id,
      ...(a.kind === "reply" ? { parentId: a.parentCommentId } : {}),
      authorId: a.personaId,
      body,
      depth: a.kind === "reply" ? a.depth : 1,
      createdAt: now,
      grudge,
    };
    this.world.comments.set(comment.id, comment);
    post.commentIds.push(comment.id);
    this.rescore(post);
    counts.comments++;
    const p = this.world.persona(a.personaId);
    if (a.kind === "reply") {
      p.repliedTo.add(a.parentCommentId);
      p.lastRepliedAt.set(a.parentAuthorId, now);
    }
    // FR-18: a "respectfully, I'd push back" stings; an ordinary comment warms.
    this.trigger(target, a.personaId, grudge ? "pushBackComment" : "receivedComment", now);
  }

  private rescore(post: SimPost): void {
    post.engagementScore = engagementScore(
      {
        botReactions: post.reactions.size,
        humanReactions: 0,
        comments: post.commentIds.length,
        shares: 0,
        ...(post.judge ? { judgeScore: post.judge.funny } : {}),
      },
      this.config.engagement,
    );
  }

  /** Apply a trigger to how `aggrieved` feels about `other`, creating the relationship if new. */
  private trigger(aggrieved: string, other: string, trigger: RelationshipTrigger, now: Date): void {
    if (aggrieved === other || !this.world.personas.has(aggrieved)) return;
    const key = relKey(aggrieved, other);
    const existing = this.world.relationships.get(key);
    const rel = existing?.rel ?? newRelationship(aggrieved, other, now);
    this.world.relationships.set(key, {
      ...existing,
      rel: applyTrigger(rel, trigger, this.config.grudge),
    });
  }

  // ------------------------------------------------------------- nightly

  async nightly(day: number): Promise<void> {
    const now = this.now(day + 1, 0);
    const events = new Map<string, string[]>();
    const log = (personaId: string, line: string) =>
      events.set(personaId, [...(events.get(personaId) ?? []), line]);

    for (const [key, r] of [...this.world.relationships.entries()]) {
      const current = this.world.relationships.get(key)!;
      const { relationship, transition } = advanceDaily(
        current.rel,
        now,
        this.random,
        this.config.grudge,
      );
      this.world.relationships.set(key, { ...current, rel: relationship });
      if (!transition) continue;
      this.world.transitions.push({ day, fromId: r.rel.from, toId: r.rel.to, transition });
      const other = this.world.persona(r.rel.to).card.name;
      log(r.rel.from, `${other}: ${transition.from} → ${transition.to}`);
      const format = transitionPostFormat(transition);
      if (format)
        this.world.persona(r.rel.from).pendingStagePosts.push({ format, targetId: r.rel.to });
      if (transition.to === "reconciled") {
        const reverseKey = relKey(r.rel.to, r.rel.from);
        const reverse = this.world.relationships.get(reverseKey);
        if (reverse) {
          const mirrored = mirrorReconciliation(reverse.rel, now, this.config.grudge);
          this.world.relationships.set(reverseKey, { ...reverse, rel: mirrored.relationship });
          if (mirrored.transition) {
            this.world.transitions.push({
              day,
              fromId: r.rel.to,
              toId: r.rel.from,
              transition: mirrored.transition,
            });
            log(
              r.rel.to,
              `${this.world.persona(r.rel.from).card.name}: ${mirrored.transition.from} → reconciled (coffee)`,
            );
          }
        }
      }
    }

    // FR-17: condense each active persona's day into its career summary.
    const jobs = [...this.world.personas.values()]
      .map((p) => ({
        p,
        posts: this.world.recentPosts(p.card.id, 10).filter((post) => post.day === day),
      }))
      .filter(({ p, posts }) => posts.length > 0 || events.has(p.card.id));
    const summaries = await mapLimit(jobs, this.options.concurrency, ({ p, posts }) => {
      const prompt = this.tryBuild(() =>
        buildSummaryPrompt(
          this.content,
          p.card,
          {
            ...(p.careerSummary ? { previousSummary: p.careerSummary } : {}),
            posts: posts.map((x) => x.body),
            events: events.get(p.card.id) ?? [],
          },
          this.config,
        ),
      );
      if (!prompt) return Promise.resolve(undefined);
      return this.callParsed("summary", prompt, day, (json) => {
        const s = (json as { summary?: unknown }).summary;
        return typeof s === "string" && s.trim() ? s.trim() : undefined;
      });
    });
    jobs.forEach(({ p }, i) => {
      const s = summaries[i];
      if (s) p.careerSummary = s;
    });
  }
}

/**
 * Choose N house bots: the latest-stage seeded feuds first (so the reconciliation gate is
 * reachable), then pods, then round-robin across types.
 */
export function selectPersonas(content: ContentBundle, n: number, random: Random): string[] {
  const rank = {
    public_exit: 0,
    comment_war: 1,
    vague_posting: 2,
    cold: 3,
    reconciled: 4,
    neutral: 5,
  } as const;
  const seeds = [...content.houseRelationships].sort(
    (a, b) =>
      Math.min(rank[a.a_to_b.stage], rank[a.b_to_a.stage]) -
      Math.min(rank[b.a_to_b.stage], rank[b.b_to_a.stage]),
  );
  const chosen: string[] = [];
  const add = (id: string) => {
    if (chosen.length < n && !chosen.includes(id)) chosen.push(id);
  };
  for (const s of seeds.slice(0, Math.ceil(n / 3))) {
    if (chosen.length + 2 <= n) {
      add(s.a);
      add(s.b);
    }
  }
  const byType = new Map<string, string[]>();
  for (const b of content.houseBots) byType.set(b.type, [...(byType.get(b.type) ?? []), b.id]);
  const queues = [...byType.values()].map((ids) => [...ids]);
  while (chosen.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const pick = pickOne(random, q);
      if (!pick) continue;
      q.splice(q.indexOf(pick), 1);
      add(pick);
    }
  }
  return chosen;
}
