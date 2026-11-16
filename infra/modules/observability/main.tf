# Alerts the Phase 1 gate cares about: nothing in the dead-letter queues, no handler errors,
# no batches past the CR-3 SLA. The CR-10 cost dashboard reads spend_ledger (Postgres) and
# comes with the web admin view.
resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Alerts: ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
}

locals {
  channels = concat([for c in google_monitoring_notification_channel.email : c.id], var.notification_channels)
}

resource "google_monitoring_alert_policy" "dead_letters" {
  project      = var.project_id
  display_name = "Worker: messages in a dead-letter queue"
  combiner     = "OR"
  conditions {
    display_name = "Undelivered dead letters"
    condition_threshold {
      filter          = "resource.type = \"pubsub_subscription\" AND metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.labels.subscription_id = monitoring.regex.full_match(\".*-dlq-pull\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "A worker job failed every delivery attempt. Inspect with `gcloud pubsub subscriptions pull <subscription> --limit=10` and the worker's handler_error logs. See docs/runbook.md."
    mime_type = "text/markdown"
  }
}

resource "google_logging_metric" "worker_events" {
  for_each = toset(["handler_error", "batch_sla_exceeded"])
  project  = var.project_id
  name     = "worker/${each.value}"
  filter   = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.worker_service_name}\" AND jsonPayload.message = \"${each.value}\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "worker_events" {
  for_each     = google_logging_metric.worker_events
  project      = var.project_id
  display_name = "Worker: ${each.key}"
  combiner     = "OR"
  conditions {
    display_name = each.key
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${each.value.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = local.channels
  alert_strategy {
    auto_close = "1800s"
  }
}
