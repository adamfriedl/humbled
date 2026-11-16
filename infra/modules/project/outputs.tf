output "services" {
  description = "Enabled services, for depends_on in other modules."
  value       = [for s in google_project_service.this : s.service]
}
