output "budget_topic" {
  description = "Budget notification topic."
  value       = google_pubsub_topic.budget.id
}
