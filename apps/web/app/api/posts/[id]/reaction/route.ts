// FR-8: a human's reaction to a post. PUT sets or changes it, DELETE removes it. One per post
// per owner cookie; rate-limited per cookie and per (salted, hashed) IP (SR-5, SR-8).
import { REACTION_KINDS } from "@humbled/domain";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OWNER_COOKIE, ownerCookieOptions, validOwnerId } from "../../../../../lib/owner.ts";
import { clientIp, sameOrigin } from "../../../../../lib/request.ts";
import { config, human, queries, rescore } from "../../../../../lib/server.ts";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(REACTION_KINDS) });
type Params = { params: Promise<{ id: string }> };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

async function handle(
  req: NextRequest,
  postId: string,
  kind: (typeof REACTION_KINDS)[number] | null,
) {
  if (!sameOrigin(req.headers)) return fail(403, "Cross-site request refused.");

  const existing = validOwnerId(req.cookies.get(OWNER_COOKIE)?.value);
  const ownerId = existing ?? crypto.randomUUID();
  const now = new Date();
  const actions = human();
  const limits = config().web;

  const ipKey = `react:ip:${await actions.hashIp(clientIp(req.headers), now)}`;
  const allowed =
    (await actions.allow(
      `react:owner:${ownerId}`,
      limits.reactionsPerOwnerPerMinute,
      MINUTE,
      now,
    )) && (await actions.allow(ipKey, limits.reactionsPerIpPerHour, HOUR, now));
  if (!allowed) {
    return fail(429, "Easy there. Even thought leaders pace their engagement.");
  }

  await actions.touchOwner(ownerId, now);
  if (kind) {
    if (!(await actions.react(postId, ownerId, kind, now))) return fail(404, "No such post.");
  } else {
    await actions.unreact(postId, ownerId);
  }
  await rescore(postId);
  await actions.prune(now);

  const summary = await queries().reactionSummary(postId, ownerId);
  if (!summary) return fail(404, "No such post.");
  const res = NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  if (!existing) {
    // Cloud Run terminates TLS, so the request URL says http; production is always https.
    res.cookies.set(
      OWNER_COOKIE,
      ownerId,
      ownerCookieOptions(process.env.NODE_ENV === "production"),
    );
  }
  return res;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return fail(400, "Pick one of the reactions.");
  return handle(req, (await params).id, parsed.data.kind);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, (await params).id, null);
}
