# Service accounts (one per component, least privilege) and the secrets that aren't owned by a
# more specific module. The Anthropic key's secret is created empty: add the value with
# `gcloud secrets versions add` so it never passes through Terraform (SR-9).
resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "worker"
  display_name = "Worker (ticks, collect, nightly, events)"
}

resource "google_service_account" "push" {
  project      = var.project_id
  account_id   = "pubsub-push"
  display_name = "Pub/Sub push identity (invokes the worker)"
}

resource "google_service_account" "kill_switch" {
  project      = var.project_id
  account_id   = "kill-switch"
  display_name = "Billing kill switch (pauses Scheduler jobs, CR-8)"
}

resource "google_project_iam_member" "worker" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Cloud Scheduler has no per-job IAM, so this is project-wide; the account does nothing else.
resource "google_project_iam_member" "kill_switch" {
  for_each = toset([
    "roles/cloudscheduler.admin",
    "roles/logging.logWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.kill_switch.email}"
}

resource "google_secret_manager_secret" "anthropic_api_key" {
  project   = var.project_id
  secret_id = "anthropic-api-key"
  replication {
    auto {}
  }
}
