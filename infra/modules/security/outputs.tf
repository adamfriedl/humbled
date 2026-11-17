output "worker_service_account_email" {
  description = "Worker runtime identity."
  value       = google_service_account.worker.email
}

output "push_service_account_email" {
  description = "Identity Pub/Sub uses to invoke the worker."
  value       = google_service_account.push.email
}

output "kill_switch_service_account_email" {
  description = "Kill-switch function identity."
  value       = google_service_account.kill_switch.email
}

output "anthropic_api_key_secret_id" {
  description = "Secret Manager secret for the Anthropic key (value added out of band)."
  value       = google_secret_manager_secret.anthropic_api_key.secret_id
}

output "web_service_account_email" {
  description = "Web runtime identity."
  value       = google_service_account.web.email
}
