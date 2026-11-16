variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Function and Scheduler region."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account the budget is created on (XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "monthly_budget" {
  description = "Monthly budget in whole currency units. Spend at 100% pauses every Scheduler job."
  type        = number
  validation {
    condition     = var.monthly_budget > 0 && floor(var.monthly_budget) == var.monthly_budget
    error_message = "A positive whole number."
  }
}

variable "currency" {
  description = "Budget currency (must match the billing account)."
  type        = string
  default     = "USD"
}

variable "service_account_email" {
  description = "Kill-switch identity (Scheduler admin)."
  type        = string
}

variable "notification_channels" {
  description = "Monitoring notification channels for budget alerts (in addition to billing admins)."
  type        = list(string)
  default     = []
}
