# Cloud SQL for PostgreSQL 16 with a private IP only. pgvector needs no flag on Cloud SQL: the
# first migration runs CREATE EXTENSION vector. The connection string (with a generated
# password) is stored in Secret Manager for the services to mount, never output (SR-9).
resource "google_sql_database_instance" "this" {
  # checkov:skip=CKV_GCP_79:The PRD pins PostgreSQL 16, matching local dev and the test image (pgvector/pgvector:pg16).
  # checkov:skip=CKV_GCP_6:ssl_mode ENCRYPTED_ONLY rejects unencrypted connections; checkov only recognises the deprecated require_ssl.
  project             = var.project_id
  name                = var.name
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    edition           = "ENTERPRISE"
    tier              = var.tier
    availability_type = var.high_availability ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.disk_size_gb
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "10:00" # UTC, 02:00-03:00 Pacific, before /nightly
      point_in_time_recovery_enabled = var.point_in_time_recovery
      backup_retention_settings {
        retained_backups = var.retained_backups
      }
    }

    maintenance_window {
      day  = 7
      hour = 11
    }

    insights_config {
      query_insights_enabled = true
    }

    database_flags {
      name  = "log_checkpoints"
      value = "on"
    }
    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
    database_flags {
      name  = "log_min_messages"
      value = "error"
    }
    database_flags {
      name  = "log_temp_files"
      value = "0"
    }
    database_flags {
      name  = "log_min_duration_statement"
      value = "-1"
    }
    database_flags {
      name  = "log_min_error_statement"
      value = "error"
    }
    database_flags {
      name  = "log_hostname"
      value = "on"
    }
    database_flags {
      name  = "log_duration"
      value = "on"
    }
    database_flags {
      name  = "log_statement"
      value = "ddl"
    }
    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }
  }

  depends_on = [var.private_services_connection]
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = var.database_name
}

resource "random_password" "app" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.this.name
  name     = var.user_name
  password = random_password.app.result
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "${var.name}-database-url"
  replication {
    auto {}
  }
}

# sslmode=no-verify: traffic stays on the VPC's private IP and is encrypted (ENCRYPTED_ONLY);
# the client doesn't pin the instance's server CA.
resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://${var.user_name}:${random_password.app.result}@${google_sql_database_instance.this.private_ip_address}:5432/${var.database_name}?sslmode=no-verify"
}
