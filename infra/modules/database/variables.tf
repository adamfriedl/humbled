variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Instance region."
  type        = string
}

variable "name" {
  description = "Instance name."
  type        = string
  default     = "humbled"
}

variable "network_id" {
  description = "VPC for the private IP."
  type        = string
}

variable "private_services_connection" {
  description = "Private services connection id; the instance waits for it."
  type        = string
}

variable "tier" {
  description = "Machine tier. db-f1-micro (shared core) keeps dev well inside the $30/month infra target."
  type        = string
  default     = "db-f1-micro"
}

variable "disk_size_gb" {
  description = "Initial disk size (autoresizes)."
  type        = number
  default     = 10
  validation {
    condition     = var.disk_size_gb >= 10
    error_message = "Cloud SQL's minimum is 10 GB."
  }
}

variable "high_availability" {
  description = "Regional (HA) instead of zonal."
  type        = bool
  default     = false
}

variable "point_in_time_recovery" {
  description = "Enable point-in-time recovery (write-ahead log retention)."
  type        = bool
  default     = false
}

variable "retained_backups" {
  description = "Daily backups kept."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Block deleting the instance. Off for dev so `terraform destroy` leaves nothing billable."
  type        = bool
  default     = true
}

variable "database_name" {
  description = "Application database."
  type        = string
  default     = "humbled"
}

variable "user_name" {
  description = "Application user."
  type        = string
  default     = "humbled"
}
