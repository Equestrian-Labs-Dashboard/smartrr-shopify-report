"""Shopify + Smartrr ETL for subscription performance analytics.

Shopify is the source of truth for order, sales, product and cost metrics.
Smartrr is the source of truth for subscription records and future billing dates.
Orders and subscriptions remain separate datasets to avoid duplicated revenue.
"""

import datetime as dt
import json
import os
from pathlib import Path

import pandas as pd

from shopify_client import ShopifyClient
from smartrr_client import SmartrrClient

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent if BASE_DIR.name == "src" else BASE_DIR
OUTPUT_DIR = PROJECT_ROOT / "data"


def log(message: str) -> None:
    print(message, flush=True)


def number(value, default=0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def query_window():
    report_year = (os.environ.get("REPORT_YEAR") or "").strip()
    if report_year:
        if not report_year.isdigit() or len(report_year) != 4:
            raise ValueError("REPORT_YEAR must be a four-digit year, for example 2026.")
        year = int(report_year)
        return f"{year}-01-01T00:00:00Z", f"{year + 1}-01-01T00:00:00Z", f"calendar year {year}"

    lookback_days = int(os.environ.get("ORDERS_LOOKBACK_DAYS") or 120)
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)
    return start.strftime("%Y-%m-%dT00:00:00Z"), None, f"last {lookback_days} days"


def refunded_quantities(order: dict) -> dict[str, float]:
    quantities: dict[str, float] = {}
    for refund in order.get("refunds") or []:
        for refund_line in refund.get("refund_line_items") or []:
            line_item = refund_line.get("line_item") or {}
            line_id = str(refund_line.get("line_item_id") or line_item.get("id") or "")
            quantities[line_id] = quantities.get(line_id, 0.0) + number(refund_line.get("quantity"))
    return quantities


def normalize_orders(orders: list[dict], unit_costs: dict[str, float | None], updated_at: str) -> pd.DataFrame:
    rows = []
    for order in orders:
        email = ((order.get("customer") or {}).get("email") or order.get("email") or "").strip().lower()
        refunded = refunded_quantities(order)
        products = []
        cogs = 0.0
        cost_coverage_items = 0
        net_units = 0.0

        for item in order.get("line_items") or []:
            line_id = str(item.get("id") or "")
            quantity = number(item.get("quantity"))
            returned_quantity = min(quantity, refunded.get(line_id, 0.0))
            sold_quantity = max(quantity - returned_quantity, 0.0)
            variant_id = str(item.get("variant_id") or "")
            unit_cost = unit_costs.get(variant_id)
            if unit_cost is not None:
                cogs += sold_quantity * unit_cost
                cost_coverage_items += 1
            net_units += sold_quantity
            products.append({
                "line_item_id": line_id,
                "product_id": str(item.get("product_id") or ""),
                "variant_id": variant_id,
                "product": item.get("title") or item.get("name") or "Unknown product",
                "variant": item.get("variant_title") or "",
                "sku": item.get("sku") or "",
                "quantity": quantity,
                "returned_quantity": returned_quantity,
                "net_quantity": sold_quantity,
                "unit_price": number(item.get("price")),
                "line_discount": number(item.get("total_discount")),
                "unit_cost": unit_cost,
            })

        gross_sales = number(order.get("total_line_items_price"))
        discounts = number(order.get("total_discounts"))
        original_subtotal = number(order.get("subtotal_price"), gross_sales - discounts)
        net_sales = number(order.get("current_subtotal_price"), original_subtotal)
        returns = max(original_subtotal - net_sales, 0.0)
        gross_profit = net_sales - cogs if cost_coverage_items else None
        gross_margin = (gross_profit / net_sales) if gross_profit is not None and net_sales else None

        rows.append({
            "order_id": str(order.get("id") or ""),
            "order_name": order.get("name"),
            "customer_email": email,
            "currency": order.get("currency") or "USD",
            "created_at": order.get("created_at"),
            "cancelled_at": order.get("cancelled_at"),
            "financial_status": order.get("financial_status"),
            "fulfillment_status": order.get("fulfillment_status"),
            "tags": order.get("tags"),
            "gross_sales": round(gross_sales, 2),
            "discounts": round(discounts, 2),
            "returns": round(returns, 2),
            "net_sales": round(net_sales, 2),
            "order_total": round(number(order.get("current_total_price"), number(order.get("total_price"))), 2),
            "tax": round(number(order.get("total_tax")), 2),
            "shipping": round(number((((order.get("total_shipping_price_set") or {}).get("shop_money") or {}).get("amount"))), 2),
            "net_units": round(net_units, 2),
            "cogs": round(cogs, 2) if cost_coverage_items else None,
            "gross_profit": round(gross_profit, 2) if gross_profit is not None else None,
            "gross_margin": round(gross_margin, 6) if gross_margin is not None else None,
            "cost_coverage_items": cost_coverage_items,
            "line_items": json.dumps(products, ensure_ascii=False, separators=(",", ":")),
            "report_updated_at": updated_at,
        })

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df[df["order_id"].astype(str).str.len() > 0]
    return df.drop_duplicates("order_id", keep="last").sort_values("created_at", ascending=False).reset_index(drop=True)


def normalize_subscriptions(rows: list[dict], updated_at: str) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["customer_email"] = df["customer_email"].fillna("").astype(str).str.strip().str.lower()
    df["report_updated_at"] = updated_at
    df["_key"] = df["subscription_id"].fillna("").astype(str)
    missing = df["_key"].eq("")
    df.loc[missing, "_key"] = df.loc[missing, "customer_email"] + "|" + df.loc[missing, "plan_id"].fillna("").astype(str)
    return df.drop_duplicates("_key", keep="last").drop(columns="_key").reset_index(drop=True)


def merge_history(new_df: pd.DataFrame, path: Path, key: str) -> pd.DataFrame:
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
    if key in result:
        result = result[result[key].fillna("").astype(str).ne("")].drop_duplicates(key, keep="last")
    return result.reset_index(drop=True)


def write_dataset(df: pd.DataFrame, stem: str) -> None:
    df.to_csv(OUTPUT_DIR / f"{stem}.csv", index=False)
    df.to_json(OUTPUT_DIR / f"{stem}.json", orient="records", indent=2, force_ascii=False)


def main() -> None:
    created_at_min, created_at_max, label = query_window()
    updated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    shopify = ShopifyClient(
        os.environ["SHOPIFY_STORE_DOMAIN"],
        os.environ["SHOPIFY_ACCESS_TOKEN"],
        os.environ.get("SHOPIFY_API_VERSION") or "2025-01",
    )
    smartrr = SmartrrClient(os.environ["SMARTRR_ACCESS_TOKEN"])

    log(f"Fetching Shopify subscription orders for {label}...")
    raw_orders = shopify.get_subscription_orders(created_at_min, created_at_max)
    variant_ids = [str(item.get("variant_id")) for order in raw_orders for item in (order.get("line_items") or []) if item.get("variant_id")]
    log(f"Fetching Shopify unit costs for {len(set(variant_ids))} variants...")
    try:
        unit_costs = shopify.get_variant_unit_costs(variant_ids)
    except Exception as exc:
        log(f"WARNING: unit costs could not be loaded; margin fields will remain unavailable: {exc}")
        unit_costs = {}

    current_orders = normalize_orders(raw_orders, unit_costs, updated_at)
    emails = sorted(set(current_orders.get("customer_email", pd.Series(dtype=str)).dropna()) - {""})
    log(f"Fetching Smartrr subscriptions for {len(emails)} unique customers...")
    subscription_rows = []
    for index, email in enumerate(emails, 1):
        try:
            subscription_rows.extend(smartrr.parse_subscriptions(email, smartrr.get_customer_subscriptions(email)))
        except Exception as exc:
            log(f"WARNING: Smartrr lookup failed for {email}: {exc}")
        if index % 10 == 0 or index == len(emails):
            log(f"  {index}/{len(emails)} customers processed")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_orders = merge_history(current_orders, OUTPUT_DIR / "orders_report.csv", "order_id")
    all_subscriptions = merge_history(normalize_subscriptions(subscription_rows, updated_at), OUTPUT_DIR / "subscriptions_report.csv", "subscription_id")
    write_dataset(all_orders, "orders_report")
    write_dataset(all_subscriptions, "subscriptions_report")
    log(f"Orders report written: {len(all_orders)} unique orders")
    log(f"Subscriptions report written: {len(all_subscriptions)} unique subscriptions")


if __name__ == "__main__":
    main()
