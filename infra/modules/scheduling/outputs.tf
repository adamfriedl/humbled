output "scheduler_job_names" {
  description = "Scheduler job names (the kill switch pauses these)."
  value       = [for j in google_cloud_scheduler_job.job : j.name]
}

output "dead_letter_subscriptions" {
  description = "Dead-letter pull subscriptions, for alerting and inspection."
  value       = { for k, s in google_pubsub_subscription.dead_letter : k => s.name }
}
