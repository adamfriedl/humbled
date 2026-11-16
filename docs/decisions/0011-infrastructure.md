# 0011: Infrastructure (Phase 1)

Status: accepted · 2026-11-16

Terraform follows the PRD layout. Choices the PRD leaves open:

- **Direct VPC egress, no Serverless VPC Access connector.** A connector bills for always-on
  instances, which goes against CR-9. Cloud Run sends only private ranges (Cloud SQL) through
  the VPC; Anthropic traffic goes straight out. The VPC denies all ingress.
- **Cloud SQL:** `db-f1-micro`, zonal, private IP only, `ssl_mode = ENCRYPTED_ONLY`, 3 daily
  backups in dev, and no point-in-time recovery. That keeps dev inside the PRD's $30/month
  infrastructure target. `DATABASE_URL` is built from a generated password and stored in
  Secret Manager, never in an output. The client uses `sslmode=no-verify`: the connection is
  encrypted on a private network, but the client doesn't pin the server's certificate.
- **The worker's ingress is internal-only.** Pub/Sub push from the same project counts as
  internal, and every push carries an OIDC token from a dedicated `pubsub-push` account, the
  only one with `run.invoker`.
- **Job retention matches the job's period.** A tick message is kept for 15 minutes and a
  collect for 10, so a backlog drains instead of replaying stale ticks. Five failed deliveries
  move a message to its dead-letter topic, which has a pull subscription and an alert.
- **Images are deployed by digest from CI.** Terraform creates the service on a placeholder
  image and then ignores the image (`lifecycle.ignore_changes`), so `apply` never rolls back a
  deploy.
- **The Anthropic key is added outside Terraform.** Terraform creates the empty secret, and
  `gcloud secrets versions add` sets the value, so the key never enters state (SR-9).
- **The kill switch is dependency-free.** It's a 2nd-gen Cloud Function that pauses every
  Scheduler job in the region over the REST API, using the metadata server's token. The only
  package is the Functions Framework, and the logic is unit-tested with `node --test`.
- **The deployer is broad, but limited to the project.** Terraform manages the whole
  single-purpose project, so it needs editor plus IAM, service account and secret admin roles.
  WIF trusts only this repository. The Checkov skips explain why.
- **No CMEK.** Pub/Sub, Artifact Registry and buckets use Google-managed keys. KMS would add
  cost and nothing here needs customer-managed keys.
- **Lock files aren't committed yet.** They need registry access to cover every platform, so
  the first networked `init` writes them (see `infra/README.md`).
