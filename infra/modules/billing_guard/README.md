# billing_guard

CR-8 backstop. A monthly Cloud Billing budget for the project (alerts at 50%, 90%, 100%)
publishes to Pub/Sub; the `kill-switch` function pauses every Cloud Scheduler job in the region
once spend reaches 100%, which stops all ticks. CR-7's daily ledger is the primary control
because billing data lags by hours.

To resume after a pause (once the cause is fixed):

    gcloud scheduler jobs resume worker-tick --location=REGION   # and collect, nightly, event

`function/` is plain Node with no dependencies beyond the Functions Framework; its tests run
with `node --test infra/modules/billing_guard/function`.
