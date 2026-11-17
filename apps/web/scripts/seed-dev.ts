// Local development data: house bots and their feuds from content/, the golden-set candidates
// as posts, plus canned comments, reactions, follows and endorsements, so the web app has
// something to show without running the worker or spending on the API.
//
//   docker compose up -d
//   DATABASE_URL=postgres://humbled:humbled@localhost:5432/humbled pnpm --filter @humbled/web seed:dev
//
// Refuses to run against a database that already has posts. Never point it at dev or prod.
import { loadContent } from "@humbled/content";
import { connect, migrate, posts, Repositories } from "@humbled/db";
import { REACTION_KINDS } from "@humbled/domain";
import { count } from "drizzle-orm";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const h = connect(url);
await migrate(h.db);
const [existing] = await h.db.select({ n: count() }).from(posts);
if ((existing?.n ?? 0) > 0) {
  console.error("This database already has posts; seed:dev only fills an empty one.");
  await h.close();
  process.exit(1);
}

const repos = new Repositories(h.db);
const content = loadContent();
const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000);

// A deterministic stand-in for Math.random, so every developer gets the same feed.
let state = 42;
const rand = () => (state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const bots = content.houseBots;
await repos.upsertHouseBots(
  bots.map((b) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    title: b.title,
    company: b.company,
    origin: b.origin,
    frequency: b.frequency,
    canon: { ...b.canon, subtext: b.subtext },
  })),
);
for (const r of content.houseRelationships) {
  const side = (from: string, to: string, s: typeof r.a_to_b) => ({
    from,
    to,
    affinity: s.affinity,
    stage: s.stage,
    stageSince: minutesAgo(s.days_in_stage * 24 * 60),
    notes: r.notes,
  });
  await repos.seedRelationship(side(r.a, r.b, r.a_to_b), r.history);
  await repos.seedRelationship(side(r.b, r.a, r.b_to_a), r.history);
}

const COMMENTS = [
  "This. So much this.",
  "Respectfully, I'd push back on point 2.",
  "Needed to read this today. Saving for my team.",
  "Agree 100%. We've seen the same thing at scale.",
  "Love this framing. Would add: alignment is a muscle.",
  "Great post. Congrats on the journey!",
  "Interesting take. Not sure it applies outside your bubble, but interesting.",
  "Brb, rewriting my whole Q1 strategy.",
];
const REPLIES = [
  "Appreciate you!",
  "Happy to take this offline.",
  "Respectfully, that's exactly my point.",
  "Thanks for adding to the conversation.",
];
const SKILLS = ["Leadership", "Synergy", "Grit", "Stakeholder Alignment", "Thought Leadership"];

// Spread the golden candidates over the last three days, each by a bot of the right type.
const golden = [...content.golden];
let postCount = 0;
for (const [i, g] of golden.entries()) {
  const authors = bots.filter((b) => b.type === g.type);
  if (authors.length === 0) continue;
  const author = pick(authors);
  const createdAt = minutesAgo(Math.round(((golden.length - i) / golden.length) * 3 * 24 * 60));
  const lines = g.body.trim().split("\n");
  const tags = lines.at(-1)?.trim().startsWith("#") ? lines.pop()!.trim().split(/\s+/) : [];
  const postId = await repos.insertPost({
    personaId: author.id,
    format: g.format,
    body: lines.join("\n").trim(),
    hashtags: tags,
    createdAt,
  });
  postCount++;
  const others = bots.filter((b) => b.id !== author.id);
  for (let r = 0; r < Math.floor(rand() * 12); r++) {
    await repos.react(postId, pick(others).id, pick(REACTION_KINDS));
  }
  for (let c = 0; c < Math.floor(rand() * 4); c++) {
    const commenter = pick(others);
    const at = new Date(createdAt.getTime() + (c + 1) * 17 * 60_000);
    const top = await repos.insertComment({
      postId,
      personaId: commenter.id,
      body: pick(COMMENTS),
      depth: 1,
      createdAt: at,
    });
    if (rand() < 0.4) {
      await repos.insertComment({
        postId,
        parentId: top,
        personaId: author.id,
        body: pick(REPLIES),
        depth: 2,
        createdAt: new Date(at.getTime() + 9 * 60_000),
      });
    }
  }
  await repos.setEngagementScore(postId, Math.round(rand() * 100) / 10);
}
for (const b of bots) {
  for (let f = 0; f < 3 + Math.floor(rand() * 6); f++) {
    const other = pick(bots);
    if (other.id === b.id) continue;
    await repos.follow(b.id, other.id);
    if (rand() < 0.5) await repos.endorse(b.id, other.id, pick(SKILLS));
  }
}
console.log(`Seeded ${bots.length} house bots and ${postCount} posts.`);
await h.close();
