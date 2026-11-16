# One-time setup, applied by a human with project owner rights (local state):
#   - the GCS bucket that holds every environment's Terraform state
#   - Workload Identity Federation so GitHub Actions can deploy without JSON keys
#   - the deployer service account CI impersonates
# Everything else is applied by CI from infra/envs/*.

terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.11"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  apis = [
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# --------------------------------------------------------------------- state

resource "google_storage_bucket" "state" {
  # checkov:skip=CKV_GCP_62:Versioned and private; Cloud Audit Logs record data access when enabled for Storage.
  name                        = "${var.project_id}-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Keep 10 old versions of each state file; older ones age out.
  lifecycle_rule {
    condition {
      num_newer_versions = 10
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.bootstrap]
}

# ---------------------------------------------------- GitHub Actions (WIF)

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  # checkov:skip=CKV_GCP_125:Trust is pinned to the repository (Google's recommended condition). An exact assertion.sub match would pin one branch and block plans on pull requests.
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Only this repository's workflows can exchange tokens.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer (Terraform apply, image push, deploy)"
  depends_on   = [google_project_service.bootstrap]
}

# Any workflow run in the repository may impersonate the deployer. Plans run on pull requests
# with the same identity; protect main (and use a GitHub environment for prod) to gate applies.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Terraform manages the whole project (services, IAM, networking, Cloud SQL, Cloud Run), so the
# deployer needs broad rights. They're scoped to this one project.
resource "google_project_iam_member" "deployer" {
  # checkov:skip=CKV_GCP_117:Terraform manages the whole single-purpose project; editor plus the admin roles below is the practical minimum.
  # checkov:skip=CKV_GCP_49:The deployer creates and binds the runtime service accounts.
  for_each = toset([
    "roles/editor",
    "roles/resourcemanager.projectIamAdmin",
    "roles/iam.serviceAccountAdmin",
    "roles/secretmanager.admin",
    "roles/run.admin",
    "roles/pubsub.admin", # editor can't read or set IAM on topics and subscriptions
    "roles/servicenetworking.networksAdmin",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"

  depends_on = [google_project_service.bootstrap]
}

resource "google_storage_bucket_iam_member" "deployer_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

# The billing budget (CR-8) lives on the billing account, not the project.
resource "google_billing_account_iam_member" "deployer_budgets" {
  count              = var.billing_account_id == "" ? 0 : 1
  billing_account_id = var.billing_account_id
  role               = "roles/billing.costsManager"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
