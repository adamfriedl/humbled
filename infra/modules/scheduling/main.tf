# Cloud Scheduler -> Pub/Sub -> push to the worker. Each job has a dead-letter topic with a pull
# subscription, so a message that keeps failing lands somewhere visible (the Phase 1 gate is
# 48 hours with nothing there). Pushes are authenticated with an OIDC token for `push_identity`.
data "google_project" "this" {
  project_id = var.project_id
}

locals {
  pubsub_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic" "job" {
  # checkov:skip=CKV_GCP_83:Google-managed encryption; messages are job triggers with no user data, and CMEK adds KMS cost.
  for_each = var.jobs
  project  = var.project_id
  name     = "worker-${each.key}"
}

resource "google_pubsub_topic" "dead_letter" {
  # checkov:skip=CKV_GCP_83:Google-managed encryption; messages are job triggers with no user data, and CMEK adds KMS cost.
  for_each = var.jobs
  project  = var.project_id
  name     = "worker-${each.key}-dlq"
}

resource "google_pubsub_subscription" "push" {
  for_each             = var.jobs
  project              = var.project_id
  name                 = "worker-${each.key}-push"
  topic                = google_pubsub_topic.job[each.key].id
  ack_deadline_seconds = each.value.ack_deadline_seconds
  # A job that hasn't run within its own period is stale; let it go rather than pile up.
  message_retention_duration = "${each.value.retention_seconds}s"

  push_config {
    push_endpoint = "${var.worker_url}${each.value.path}"
    oidc_token {
      service_account_email = var.push_identity_email
      audience              = var.worker_url
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter[each.key].id
    max_delivery_attempts = var.max_delivery_attempts
  }

  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_subscription" "dead_letter" {
  for_each                   = var.jobs
  project                    = var.project_id
  name                       = "worker-${each.key}-dlq-pull"
  topic                      = google_pubsub_topic.dead_letter[each.key].id
  message_retention_duration = "604800s"
  expiration_policy {
    ttl = ""
  }
}

# Pub/Sub's service agent forwards undeliverable messages to the dead-letter topic.
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  for_each = var.jobs
  project  = var.project_id
  topic    = google_pubsub_topic.dead_letter[each.key].name
  role     = "roles/pubsub.publisher"
  member   = local.pubsub_agent
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  for_each     = var.jobs
  project      = var.project_id
  subscription = google_pubsub_subscription.push[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}

# Pub/Sub mints the push OIDC token as `push_identity`.
resource "google_service_account_iam_member" "push_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.push_identity_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.pubsub_agent
}

resource "google_cloud_scheduler_job" "job" {
  for_each  = var.jobs
  project   = var.project_id
  region    = var.region
  name      = "worker-${each.key}"
  schedule  = each.value.schedule
  time_zone = each.value.time_zone
  paused    = var.paused

  pubsub_target {
    topic_name = google_pubsub_topic.job[each.key].id
    data       = base64encode(jsonencode({ job = each.key }))
  }
}
