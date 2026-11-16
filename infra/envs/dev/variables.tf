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
