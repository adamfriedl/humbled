// Cloud Run's startup probe. Static: it says the server is up, not that Postgres is.
export const dynamic = "force-static";

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
