# Dev: small, cheap, and `terraform destroy` leaves nothing billable (Phase 1 criterion), so
# deletion protection is off. Only the worker exists in Phase 1; web and edge arrive in Phase 2.
module "project" {
  source     = "../../modules/project"
  project_id = var.project_id
}

module "network" {
  source     = "../../modules/network"
  project_id = var.project_id
  region     = var.region
  depends_on = [module.project]
}

module "security" {
  source     = "../../modules/security"
  project_id = var.project_id
  depends_on = [module.project]
}

module "database" {
  source                      = "../../modules/database"
  project_id                  = var.project_id
  region                      = var.region
  network_id                  = module.network.network_id
  private_services_connection = module.network.private_services_connection
  tier                        = var.database_tier
  deletion_protection         = false
  retained_backups            = 3
}

resource "google_artifact_registry_repository" "images" {
  # checkov:skip=CKV_GCP_84:Google-managed encryption for public-source images; CMEK adds KMS cost.
  project       = var.project_id
  location      = var.region
  repository_id = "humbled"
  format        = "DOCKER"
  description   = "Service images, deployed by digest."

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }
  depends_on = [module.project]
}

module "worker" {
  source                = "../../modules/cloud_run_service"
  project_id            = var.project_id
  region                = var.region
  name                  = "worker"
  service_account_email = module.security.worker_service_account_email
  network_name          = module.network.network_name
  subnet_name           = module.network.run_subnet_name
  ingress               = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  max_instances         = 2
  env = {
    HUMBLED_CONFIG = var.worker_config
  }
  secret_env = {
    DATABASE_URL              = module.database.database_url_secret_id
    HUMBLED_ANTHROPIC_API_KEY = module.security.anthropic_api_key_secret_id
  }
  invoker_members = ["serviceAccount:${module.security.push_service_account_email}"]
}

# Public pages. No load balancer: Cloud Run takes the traffic itself, on its run.app URL and
# an optional custom domain (ADR 0014).
module "web" {
  source                  = "../../modules/cloud_run_service"
  project_id              = var.project_id
  region                  = var.region
  name                    = "web"
  service_account_email   = module.security.web_service_account_email
  network_name            = module.network.network_name
  subnet_name             = module.network.run_subnet_name
  ingress                 = "INGRESS_TRAFFIC_ALL"
  max_instances           = 2
  concurrency             = 40
  request_timeout_seconds = 30
  env = {
    HUMBLED_CONFIG = var.web_config
  }
  secret_env = {
    DATABASE_URL = module.database.database_url_secret_id
  }
  invoker_members = ["allUsers"]
}

# Keep one web instance warm. Cloud Run keeps an idle instance for roughly 15 minutes, so a
# request every 5 keeps the first visitor off a ~4s cold start. Idle time isn't billed under
# request-based billing, so this costs about $0.10/month (the Scheduler job). Not a guarantee:
# min_instances = 1 is, at ~$5-8/month. The billing kill switch pauses this job too.
resource "google_cloud_scheduler_job" "web_warm" {
  project          = var.project_id
  region           = var.region
  name             = "web-keep-warm"
  description      = "Keeps a web instance warm (no cold start for the first visitor)."
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "15s"
  paused           = var.scheduler_paused

  http_target {
    http_method = "GET"
    uri         = "${module.web.uri}/healthz"
  }

  # No retry_config: retry_count already defaults to 0 (a missed ping doesn't matter), and an
  # explicit block is dropped by the API, which would show as a change on every plan.

  depends_on = [module.project]
}

resource "google_cloud_run_domain_mapping" "web" {
  count    = var.web_domain == "" ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = var.web_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = module.web.name
  }
}

module "scheduling" {
  source              = "../../modules/scheduling"
  project_id          = var.project_id
  region              = var.region
  worker_url          = module.worker.uri
  push_identity_email = module.security.push_service_account_email
  paused              = var.scheduler_paused
}

module "billing_guard" {
  count                 = var.billing_account_id == "" ? 0 : 1
  source                = "../../modules/billing_guard"
  project_id            = var.project_id
  region                = var.region
  billing_account_id    = var.billing_account_id
  monthly_budget        = var.monthly_budget
  service_account_email = module.security.kill_switch_service_account_email
  notification_channels = module.observability.notification_channels
}

module "observability" {
  source              = "../../modules/observability"
  project_id          = var.project_id
  worker_service_name = module.worker.name
  alert_emails        = var.alert_emails
}
