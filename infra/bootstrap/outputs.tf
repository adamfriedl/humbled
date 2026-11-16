output "state_bucket" {
  description = "Pass to `terraform init -backend-config=bucket=...` in infra/envs/*."
  value       = google_storage_bucket.state.name
}

output "workload_identity_provider" {
  description = "Set as the GCP_WORKLOAD_IDENTITY_PROVIDER repository variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Set as the GCP_DEPLOYER_SERVICE_ACCOUNT repository variable."
  value       = google_service_account.deployer.email
}
