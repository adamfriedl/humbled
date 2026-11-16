# APIs the platform uses. Disabling on destroy is off: other things in the project may use them.
resource "google_project_service" "this" {
  for_each           = toset(var.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
