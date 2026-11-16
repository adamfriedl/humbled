import type { ContentBundle, RelationshipSeed } from "@humbled/content";
import type { Repositories } from "@humbled/db";
import { MS_PER_DAY } from "@humbled/domain";

/**
 * Bring the database in line with content: house bots (profile and canon), seeded
 * relationships and world events. Safe to run on every start: career summaries, live
 * relationships and published event dates are never overwritten.
 */
export async function syncContent(
  repos: Repositories,
  content: ContentBundle,
  now: Date,
): Promise<void> {
  await repos.upsertHouseBots(
    content.houseBots.map((b) => ({
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
  const names = new Map(content.houseBots.map((b) => [b.id, b.name]));
  for (const seed of content.houseRelationships) {
    for (const side of relationshipSides(seed, names, now)) {
      await repos.seedRelationship(side, seed.history);
    }
  }
  await repos.syncWorldEvents(content.events);
}

/**
 * Both directions of a seeded relationship. Notes are written from both perspectives in the
 * seed file; each side gets the notes that mention the other by first name (a's side falls
 * back to all of them), as in the simulator.
 */
export function relationshipSides(
  seed: RelationshipSeed,
  names: ReadonlyMap<string, string>,
  now: Date,
) {
  const first = (id: string) => (names.get(id) ?? id).split(" ")[0]!.toLowerCase();
  const about = (other: string) => seed.notes.filter((n) => n.toLowerCase().includes(first(other)));
  const side = (from: string, to: string, s: RelationshipSeed["a_to_b"], notes: string[]) => ({
    from,
    to,
    affinity: s.affinity,
    stage: s.stage,
    stageSince: new Date(now.getTime() - s.days_in_stage * MS_PER_DAY),
    notes,
  });
  const aboutB = about(seed.b);
  return [
    side(seed.a, seed.b, seed.a_to_b, aboutB.length ? aboutB : seed.notes),
    side(seed.b, seed.a, seed.b_to_a, about(seed.a)),
  ];
}

/** Content order with the launch event first: the order /event publishes them in. */
export function eventOrder(content: ContentBundle): string[] {
  const launch = content.events.filter((e) => e.launch).map((e) => e.id);
  return [...launch, ...content.events.filter((e) => !e.launch).map((e) => e.id)];
}
