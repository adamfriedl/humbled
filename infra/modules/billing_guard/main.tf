# CR-8 backstop: a monthly billing budget for the project publishes to Pub/Sub; a small function
# pauses every Cloud Scheduler job once spend reaches 100%. Billing data lags by hours, so CR-7's
# daily ledger is the primary control.
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_pubsub_topic" "budget" {
  # checkov:skip=CKV_GCP_83:Google-managed encryption; messages are job triggers with no user data, and CMEK adds KMS cost.
  project = var.project_id
  name    = "billing-budget"
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${var.project_id} monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.currency
      units         = tostring(var.monthly_budget)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.budget.id
    schema_version                   = "1.0"
    disable_default_iam_recipients   = false
    monitoring_notification_channels = var.notification_channels
  }
}

# ----------------------------------------------------------------- function

resource "google_storage_bucket" "source" {
  # checkov:skip=CKV_GCP_62:Holds only the kill switch's source archive; access logging adds a bucket for no audit value.
  project                     = var.project_id
  name                        = "${var.project_id}-kill-switch-source"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true
  versioning {
    enabled = true
  }
}

data "archive_file" "source" {
  type        = "zip"
  output_path = "${path.module}/.build/kill-switch.zip"
  source_dir  = "${path.module}/function"
  excludes    = ["kill-switch.test.mjs", "node_modules"]
}

resource "google_storage_bucket_object" "source" {
  bucket = google_storage_bucket.source.name
  name   = "kill-switch-${data.archive_file.source.output_md5}.zip"
  source = data.archive_file.source.output_path
}

resource "google_cloudfunctions2_function" "kill_switch" {
  project  = var.project_id
  name     = "kill-switch"
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = "killSwitch"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    max_instance_count    = 1
    available_memory      = "256M"
    timeout_seconds       = 120
    service_account_email = var.service_account_email
    ingress_settings      = "ALLOW_INTERNAL_ONLY"
    environment_variables = {
      PROJECT_ID = var.project_id
      REGION     = var.region
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.budget.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = var.service_account_email
  }
}

# Eventarc delivers the Pub/Sub event by invoking the function's Cloud Run service.
resource "google_cloud_run_service_iam_member" "trigger_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.kill_switch.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_account_email}"
}
