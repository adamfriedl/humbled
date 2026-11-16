variable "project_id" {
  description = "GCP project to bootstrap (one project per environment)."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Must be a valid GCP project id."
  }
}

variable "region" {
  description = "Region for the state bucket."
  type        = string
  default     = "us-central1"
}

variable "github_repository" {
  description = "owner/name of the repository whose workflows may deploy."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use owner/name."
  }
}

variable "billing_account_id" {
  description = "Billing account (XXXXXX-XXXXXX-XXXXXX) the deployer may create budgets on. Empty to skip."
  type        = string
  default     = ""
  validation {
    condition     = var.billing_account_id == "" || can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "Use the XXXXXX-XXXXXX-XXXXXX form."
  }
}
