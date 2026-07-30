# SmartPay — Shopify + Smartrr Subscription Performance

SmartPay is a GitHub Actions ETL and static GitHub Pages dashboard. Shopify is the source of truth for orders, discounts, returns, products, unit costs, COGS and margins. Smartrr is the source of truth for subscription contracts and billing dates.

## Important subscription correction

Subscription discovery no longer depends on the selected order report year. Every run builds the Smartrr customer universe from subscription-tagged Shopify orders beginning at `2025-01-01`, then includes emails preserved in prior order and subscription datasets. This allows subscriptions created in 2025 to remain visible during 2026 even when no new subscription was created in 2026.

Status handling:

- `active`, `paused`, and `cancelled`: confirmed from a Smartrr status or cancellation date.
- `active_inferred`: status was missing, but Smartrr provided a future billing date.
- `unknown`: neither a usable status nor a future billing date was available.

The dashboard displays confirmed and inferred active subscriptions separately. Unknown records are never treated as cancelled. Churn is shown only as an estimated current-snapshot ratio using dated YTD cancellations.

## Repository configuration

Secrets:

- `SHOPIFY_ACCESS_TOKEN`
- `SMARTRR_ACCESS_TOKEN`

Variables:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional)
- `ORDERS_LOOKBACK_DAYS` (optional)
- `SUBSCRIPTION_HISTORY_START` (optional, defaults to `2025-01-01T00:00:00Z`)

## Full historical refresh

Run **Subscriptions ETL** twice:

1. `report_year = 2025`
2. `report_year = 2026`

The subscription customer universe is rebuilt from 2025 onward on both runs, while the order datasets are merged and deduplicated by order ID.
