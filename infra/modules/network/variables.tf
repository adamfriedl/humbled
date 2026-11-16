variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for the Cloud Run subnet."
  type        = string
}

variable "name" {
  description = "Network name prefix."
  type        = string
  default     = "humbled"
}

variable "run_subnet_cidr" {
  description = "CIDR for Cloud Run Direct VPC egress. A /26 or larger is recommended."
  type        = string
  default     = "10.10.0.0/24"
  validation {
    condition     = can(cidrhost(var.run_subnet_cidr, 0))
    error_message = "Must be a CIDR range."
  }
}
