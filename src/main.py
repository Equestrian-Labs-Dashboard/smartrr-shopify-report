"""
Main ETL entrypoint.

Pipeline:
  1. Pull subscription-tagged orders from Shopify (source of truth for revenue/items),
     limited to the last ORDERS_LOOKBACK_DAYS days (default 90) so this stays fast.
  2. Extract unique customer emails from those orders.
  3. Look up each customer's subscription status/details in Smartrr.
  4. Merge Shopify order data + Smartrr subscription data.
  5. Write report to data/subscriptions_report.csv and data/subscriptions_report.json.

Run locally:
  SHOPIFY_STORE_DOMAIN=corro.myshopify.com \
  SHOPIFY_ACCESS_TOKEN=xxx \
  SMARTRR_ACCESS_TOKEN=xxx \
  python src/main.py

In GitHub Actions, these come from repo Secrets/Variables (see .github/workflows/etl.yml).
"""

import os
import sys
import datetime
import pandas as pd

from shopify_client import ShopifyClient
from smartrr_client import SmartrrClient
from sheets_client import SheetsClient

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def log(msg):
    print(msg, flush=True)


def main():
    lookback_days = int(os.environ.get("ORDERS_LOOKBACK_DAYS") or 90)
    created_at_min = (
        datetime.datetime.utcnow() - datetime.timedelta(days=lookback_days)
    ).strftime("%Y-%m-%dT00:00:00Z")

    shopify = ShopifyClient(
        store_domain=os.environ["SHOPIFY_STORE_DOMAIN"],
        access_token=os.environ["SHOPIFY_ACCESS_TOKEN"],
        api_version=os.environ.get("SHOPIFY_API_VERSION") or "2025-01",
    )
    smartrr = SmartrrClient(access_token=os.environ["SMARTRR_ACCESS_TOKEN"])

    log(f"Fetching subscription-tagged orders from Shopify (last {lookback_days} days)...")
    orders = shopify.get_subscription_orders(created_at_min=created_at_min)
    log(f"  {len(orders)} orders found")

    order_rows = []
    emails = set()
    for order in orders:
        email = (order.get("customer") or {}).get("email") or order.get("email")
        if not email:
            continue
        emails.add(email)
        order_rows.append({
            "order_id": order.get("id"),
            "order_name": order.get("name"),
            "customer_email": email,
            "total_price": order.get("total_price"),
            "created_at": order.get("created_at"),
            "financial_status": order.get("financial_status"),
            "fulfillment_status": order.get("fulfillment_status"),
            "tags": order.get("tags"),
        })

    log(f"Looking up {len(emails)} unique customers in Smartrr...")
    subscription_rows = []
    for i, email in enumerate(sorted(emails), start=1):
        raw = smartrr.get_customer_subscriptions(email)
        subscription_rows.extend(smartrr.parse_subscriptions(email, raw))
        if i % 10 == 0 or i == len(emails):
            log(f"  {i}/{len(emails)} customers processed")

    orders_df = pd.DataFrame(order_rows)
    subs_df = pd.DataFrame(subscription_rows)

    # Merge: one row per Shopify order, enriched with the customer's current
    # subscription status/plan/next order date from Smartrr.
    if not subs_df.empty:
        merged_df = orders_df.merge(subs_df, on="customer_email", how="left")
    else:
        merged_df = orders_df

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    csv_path = os.path.join(OUTPUT_DIR, "subscriptions_report.csv")
    json_path = os.path.join(OUTPUT_DIR, "subscriptions_report.json")

    merged_df.to_csv(csv_path, index=False)
    merged_df.to_json(json_path, orient="records", indent=2)

    log(f"Report written: {csv_path} ({len(merged_df)} rows)")

    # --- Google Sheets export (optional: only runs if credentials are set) ---
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    spreadsheet_id = os.environ.get("SPREADSHEET_ID")
    if sa_json and spreadsheet_id:
        log("Writing to Google Sheets...")
        sheets = SheetsClient(service_account_json=sa_json, spreadsheet_id=spreadsheet_id)
        sheets.write_live(merged_df)
        log("  'Live' tab updated")
        sheets.upsert_by_year(merged_df)
        log("Google Sheets export done")
    else:
        log("Skipping Google Sheets export (GOOGLE_SERVICE_ACCOUNT_JSON / SPREADSHEET_ID not set)")


if __name__ == "__main__":
    main()
