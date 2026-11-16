output "instance_name" {
  description = "Cloud SQL instance name."
  value       = google_sql_database_instance.this.name
}

output "database_url_secret_id" {
  description = "Secret Manager secret holding DATABASE_URL (mount it; never output the value)."
  value       = google_secret_manager_secret.database_url.secret_id
}
