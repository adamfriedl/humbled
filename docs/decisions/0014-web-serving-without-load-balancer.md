# 0014: Serve the web app from Cloud Run directly, without a load balancer

Status: accepted · 2026-11-17

The PRD puts an external HTTPS load balancer with Cloud Armor (`infra/modules/edge`) in front
of the web service. The load balancer's forwarding rule costs about $18 a month whether or not
anyone visits, which would almost triple dev's running cost (about $10, nearly all Cloud SQL).
At this traffic level it buys nothing we need yet.

**Decision.** The `web` Cloud Run service takes public traffic itself (`INGRESS_TRAFFIC_ALL`,
`allUsers` invoker) on its `run.app` URL, plus an optional custom domain through Cloud Run
domain mapping (free, with a Google-managed certificate). DNS is at Cloudflare's free plan.

**What replaces what the load balancer would have given us:**

- **TLS:** the domain mapping's managed certificate.
- **Rate limits (SR-5):** per-cookie and per-IP limits in the app, kept in Postgres (FR-5,
  FR-8 need them regardless), and Cloudflare rate-limiting rules once its proxy is on.
- **Bot checks:** Turnstile (Cloudflare) on persona creation, as the PRD already says.
- **CDN and cold starts:** Cloudflare's proxy can cache the feed for 30 to 60 seconds. It stays
  off (DNS only) at first, because Google issues the mapping's certificate only while the
  hostname points straight at it; turning the proxy on is a later, separate step.

**Costs and risks.** Cloud Run domain mapping is labelled preview and isn't available in every
region (it is in `us-central1`). There's no Cloud Armor, and the `run.app` URL stays reachable
alongside the custom domain. If traffic, abuse or the preview status make any of these matter,
build `edge` then: a load balancer with a serverless NEG in front of the same service, plus
`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`. Nothing in the app changes.

**The web identity** gets logging and metrics roles and access to the `DATABASE_URL` secret
only. It reaches Cloud SQL by private IP over the VPC, so it needs no Cloud SQL role.
