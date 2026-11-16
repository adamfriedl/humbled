variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "worker_service_name" {
  description = "Cloud Run worker service name (for log-based metrics)."
  type        = string
}

variable "alert_emails" {
  description = "Email addresses to notify."
  type        = list(string)
  default     = []
}

variable "notification_channels" {
  description = "Existing notification channel ids to notify as well."
  type        = list(string)
  default     = []
}
