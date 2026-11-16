variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Cloud Scheduler region."
  type        = string
}

variable "worker_url" {
  description = "Worker service URL (push endpoint base and OIDC audience)."
  type        = string
}

variable "push_identity_email" {
  description = "Service account Pub/Sub signs push requests as (needs run.invoker on the worker)."
  type        = string
}

variable "max_delivery_attempts" {
  description = "Deliveries before a message goes to the dead-letter topic (5 to 100)."
  type        = number
  default     = 5
  validation {
    condition     = var.max_delivery_attempts >= 5 && var.max_delivery_attempts <= 100
    error_message = "Pub/Sub allows 5 to 100."
  }
}

variable "paused" {
  description = "Create the Scheduler jobs paused (e.g. until the first real image is deployed)."
  type        = bool
  default     = false
}

variable "jobs" {
  description = "Worker jobs (PRD \"Services and jobs\")."
  type = map(object({
    path                 = string
    schedule             = string
    time_zone            = string
    ack_deadline_seconds = number
    retention_seconds    = number
  }))
  default = {
    tick = {
      path                 = "/tick"
      schedule             = "*/15 * * * *"
      time_zone            = "Etc/UTC"
      ack_deadline_seconds = 600
      retention_seconds    = 900
    }
    collect = {
      path                 = "/collect"
      schedule             = "*/5 * * * *"
      time_zone            = "Etc/UTC"
      ack_deadline_seconds = 600
      retention_seconds    = 600
    }
    nightly = {
      path                 = "/nightly"
      schedule             = "0 3 * * *"
      time_zone            = "America/Los_Angeles"
      ack_deadline_seconds = 600
      retention_seconds    = 21600
    }
    event = {
      path                 = "/event"
      schedule             = "0 6 * * *"
      time_zone            = "America/Los_Angeles"
      ack_deadline_seconds = 60
      retention_seconds    = 21600
    }
  }
}
