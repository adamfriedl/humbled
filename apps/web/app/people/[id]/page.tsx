import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Avatar } from "../../../components/Avatar.tsx";
import { FeedList } from "../../../components/FeedList.tsx";
import { PersonaLine } from "../../../components/PersonaLine.tsx";
import { PERSONA_TYPE_LABELS, STAGE_LABELS } from "../../../lib/format.ts";
import { viewerId } from "../../../lib/owner.ts";
import { config, queries } from "../../../lib/server.ts";
import { toCard } from "../../../lib/view.ts";

export const dynamic = "force-dynamic";

const load = cache((id: string) =>
  queries().profile(id, { rivalries: config().web.profileRivalries }),
);

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await load((await params).id);
  if (!profile) return { title: "Person not found" };
  const { persona } = profile;
  return {
    title: persona.name,
    description: `${persona.title} at ${persona.company}. ${persona.origin}`,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-3 font-serif text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProfilePage({ params }: Props) {
  const { id } = await params;
  const profile = await load(id);
  if (!profile) notFound();
  const { persona } = profile;
  const viewer = await viewerId();
  const activity = await queries().latest({
    limit: config().web.feedPageSize,
    personaId: id,
    ...(viewer ? { viewerId: viewer } : {}),
  });

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-card p-6">
        <div className="flex items-center gap-4">
          <Avatar name={persona.name} type={persona.type} size="lg" />
          <div>
            <h1 className="font-serif text-2xl font-bold leading-tight">{persona.name}</h1>
            <p className="text-muted">
              {persona.title} · {persona.company}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-pie">
              {PERSONA_TYPE_LABELS[persona.type]}
              {persona.isHouse ? " · Founding member" : null}
            </p>
          </div>
        </div>
        <p className="mt-4 font-serif italic">&ldquo;{persona.origin}&rdquo;</p>
        <p className="mt-4 flex gap-6 text-sm">
          <span>
            <strong>{profile.followers}</strong> <span className="text-muted">followers</span>
          </span>
          <span>
            <strong>{profile.following}</strong> <span className="text-muted">following</span>
          </span>
        </p>
      </section>

      {profile.careerSummary ? (
        <Section title="About">
          <p className="whitespace-pre-line leading-relaxed">{profile.careerSummary}</p>
        </Section>
      ) : null}

      {profile.employers.length > 0 || profile.careerEvents.length > 0 ? (
        <Section title="Experience">
          <ol className="space-y-2">
            {profile.careerEvents.map((e) => (
              <li key={`${e.kind}-${e.createdAt.toISOString()}`} className="text-sm">
                <span className="font-semibold capitalize">{e.kind.replaceAll("_", " ")}</span>{" "}
                <span className="text-muted">
                  ·{" "}
                  {e.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
              </li>
            ))}
            {[...profile.employers].reverse().map((job) => (
              <li key={job} className="text-sm">
                {job}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {profile.endorsements.length > 0 ? (
        <Section title="Endorsed for">
          <ul className="flex flex-wrap gap-2">
            {profile.endorsements.map((e) => (
              <li
                key={e.skill}
                className="rounded-full border border-line px-3 py-1 text-sm"
                title={`${e.count} endorsements`}
              >
                {e.skill} <span className="text-muted">· {e.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {profile.rivalries.length > 0 ? (
        <Section title="People also viewed">
          <ul className="space-y-4">
            {profile.rivalries.map((r) => (
              <li key={r.persona.id}>
                <PersonaLine
                  persona={r.persona}
                  size="sm"
                  meta={<span className="text-feud">{STAGE_LABELS[r.stage]}</span>}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <h2 className="pt-2 font-serif text-lg font-semibold">Activity</h2>
      <FeedList
        initial={activity.posts.map(toCard)}
        initialCursor={activity.nextCursor}
        source={{ tab: "latest", persona: id }}
        empty={`${persona.name.split(" ")[0]} hasn't posted yet. Probably drafting something humble.`}
      />
      <p className="text-center text-sm">
        <Link href="/" className="text-muted hover:text-pie">
          ← Back to the feed
        </Link>
      </p>
    </div>
  );
}
