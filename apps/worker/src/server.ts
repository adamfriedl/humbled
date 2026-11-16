// HTTP entry point. Cloud Scheduler publishes to Pub/Sub, and Pub/Sub pushes to these routes
// (authenticated by Cloud Run IAM with the push subscription's OIDC token, so there is no
// app-level auth). A 2xx acks the message; anything else makes Pub/Sub redeliver, which every
// handler tolerates (see ADR 0010).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { runCollect } from "./collect.ts";
import type { WorkerDeps } from "./deps.ts";
import { runEvent } from "./event.ts";
import { runNightly } from "./nightly.ts";
import { runTick } from "./tick.ts";

/** The time a Pub/Sub push was published: the job's logical time, stable across redeliveries. */
export function messageTime(body: unknown, fallback: Date): Date {
  const t = (body as { message?: { publishTime?: unknown } } | undefined)?.message?.publishTime;
  if (typeof t === "string") {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

const ROUTES: Record<string, (deps: WorkerDeps, at: Date) => Promise<unknown>> = {
  "/tick": runTick,
  "/collect": (deps) => runCollect(deps),
  "/nightly": runNightly,
  "/event": runEvent,
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function createWorkerServer(deps: WorkerDeps): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0]!;
      if (req.method === "GET" && path === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      const handler = ROUTES[path];
      if (!handler || req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = await readJson(req);
        const result = await handler(deps, messageTime(body, deps.clock.now()));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (e) {
        deps.log("handler_error", { path, error: e instanceof Error ? e.stack : String(e) });
        res.writeHead(500).end();
      }
    })();
  });
}
