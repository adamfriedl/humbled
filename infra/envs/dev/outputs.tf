output "worker_url" {
  description = "Worker URL (internal ingress only)."
  value       = module.worker.uri
}

output "image_repository" {
  description = "Where CI pushes images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "dead_letter_subscriptions" {
  description = "Dead-letter pull subscriptions (the gate checks these are empty)."
  value       = module.scheduling.dead_letter_subscriptions
}

output "database_instance" {
  description = "Cloud SQL instance name."
  value       = module.database.instance_name
}

output "web_url" {
  description = "Web app on its run.app URL."
  value       = module.web.uri
}

output "web_dns_records" {
  description = "DNS records to create for web_domain (empty until the mapping exists)."
  value = flatten([
    for m in google_cloud_run_domain_mapping.web : [
      for r in m.status[0].resource_records : { type = r.type, name = r.name, value = r.rrdata }
    ]
  ])
}
