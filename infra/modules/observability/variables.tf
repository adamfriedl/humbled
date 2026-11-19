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

variable "handler_error_threshold" {
  description = "Handler errors within the window before an alert fires. A single error is usually a transient upstream failure that Pub/Sub's retry fixes."
  type        = number
  default     = 3
  validation {
    condition     = var.handler_error_threshold >= 1
    error_message = "At least 1."
  }
}

variable "handler_error_window_seconds" {
  description = "Window for handler_error_threshold."
  type        = number
  default     = 1800
  validation {
    condition     = var.handler_error_window_seconds >= 60 && var.handler_error_window_seconds % 60 == 0
    error_message = "Whole minutes, at least one."
  }
}
