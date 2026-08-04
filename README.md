# SmartPay — Shopify + Smartrr Analytics

This version separates metrics by source and confidence.

## Sources

- **Shopify:** orders, discounts, returns, product lines, unit costs, net sales, COGS, gross profit and gross margin.
- **Smartrr vendor customer lookup:** subscription records, readable contract status and future billing dates.
- **Smartrr Advanced Analytics:** active subscriptions, churn, CLTV and subscription revenue are a separate analytics dataset. The vendor lookup endpoint does not guarantee the same results.

## Important correction

Subscription status is now read only from the subscription contract object. Parent formatted-order status is never used to overwrite a subscription status. This prevents active subscriptions from being incorrectly classified as cancelled.

Unknown subscription statuses are excluded from active and cancelled counts. A future billing date is shown as `active_inferred`, not as a confirmed active status.

## Optional official Smartrr metrics

To display the same headline values shown in Smartrr Advanced Analytics, add repository variables populated from its export:

- `SMARTRR_OFFICIAL_ACTIVE_SUBSCRIPTIONS`
- `SMARTRR_OFFICIAL_CHURN_RATE` as a decimal, e.g. `0.3421`
- `SMARTRR_OFFICIAL_CLTV`
- `SMARTRR_OFFICIAL_SUBSCRIPTION_REVENUE`

When these are absent, the dashboard clearly labels operational or derived metrics and leaves churn unavailable rather than displaying a false `100%`.

## Rebuild

Run the workflow for:

1. `2025`
2. `2026`

Set `SUBSCRIPTION_HISTORY_START=2025-01-01T00:00:00Z`.
