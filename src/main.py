"""Shopify + Smartrr ETL.

Produces two independent datasets:
- orders_report: exactly one row per Shopify order.
- subscriptions_report: exactly one row per Smartrr subscription.

The datasets are intentionally not joined, because joining every customer order to every
customer subscription multiplies rows and inflates revenue and order counts.
"""

import datetime as dt
import os
from pathlib import Path

import pandas as pd

from shopify_client import ShopifyClient
from smartrr_client import SmartrrClient
from sheets_client import SheetsClient

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent if BASE_DIR.name == "src" else BASE_DIR
OUTPUT_DIR = PROJECT_ROOT / "data"


def log(message: str) -> None:
    print(message, flush=True)


def query_window():
    """Return Shopify created_at boundaries and a readable label."""
    report_year = (os.environ.get("REPORT_YEAR") or "").strip()
    if report_year:
        if not report_year.isdigit() or len(report_year) != 4:
            raise ValueError("REPORT_YEAR must be a four-digit year, for example 2025.")
        year = int(report_year)
        return (
            f"{year}-01-01T00:00:00Z",
            f"{year + 1}-01-01T00:00:00Z",
            f"calendar year {year}",
        )

    lookback_days = int(os.environ.get("ORDERS_LOOKBACK_DAYS") or 90)
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)
    return start.strftime("%Y-%m-%dT00:00:00Z"), None, f"last {lookback_days} days"


def normalize_orders(orders: list[dict], updated_at: str) -> pd.DataFrame:
    rows = []
    for order in orders:
        email = ((order.get("customer") or {}).get("email") or order.get("email") or "").strip().lower()
        rows.append({
            "order_id": str(order.get("id") or ""),
            "order_name": order.get("name"),
            "customer_email": email,
            "total_price": order.get("total_price"),
            "currency": order.get("currency"),
            "created_at": order.get("created_at"),
            "financial_status": order.get("financial_status"),
            "fulfillment_status": order.get("fulfillment_status"),
            "tags": order.get("tags"),
            "report_updated_at": updated_at,
        })

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df[df["order_id"].astype(str).str.len() > 0]
    df = df.drop_duplicates(subset=["order_id"], keep="last")
    return df.sort_values("created_at", ascending=False, na_position="last").reset_index(drop=True)


def normalize_subscriptions(rows: list[dict], updated_at: str) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["customer_email"] = df["customer_email"].fillna("").astype(str).str.strip().str.lower()
    df["report_updated_at"] = updated_at

    # subscription_id is the real key. Fallback prevents blank IDs from collapsing
    # every customer into one row while still keeping the dataset deterministic.
    df["_subscription_key"] = df["subscription_id"].fillna("").astype(str)
    missing = df["_subscription_key"].eq("")
    df.loc[missing, "_subscription_key"] = (
        df.loc[missing, "customer_email"] + "|" + df.loc[missing, "plan_id"].fillna("").astype(str)
    )
    df = df.drop_duplicates(subset=["_subscription_key"], keep="last")
    df = df.drop(columns=["_subscription_key"])
    return df.sort_values(["customer_email", "subscription_id"], na_position="last").reset_index(drop=True)


def merge_history(new_df: pd.DataFrame, path: Path, key: str) -> pd.DataFrame:
    """Update matching records while preserving data from previous year queries."""
    frames = []
    if path.exists():
        try:
            frames.append(pd.read_csv(path, dtype=str))
        except (pd.errors.EmptyDataError, OSError):
            pass
    if not new_df.empty:
        frames.append(new_df)
    if not frames:
        return pd.DataFrame()

    result = pd.concat(frames, ignore_index=True, sort=False)
    if key in result.columns:
        nonblank = result[key].fillna("").astype(str).ne("")
        keyed = result[nonblank].drop_duplicates(subset=[key], keep="last")
        unkeyed = result[~nonblank]
        result = pd.concat([keyed, unkeyed], ignore_index=True, sort=False)
    return result.reset_index(drop=True)


def write_dataset(df: pd.DataFrame, stem: str) -> tuple[Path, Path]:
    csv_path = OUTPUT_DIR / f"{stem}.csv"
    json_path = OUTPUT_DIR / f"{stem}.json"
    df.to_csv(csv_path, index=False)
    df.to_json(json_path, orient="records", indent=2, force_ascii=False)
    return csv_path, json_path


def main() -> None:
    created_at_min, created_at_max, label = query_window()
    updated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    shopify = ShopifyClient(
        store_domain=os.environ["SHOPIFY_STORE_DOMAIN"],
        access_token=os.environ["SHOPIFY_ACCESS_TOKEN"],
        api_version=os.environ.get("SHOPIFY_API_VERSION") or "2025-01",
    )
    smartrr = SmartrrClient(access_token=os.environ["SMARTRR_ACCESS_TOKEN"])

    log(f"Fetching Shopify subscription orders for {label}...")
    raw_orders = shopify.get_subscription_orders(
        created_at_min=created_at_min,
        created_at_max=created_at_max,
    )
    current_orders = normalize_orders(raw_orders, updated_at)
    log(f"  {len(current_orders)} unique Shopify orders found")

    emails = sorted(set(current_orders.get("customer_email", pd.Series(dtype=str)).dropna()) - {""})
    subscription_rows = []
    log(f"Fetching Smartrr subscriptions for {len(emails)} unique customers...")
    for index, email in enumerate(emails, start=1):
        try:
            raw = smartrr.get_customer_subscriptions(email)
            subscription_rows.extend(smartrr.parse_subscriptions(email, raw))
        except Exception as exc:
            log(f"  WARNING: Smartrr lookup failed for {email}: {exc}")
        if index % 10 == 0 or index == len(emails):
            log(f"  {index}/{len(emails)} customers processed")

    current_subscriptions = normalize_subscriptions(subscription_rows, updated_at)
    log(f"  {len(current_subscriptions)} unique Smartrr subscriptions found")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    orders_csv = OUTPUT_DIR / "orders_report.csv"
    subscriptions_csv = OUTPUT_DIR / "subscriptions_report.csv"

    all_orders = merge_history(current_orders, orders_csv, "order_id")
    all_subscriptions = merge_history(current_subscriptions, subscriptions_csv, "subscription_id")

    write_dataset(all_orders, "orders_report")
    write_dataset(all_subscriptions, "subscriptions_report")
    log(f"Orders report written: {len(all_orders)} unique orders")
    log(f"Subscriptions report written: {len(all_subscriptions)} unique subscriptions")

    service_account_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    spreadsheet_id = os.environ.get("SPREADSHEET_ID")
    if service_account_json and spreadsheet_id:
        log("Writing separate Orders and Subscriptions tabs to Google Sheets...")
        sheets = SheetsClient(service_account_json, spreadsheet_id)
        sheets.write_orders(all_orders)
        sheets.write_subscriptions(all_subscriptions)
        sheets.write_order_year_tabs(all_orders)
        log("Google Sheets export completed")
    else:
        log("Skipping Google Sheets export: credentials or SPREADSHEET_ID not set")


if __name__ == "__main__":
    main()
