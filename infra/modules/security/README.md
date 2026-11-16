# security

Service accounts for the worker, the Pub/Sub push identity and the kill switch, with only the
roles each needs (PRD "Terraform"). Creates the empty `anthropic-api-key` secret; add the value
out of band so it never enters Terraform state:

    printf '%s' "$KEY" | gcloud secrets versions add anthropic-api-key --data-file=-

Model Armor templates join this module in Phase 3.
