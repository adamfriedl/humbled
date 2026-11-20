variable "project_id" {
  description = "The dev GCP project."
  type        = string
}

variable "region" {
  description = "Region for everything regional."
  type        = string
  default     = "us-central1"
}

variable "database_tier" {
  description = "Cloud SQL tier."
  type        = string
  default     = "db-f1-micro"
}

variable "billing_account_id" {
  description = "Billing account for the CR-8 budget and kill switch. Empty skips them (not for real use)."
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Monthly budget (whole USD) at which the kill switch pauses every Scheduler job."
  type        = number
  default     = 30
}

variable "alert_emails" {
  description = "Who gets alerts."
  type        = list(string)
  default     = []
}

variable "scheduler_paused" {
  description = "Keep the Scheduler jobs paused (e.g. before the first real image is deployed)."
  type        = bool
  default     = false
}

variable "worker_config" {
  description = "JSON overrides for the worker's @humbled/config (HUMBLED_CONFIG), e.g. {\"budget\":{\"dailyLlmBudgetUsd\":0.01}}. Passing this replaces the default, so repeat the budget if you set something else."
  type        = string
  # Dev's daily LLM ceiling: about 3x the measured spend ($0.15/day for 32 house bots in the
  # Phase 1 gate), so a runaway costs at most ~$15/month instead of the $5/day config default.
  default = "{\"budget\":{\"dailyLlmBudgetUsd\":0.5}}"
  validation {
    condition     = can(keys(jsondecode(var.worker_config)))
    error_message = "Must be a JSON object."
  }
}

variable "web_config" {
  description = "JSON overrides for the web app's @humbled/config (HUMBLED_CONFIG)."
  type        = string
  default     = "{}"
  validation {
    condition     = can(keys(jsondecode(var.web_config)))
    error_message = "Must be a JSON object."
  }
}

variable "web_domain" {
  description = "Custom domain for the web app, e.g. dev.humbled.cv. Empty serves only the run.app URL. The deployer must be a verified owner of the domain first (infra/README.md)."
  type        = string
  default     = ""
  validation {
    condition     = var.web_domain == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.web_domain))
    error_message = "A lowercase hostname, or empty."
  }
}
