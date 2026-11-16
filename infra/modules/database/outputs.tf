output "instance_name" {
  description = "Cloud SQL instance name."
  value       = google_sql_database_instance.this.name
}

output "database_url_secret_id" {
  description = "Secret Manager secret holding DATABASE_URL (mount it; never output the value)."
  value       = google_secret_manager_secret.database_url.secret_id
  # Consumers (Cloud Run) resolve versions/latest at create time, so the version must exist first.
  depends_on = [google_secret_manager_secret_version.database_url]
}
