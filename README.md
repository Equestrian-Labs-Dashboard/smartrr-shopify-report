# Shopify + Smartrr Report

This project runs a scheduled GitHub Actions ETL that retrieves subscription-tagged Shopify orders, looks up the related customers in Smartrr, writes two independent datasets, exports them to Google Sheets, and publishes a static dashboard through GitHub Pages.

## Data model

The project deliberately keeps orders and subscriptions separate:

- `data/orders_report.csv` and `data/orders_report.json`: one row per Shopify order, deduplicated by `order_id`.
- `data/subscriptions_report.csv` and `data/subscriptions_report.json`: one row per Smartrr subscription, deduplicated by `subscription_id`.

Orders are never joined to every subscription belonging to the same customer. This prevents one Shopify order from appearing multiple times and prevents inflated order and revenue totals.

## GitHub configuration

Add these repository secrets:

- `SHOPIFY_ACCESS_TOKEN`
- `SMARTRR_ACCESS_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (optional)

Add these repository variables:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION` (optional; defaults to `2025-01`)
- `ORDERS_LOOKBACK_DAYS` (optional; defaults to `90`)
- `SPREADSHEET_ID` (optional)

## Running the ETL

The workflow runs daily at 09:00 UTC. It can also be run manually from **Actions → Subscriptions ETL → Run workflow**.

For a complete calendar-year query, enter a four-digit value in `report_year`, such as `2025`. Leave it empty for the normal rolling update.

## Google Sheets output

When Google Sheets credentials are configured, the ETL writes:

- `Orders`: one row per Shopify order.
- `Subscriptions`: one row per Smartrr subscription.
- `Orders 2025`, `Orders 2026`, and similar tabs: order-only yearly views.

## GitHub Pages

The dashboard reads both JSON files from the `data` directory. Configure Pages to deploy from the `main` branch and the repository root.

After an Action completes, GitHub Pages CDN propagation can take several minutes. You can verify the files directly at:

- `/data/orders_report.json`
- `/data/subscriptions_report.json`
