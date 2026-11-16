output "name" {
  description = "Service name."
  value       = google_cloud_run_v2_service.this.name
}

output "uri" {
  description = "Service URL (the Pub/Sub push endpoint and OIDC audience)."
  value       = google_cloud_run_v2_service.this.uri
}
