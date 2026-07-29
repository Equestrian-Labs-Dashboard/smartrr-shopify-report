"""SmartPay Shopify + Smartrr ETL.

Shopify is the source of truth for orders, discounts, returns, products and unit costs.
Smartrr is the source of truth for subscription records, status and billing dates.
The datasets remain separate so subscription rows never multiply Shopify revenue.
"""

from __future__ import annotations

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


def number(value, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def query_window() -> tuple[str, str | None, str]:
    report_year = (os.environ.get("REPORT_YEAR") or "").strip()
    if report_year:
        if not report_year.isdigit() or len(report_year) != 4:
            raise ValueError("REPORT_YEAR must be a four-digit year, for example 2026.")
        year = int(report_year)
        return f"{year}-01-01T00:00:00Z", f"{year + 1}-01-01T00:00:00Z", f"calendar year {year}"

    lookback_days = int(os.environ.get("ORDERS_LOOKBACK_DAYS") or 120)
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)
    return start.strftime("%Y-%m-%dT00:00:00Z"), None, f"last {lookback_days} days"


def refund_details(order: dict) -> tuple[dict[str, float], dict[str, float]]:
    """Return refunded quantity and merchandise subtotal by line-item ID."""
    quantities: dict[str, float] = {}
    subtotals: dict[str, float] = {}
    for refund in order.get("refunds") or []:
        for refund_line in refund.get("refund_line_items") or []:
            line = refund_line.get("line_item") or {}
            line_id = str(refund_line.get("line_item_id") or line.get("id") or "")
            if not line_id:
                continue
            quantities[line_id] = quantities.get(line_id, 0.0) + number(refund_line.get("quantity"))
            subtotals[line_id] = subtotals.get(line_id, 0.0) + number(refund_line.get("subtotal"))
    return quantities, subtotals


def allocated_discount(item: dict) -> float:
    allocations = item.get("discount_allocations") or []
    if allocations:
        return sum(number(allocation.get("amount")) for allocation in allocations)
    return number(item.get("total_discount"))


def distribute_delta(items: list[dict], field: str, delta: float, weight_field: str) -> None:
    """Distribute a small order-level reconciliation delta across line items."""
    if abs(delta) < 0.005 or not items:
        return
    weights = [max(number(item.get(weight_field)), 0.0) for item in items]
    total_weight = sum(weights)
    if total_weight <= 0:
        items[0][field] = number(items[0].get(field)) + delta
        return
    remaining = delta
    for index, item in enumerate(items):
        share = remaining if index == len(items) - 1 else delta * weights[index] / total_weight
        item[field] = number(item.get(field)) + share
        remaining -= share


def normalize_orders(orders: list[dict], unit_costs: dict[str, float | None], updated_at: str) -> pd.DataFrame:
    rows: list[dict] = []

    for order in orders:
        refunded_qty, refunded_subtotal = refund_details(order)
        raw_items = order.get("line_items") or []
        line_items: list[dict] = []

        gross_sales = number(order.get("total_line_items_price"))
        original_subtotal = number(order.get("subtotal_price"), gross_sales - number(order.get("total_discounts")))
        current_subtotal = number(order.get("current_subtotal_price"), original_subtotal)
        discounts = max(gross_sales - original_subtotal, 0.0)
        returns = max(original_subtotal - current_subtotal, 0.0)
        net_sales = max(current_subtotal, 0.0)

        for item in raw_items:
            line_id = str(item.get("id") or "")
            quantity = max(number(item.get("quantity")), 0.0)
            returned_quantity = min(max(refunded_qty.get(line_id, 0.0), 0.0), quantity)
            net_quantity = max(quantity - returned_quantity, 0.0)
            unit_price = number(item.get("price"))
            line_gross = unit_price * quantity
            line_discount = max(allocated_discount(item), 0.0)
            line_return = max(refunded_subtotal.get(line_id, 0.0), 0.0)
            variant_id = str(item.get("variant_id") or "")
            unit_cost = unit_costs.get(variant_id) if variant_id else None

            line_items.append({
                "line_item_id": line_id,
                "product_id": str(item.get("product_id") or ""),
                "variant_id": variant_id,
                "product": item.get("title") or item.get("name") or "Unknown product",
                "variant": item.get("variant_title") or "",
                "sku": item.get("sku") or "",
                "quantity": round(quantity, 4),
                "returned_quantity": round(returned_quantity, 4),
                "net_quantity": round(net_quantity, 4),
                "unit_price": round(unit_price, 4),
                "gross_sales": round(line_gross, 4),
                "discounts": round(line_discount, 4),
                "returns": round(line_return, 4),
                "net_sales": round(max(line_gross - line_discount - line_return, 0.0), 4),
                "unit_cost": unit_cost,
            })

        # Shopify may include order-level discounts not fully represented in line-item fields.
        distribute_delta(line_items, "discounts", discounts - sum(number(x["discounts"]) for x in line_items), "gross_sales")
        for item in line_items:
            item["net_sales"] = max(number(item["gross_sales"]) - number(item["discounts"]) - number(item["returns"]), 0.0)

        # Reconcile line-level net sales to Shopify current_subtotal_price after edits/refunds.
        distribute_delta(line_items, "net_sales", net_sales - sum(number(x["net_sales"]) for x in line_items), "net_sales")

        net_units = sum(number(item["net_quantity"]) for item in line_items)
        covered_units = sum(
            number(item["net_quantity"]) for item in line_items
            if item.get("unit_cost") is not None
        )
        cogs = sum(
            number(item["net_quantity"]) * number(item.get("unit_cost")) for item in line_items
            if item.get("unit_cost") is not None
        )
        complete_costs = net_units > 0 and abs(covered_units - net_units) < 0.0001
        gross_profit = net_sales - cogs if complete_costs else None
        gross_margin = gross_profit / net_sales if gross_profit is not None and net_sales > 0 else None

        for item in line_items:
            item_complete = item.get("unit_cost") is not None
            item_cogs = number(item["net_quantity"]) * number(item.get("unit_cost")) if item_complete else None
            item_gp = number(item["net_sales"]) - item_cogs if item_cogs is not None else None
            item_gm = item_gp / number(item["net_sales"]) if item_gp is not None and number(item["net_sales"]) > 0 else None
            item["cogs"] = round(item_cogs, 4) if item_cogs is not None else None
            item["gross_profit"] = round(item_gp, 4) if item_gp is not None else None
            item["gross_margin"] = round(item_gm, 8) if item_gm is not None else None

        tags = str(order.get("tags") or "")
        lower_tags = tags.lower()
        order_type = "first" if "first order" in lower_tags else "recurring" if "recurring order" in lower_tags else "subscription"
        product_text = " ".join(f"{item['product']} {item['variant']} {item['sku']}" for item in line_items).lower()
        horse_health_30 = "horse health" in product_text and any(token in product_text for token in ("30 lb", "30lb", "30 pound", "30-pound"))
        zero_margin = gross_margin is not None and abs(gross_margin) < 0.0001

        customer = order.get("customer") or {}
        rows.append({
            "order_id": str(order.get("id") or ""),
            "order_name": order.get("name"),
            "customer_id": str(customer.get("id") or ""),
            "customer_email": (customer.get("email") or order.get("email") or "").strip().lower(),
            "currency": order.get("currency") or "USD",
            "created_at": order.get("created_at"),
            "cancelled_at": order.get("cancelled_at"),
            "financial_status": order.get("financial_status"),
            "fulfillment_status": order.get("fulfillment_status"),
            "tags": tags,
            "subscription_order_type": order_type,
            "discount_codes": json.dumps(order.get("discount_codes") or [], ensure_ascii=False, separators=(",", ":")),
            "gross_sales": round(gross_sales, 2),
            "discounts": round(discounts, 2),
            "returns": round(returns, 2),
            "net_sales": round(net_sales, 2),
            "sales_formula_check": round(gross_sales - discounts - returns - net_sales, 2),
            "shopify_subtotal_price": round(original_subtotal, 2),
            "shopify_current_subtotal_price": round(current_subtotal, 2),
            "order_total": round(number(order.get("current_total_price"), number(order.get("total_price"))), 2),
            "tax": round(number(order.get("total_tax")), 2),
            "shipping": round(number((((order.get("total_shipping_price_set") or {}).get("shop_money") or {}).get("amount"))), 2),
            "net_units": round(net_units, 4),
            "covered_cost_units": round(covered_units, 4),
            "cost_coverage_pct": round(covered_units / net_units, 8) if net_units > 0 else None,
            "margin_status": "complete" if complete_costs else "missing_costs",
            "cogs": round(cogs, 2) if complete_costs else None,
            "gross_profit": round(gross_profit, 2) if gross_profit is not None else None,
            "gross_margin": round(gross_margin, 8) if gross_margin is not None else None,
            "audit_priority": bool(horse_health_30 or zero_margin),
            "audit_reason": "Horse Health 30 lb" if horse_health_30 else "Zero gross margin" if zero_margin else "",
            "line_items": json.dumps(line_items, ensure_ascii=False, separators=(",", ":")),
            "report_updated_at": updated_at,
        })

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame = frame[frame["order_id"].astype(str).str.len() > 0]
    return frame.drop_duplicates("order_id", keep="last").sort_values("created_at", ascending=False).reset_index(drop=True)


def normalize_subscriptions(rows: list[dict], updated_at: str) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame["customer_email"] = frame["customer_email"].fillna("").astype(str).str.strip().str.lower()
    frame["report_updated_at"] = updated_at
    frame["_key"] = frame["subscription_id"].fillna("").astype(str)
    missing = frame["_key"].eq("")
    frame.loc[missing, "_key"] = (
        frame.loc[missing, "customer_email"] + "|" + frame.loc[missing, "plan_id"].fillna("").astype(str)
    )
    return frame.drop_duplicates("_key", keep="last").drop(columns="_key").reset_index(drop=True)


def merge_history(new_frame: pd.DataFrame, path: Path, key: str) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    if path.exists():
        try:
            frames.append(pd.read_csv(path, dtype=str))
        except (pd.errors.EmptyDataError, OSError):
            pass
    if not new_frame.empty:
        frames.append(new_frame)
    if not frames:
        return pd.DataFrame()
    result = pd.concat(frames, ignore_index=True, sort=False)
    if key in result.columns:
        result = result[result[key].fillna("").astype(str).ne("")].drop_duplicates(key, keep="last")
    return result.reset_index(drop=True)


def write_dataset(frame: pd.DataFrame, stem: str) -> None:
    frame.to_csv(OUTPUT_DIR / f"{stem}.csv", index=False)
    frame.to_json(OUTPUT_DIR / f"{stem}.json", orient="records", indent=2, force_ascii=False)


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
    variant_ids = [
        str(item.get("variant_id"))
        for order in raw_orders
        for item in (order.get("line_items") or [])
        if item.get("variant_id")
    ]
    log(f"Fetching Shopify unit costs for {len(set(variant_ids))} variants...")
    try:
        unit_costs = shopify.get_variant_unit_costs(variant_ids)
    except Exception as exc:
        log(f"WARNING: Shopify unit costs could not be loaded: {exc}")
        unit_costs = {}

    current_orders = normalize_orders(raw_orders, unit_costs, updated_at)
    emails = sorted(set(current_orders.get("customer_email", pd.Series(dtype=str)).dropna()) - {""})
    subscription_rows: list[dict] = []
    log(f"Fetching Smartrr subscriptions for {len(emails)} unique customers...")
    for index, email in enumerate(emails, 1):
        try:
            subscription_rows.extend(smartrr.parse_subscriptions(email, smartrr.get_customer_subscriptions(email)))
        except Exception as exc:
            log(f"WARNING: Smartrr lookup failed for {email}: {exc}")
        if index % 10 == 0 or index == len(emails):
            log(f"  {index}/{len(emails)} customers processed")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_orders = merge_history(current_orders, OUTPUT_DIR / "orders_report.csv", "order_id")
    all_subscriptions = merge_history(
        normalize_subscriptions(subscription_rows, updated_at),
        OUTPUT_DIR / "subscriptions_report.csv",
        "subscription_id",
    )
    write_dataset(all_orders, "orders_report")
    write_dataset(all_subscriptions, "subscriptions_report")
    log(f"Orders report written: {len(all_orders)} unique orders")
    log(f"Subscriptions report written: {len(all_subscriptions)} unique subscriptions")


if __name__ == "__main__":
    main()
