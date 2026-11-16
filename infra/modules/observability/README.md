# observability

Alert policies for the Phase 1 gate: any message in a worker dead-letter queue, and any
`handler_error` or `batch_sla_exceeded` log line from the worker (log-based metrics on the
JSON `message` field). Optional email channels.
