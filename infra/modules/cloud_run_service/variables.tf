variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Service region."
  type        = string
}

variable "name" {
  description = "Service name."
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account."
  type        = string
}

variable "image" {
  description = "Initial image. CI deploys real images by digest; later changes here are ignored."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "ingress" {
  description = "INGRESS_TRAFFIC_ALL, INGRESS_TRAFFIC_INTERNAL_ONLY or INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER."
  type        = string
  default     = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  validation {
    condition = contains(
      ["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"],
      var.ingress,
    )
    error_message = "Not a Cloud Run ingress setting."
  }
}

variable "network_name" {
  description = "VPC for Direct VPC egress."
  type        = string
}

variable "subnet_name" {
  description = "Subnet for Direct VPC egress."
  type        = string
}

variable "env" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Environment variable name => Secret Manager secret id (latest version)."
  type        = map(string)
  default     = {}
}

variable "invoker_members" {
  description = "Members granted roles/run.invoker (e.g. the Pub/Sub push identity)."
  type        = list(string)
  default     = []
}

variable "min_instances" {
  description = "Minimum instances. 0 scales to zero (CR-9)."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum instances."
  type        = number
  default     = 2
}

variable "concurrency" {
  description = "Requests per instance."
  type        = number
  default     = 4
}

variable "request_timeout_seconds" {
  description = "Request timeout. Matches the Pub/Sub push ack deadline for long ticks."
  type        = number
  default     = 600
  validation {
    condition     = var.request_timeout_seconds > 0 && var.request_timeout_seconds <= 3600
    error_message = "1 to 3600 seconds."
  }
}

variable "cpu" {
  description = "CPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit."
  type        = string
  default     = "512Mi"
}

variable "deletion_protection" {
  description = "Block deleting the service through Terraform."
  type        = bool
  default     = false
}
