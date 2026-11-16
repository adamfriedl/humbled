# scheduling

Cloud Scheduler → Pub/Sub → authenticated push to the worker, one topic per job (`tick` every
15 minutes, `collect` every 5, `nightly` 03:00 and `event` 06:00 Pacific). Each push subscription
retries with backoff and dead-letters after `max_delivery_attempts`; every dead-letter topic has
a pull subscription for inspection. Message retention is short for frequent jobs: a tick that
couldn't run in its own 15 minutes isn't worth running late.

Inspect a dead-letter queue:

    gcloud pubsub subscriptions pull worker-tick-dlq-pull --limit=10 --auto-ack
