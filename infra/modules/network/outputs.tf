output "network_id" {
  description = "VPC id."
  value       = google_compute_network.this.id
}

output "network_name" {
  description = "VPC name."
  value       = google_compute_network.this.name
}

output "run_subnet_name" {
  description = "Subnet for Cloud Run Direct VPC egress."
  value       = google_compute_subnetwork.run.name
}

output "private_services_connection" {
  description = "The private services connection (Cloud SQL depends on it)."
  value       = google_service_networking_connection.private_services.id
}
