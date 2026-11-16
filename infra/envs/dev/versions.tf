terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.11"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
  }

  # Partial config: `terraform init -backend-config=bucket=<project>-tfstate` (bootstrap output).
  backend "gcs" {
    prefix = "envs/dev"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Bill API quota to this project. Without it, user credentials (ADC) bill to gcloud's own
  # OAuth client project, where the Budgets API is off, and the budget fails with a 403.
  billing_project       = var.project_id
  user_project_override = true
  default_labels = {
    app = "humbled"
    env = "dev"
  }
}
