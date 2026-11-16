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

You need a GCP project with billing enabled, `gcloud` logged in as an owner, Billing Account
Administrator on the billing account (for the budget), and Terraform 1.9 or newer. Terraform
uses Application Default Credentials, not your `gcloud` login, and some APIs (Budgets, Service
Usage) need ADC's quota project to be this project:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project PROJECT
```

`PROJECT` is the project **id** (e.g. `humbled-514915`), not its name or number. Steps 1–3
run locally; CI takes over applies after step 4.

1. **Bootstrap** (local state, once). Keep `infra/bootstrap/terraform.tfstate` safe: it's the
   only copy.

   ```bash
   cd infra/bootstrap
   terraform init
   terraform apply -var project_id=PROJECT -var github_repository=adamfriedl/humbled \
     -var billing_account_id=XXXXXX-XXXXXX-XXXXXX
   ```

   Freshly enabled APIs take a minute to propagate. If an apply fails with "API not enabled" or
   a permission error on a new service, wait and re-run it.

2. **Create the secrets, then add the Anthropic key.** Cloud Run won't start a revision whose
   secret has no version, so this comes before the full apply. `terraform.tfvars` is gitignored;
   don't commit it (a committed tfvars would override the `TF_VAR_*` values CI sets).

   ```bash
   cd infra/envs/dev
   cp terraform.tfvars.example terraform.tfvars   # fill in, project_id included
   terraform init -backend-config=bucket=PROJECT-tfstate
   terraform apply -target=module.security
   printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets versions add anthropic-api-key --data-file=- --project PROJECT
   ```

3. **Apply everything** locally, from `infra/envs/dev`: `terraform apply`. Cloud SQL and the
   private service connection take 10–15 minutes. The worker starts on a placeholder image;
   the dead-letter queues stay empty in the meantime, because the placeholder answers 200.

4. **Hand over to CI.** Only now set these GitHub repository **variables** (Settings → Secrets
   and variables → Actions → Variables, not Secrets). The deploy workflow skips every job until
   they exist; once set, every merge to main runs `terraform apply`. They must be
   repository-level, not on an environment, because the PR plan job doesn't run in one:

   | variable                         | value                                                                             |
   | -------------------------------- | --------------------------------------------------------------------------------- |
   | `GCP_PROJECT_ID`                 | the project id                                                                    |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | bootstrap output `workload_identity_provider`                                     |
   | `GCP_DEPLOYER_SERVICE_ACCOUNT`   | bootstrap output `deployer_service_account`                                       |
   | `TF_STATE_BUCKET`                | bootstrap output `state_bucket`                                                   |
   | `GCP_BILLING_ACCOUNT_ID`         | the billing account (enables the CR-8 kill switch)                                |
   | `GCP_REGION`                     | optional, defaults to `us-central1`                                               |
   | `ALERT_EMAILS`                   | optional, one address or a JSON list such as `["a@example.com", "b@example.com"]` |

   Also create a GitHub environment named `dev`. The deploy job runs in it, so you can add
   protection rules later. From here the deploy workflow (`.github/workflows/deploy.yml`)
   builds the real worker image and deploys it by digest on every merge to main, and pull
   requests get a `terraform plan` comment.

5. **Lock files:** the first `terraform init` on a machine with normal registry access writes
   `.terraform.lock.hcl` in `bootstrap/` and `envs/dev/`. Add the other platforms and commit them:

   ```bash
   terraform providers lock -platform=linux_amd64 -platform=darwin_arm64
   ```

6. **Anthropic spend limit:** set a monthly limit in the Anthropic Console (CR-8). It's the one
   piece that isn't Terraform.

## Teardown

`terraform destroy` in `envs/dev` removes everything billable. Deletion protection is off in
dev. Cloud Run's direct VPC egress holds `serverless-ipv4-*` addresses in the subnet for up
to a couple of hours after the service is deleted, so the subnet and network can fail with
`resourceInUseByAnotherResource`. Wait, and run `terraform destroy` again. The state bucket and the WIF pool from `bootstrap/` stay behind and cost nothing at rest.

## Checks

CI runs `terraform fmt`, `validate`, `tflint` and `checkov` on every PR, plus the kill-switch
tests. Every checkov skip is inline with its reason.
