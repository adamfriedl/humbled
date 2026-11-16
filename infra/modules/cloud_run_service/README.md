# cloud_run_service

A Cloud Run (v2) service: its own service account, scale to zero by default, Direct VPC egress
for private ranges, env and Secret Manager env, a `/healthz` startup probe, and invoker
bindings. The image is ignored after creation because CI deploys by digest.
