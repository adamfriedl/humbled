# A small VPC with one subnet for Cloud Run's Direct VPC egress (no Serverless VPC Access
# connector, which bills for always-on instances, CR-9), plus private service access so Cloud
# SQL has only a private IP.
resource "google_compute_network" "this" {
  project                 = var.project_id
  name                    = var.name
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "${var.name}-run"
  network                  = google_compute_network.this.id
  region                   = var.region
  ip_cidr_range            = var.run_subnet_cidr
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.1
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "${var.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.this.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.this.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  # Cloud SQL releases the peering lazily, so DELETE fails with "Producer services are still
  # using this connection" for hours after the instance is gone. The peering goes with the VPC.
  deletion_policy = "ABANDON"
}

# Nothing in this VPC accepts ingress: Cloud Run uses it for egress only, and Cloud SQL is
# reached over the private services peering.
resource "google_compute_firewall" "deny_ingress" {
  project   = var.project_id
  name      = "${var.name}-deny-all-ingress"
  network   = google_compute_network.this.id
  direction = "INGRESS"
  priority  = 65534

  deny {
    protocol = "all"
  }
  source_ranges = ["0.0.0.0/0"]

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}
