# Infrastructure

Terraform for GCP, laid out as the PRD describes. Phase 1 provisions only the worker side:

- Cloud SQL (private IP)
- the worker on Cloud Run
- Scheduler → Pub/Sub → push, with dead-letter queues
- Secret Manager
- Artifact Registry
- the billing kill switch
- alerts

Web and the load balancer (`edge`) come in Phase 2, and Model Armor in Phase 3.

```
bootstrap/        state bucket + Workload Identity Federation for GitHub Actions (applied once, by hand)
envs/dev/         the dev environment (applied by CI on merge to main)
modules/          project, network, database, security, cloud_run_service, scheduling,
                  billing_guard, observability
```

## First-time setup (dev)

You need a GCP project with billing enabled, `gcloud` logged in as an owner, and Terraform 1.9
or newer.

1. **Bootstrap** (local state, once):

   ```bash
   cd infra/bootstrap
   terraform init
   terraform apply -var project_id=PROJECT -var github_repository=adamfriedl/humbled \
     -var billing_account_id=XXXXXX-XXXXXX-XXXXXX
   ```

   After step 2 (once the Anthropic key exists), set these GitHub repository variables
   (Settings → Secrets and variables → Actions → Variables). The deploy workflow skips every
   job until they exist, and setting them earlier lets a merge apply Terraform before the
   worker's secret has a value:

   | variable                         | value                                               |
   | -------------------------------- | --------------------------------------------------- |
   | `GCP_PROJECT_ID`                 | the project                                         |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | bootstrap output `workload_identity_provider`       |
   | `GCP_DEPLOYER_SERVICE_ACCOUNT`   | bootstrap output `deployer_service_account`         |
   | `TF_STATE_BUCKET`                | bootstrap output `state_bucket`                     |
   | `GCP_BILLING_ACCOUNT_ID`         | the billing account (enables the CR-8 kill switch)  |
   | `GCP_REGION`                     | optional, defaults to `us-central1`                 |
   | `ALERT_EMAILS`                   | optional, a JSON list such as `["you@example.com"]` |

   Also create a GitHub environment named `dev`. The deploy job runs in it, so you can add
   protection rules later.

2. **Create the secrets first, then add the Anthropic key.** Cloud Run won't start a revision
   whose secret has no version, so this comes before the full apply:

   ```bash
   cd infra/envs/dev
   cp terraform.tfvars.example terraform.tfvars   # fill in
   terraform init -backend-config=bucket=PROJECT-tfstate
   terraform apply -target=module.security
   printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets versions add anthropic-api-key --data-file=-
   ```

3. **Apply everything:** `terraform apply` (or merge to main and let the deploy workflow do it).
   The worker starts on a placeholder image. The deploy workflow (`.github/workflows/deploy.yml`)
   builds the real one and deploys it by digest on every merge to main. The dead-letter queues
   stay empty in the meantime, because the placeholder answers 200. Pull requests get a
   `terraform plan` comment.

4. **Lock files:** the first `terraform init` on a machine with normal registry access writes
   `.terraform.lock.hcl` in `bootstrap/` and `envs/dev/`. Add the other platforms and commit them:

   ```bash
   terraform providers lock -platform=linux_amd64 -platform=darwin_arm64
   ```

5. **Anthropic spend limit:** set a monthly limit in the Anthropic Console (CR-8). It's the one
   piece that isn't Terraform.

## Teardown

`terraform destroy` in `envs/dev` removes everything billable. Deletion protection is off in
dev. The state bucket and the WIF pool from `bootstrap/` stay behind and cost nothing at rest.

## Checks

CI runs `terraform fmt`, `validate`, `tflint` and `checkov` on every PR, plus the kill-switch
tests. Every checkov skip is inline with its reason.
