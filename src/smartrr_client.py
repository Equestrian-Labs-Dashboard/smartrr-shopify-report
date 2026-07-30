"""Smartrr API client for SmartPay analytics.

Important:
- /vendor/order/formatted is a customer lookup endpoint, not the same dataset used
  by Smartrr Advanced Analytics (Looker).
- Status is read only from the subscription/contract object. Parent order records
  are not allowed to overwrite subscription status because that caused active
  subscriptions to be misclassified as cancelled.
- Future billing dates create an explicit operational inference, never a confirmed status.
"""

from __future__ import annotations

import datetime as dt
import json
import time
from typing import Any

import requests


class SmartrrClient:
    BASE_URL = "https://api.smartrr.com/vendor"

    def __init__(self, access_token: str):
        self.headers = {
            "x-smartrr-access-token": access_token,
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: dict | None = None) -> dict:
        response = None
        for attempt in range(5):
            response = requests.get(
                f"{self.BASE_URL}{path}",
                headers=self.headers,
                params=params,
                timeout=45,
            )
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(min(2**attempt, 16))
                continue
            response.raise_for_status()
            return response.json()
        if response is not None:
            response.raise_for_status()
        return {}

    def get_customer_subscriptions(self, email_or_name: str) -> dict:
        return self._get(
            "/order/formatted",
            {"filterLike[emailOrName]": email_or_name},
        )

    @staticmethod
    def _first(source: dict, *keys):
        if not isinstance(source, dict):
            return None
        for key in keys:
            value = source.get(key)
            if value not in (None, ""):
                return value
        return None

    @classmethod
    def _first_across(cls, sources: list[dict], *keys):
        for source in sources:
            value = cls._first(source, *keys)
            if value not in (None, ""):
                return value
        return None

    @staticmethod
    def _normalize_status(value) -> str | None:
        if value in (None, ""):
            return None
        text = str(value).strip().lower().replace("_", " ").replace("-", " ")
        if any(token in text for token in ("cancel", "terminated", "ended", "inactive", "deactivated")):
            return "cancelled"
        if any(token in text for token in ("pause", "paused", "hold", "on hold")):
            return "paused"
        if any(token in text for token in ("active", "enabled", "live", "subscribed", "open")):
            return "active"
        return text or None

    @staticmethod
    def _parse_date(value) -> dt.datetime | None:
        if value in (None, ""):
            return None
        try:
            parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _contract_sources(record: dict) -> list[dict]:
        """Return subscription-level containers only."""
        sources = [record]
        for key in (
            "contract",
            "subscriptionContract",
            "subscription_contract",
            "shopifySubscriptionContract",
            "details",
            "metadata",
        ):
            value = record.get(key)
            if isinstance(value, dict):
                sources.append(value)
        return sources

    @classmethod
    def _extract_items(cls, sources: list[dict]) -> list[dict]:
        """Best-effort extraction of queued subscription items and prices."""
        arrays = []
        for source in sources:
            for key in (
                "lineItems", "line_items", "items", "products",
                "subscriptionLineItems", "subscription_line_items",
            ):
                value = source.get(key) if isinstance(source, dict) else None
                if isinstance(value, list):
                    arrays.extend(value)

        items = []
        for item in arrays:
            if not isinstance(item, dict):
                continue
            variant = item.get("variant") if isinstance(item.get("variant"), dict) else {}
            product = item.get("product") if isinstance(item.get("product"), dict) else {}
            price_value = cls._first_across(
                [item, variant],
                "price", "unitPrice", "unit_price", "amount",
            )
            if isinstance(price_value, dict):
                price_value = price_value.get("amount")
            try:
                price = float(price_value) if price_value not in (None, "") else None
            except (TypeError, ValueError):
                price = None
            try:
                quantity = float(cls._first(item, "quantity", "qty") or 1)
            except (TypeError, ValueError):
                quantity = 1.0
            items.append({
                "product": cls._first_across(
                    [item, product], "productTitle", "product_title", "title", "name"
                ) or "Unknown product",
                "variant": cls._first_across(
                    [item, variant], "variantTitle", "variant_title", "title", "name"
                ) or "",
                "variant_id": str(cls._first_across(
                    [item, variant], "variantId", "variant_id", "id"
                ) or ""),
                "quantity": quantity,
                "unit_price": price,
                "estimated_revenue": price * quantity if price is not None else None,
            })
        return items

    def parse_subscriptions(self, email: str, raw: dict) -> list[dict]:
        records: list[dict] = []
        data = raw.get("data") if isinstance(raw, dict) else None
        if not isinstance(data, list):
            return records

        now = dt.datetime.now(dt.timezone.utc)
        for entry in data:
            if not isinstance(entry, dict):
                continue

            cust_rel = entry.get("custRel") or entry.get("customerRelation") or {}
            subscriptions = (
                entry.get("sts")
                or entry.get("subscriptions")
                or entry.get("subscriptionContracts")
                or []
            )
            if isinstance(subscriptions, dict):
                subscriptions = list(subscriptions.values())
            if not isinstance(subscriptions, list):
                continue

            for index, sub in enumerate(subscriptions):
                if not isinstance(sub, dict):
                    continue

                # Critical correction: status and cancellation fields are read from the
                # subscription contract only, never from the parent formatted order.
                sources = self._contract_sources(sub)

                raw_status = self._first_across(
                    sources,
                    "status",
                    "purchaseState",
                    "purchase_state",
                    "state",
                    "subscriptionStatus",
                    "subscription_status",
                    "contractStatus",
                    "contract_status",
                )
                cancelled_at = self._first_across(
                    sources,
                    "cancelledAt",
                    "canceledAt",
                    "cancelled_at",
                    "canceled_at",
                    "endedAt",
                    "ended_at",
                    "deactivatedAt",
                    "deactivated_at",
                )
                next_order_date = self._first_across(
                    sources,
                    "nextOrderDate",
                    "nextBillingDate",
                    "nextChargeDate",
                    "next_order_date",
                    "next_billing_date",
                    "next_charge_date",
                )
                created_at = self._first_across(
                    sources,
                    "createdAt",
                    "created_at",
                    "startedAt",
                    "started_at",
                    "activatedAt",
                    "activated_at",
                )

                status = self._normalize_status(raw_status)
                confidence = "confirmed" if status in {"active", "paused", "cancelled"} else "unknown"
                status_source = "contract_status" if confidence == "confirmed" else "missing"

                if cancelled_at:
                    status = "cancelled"
                    confidence = "confirmed"
                    status_source = "contract_cancellation_date"
                elif status not in {"active", "paused", "cancelled"}:
                    next_date = self._parse_date(next_order_date)
                    if next_date and next_date >= now:
                        status = "active_inferred"
                        confidence = "inferred"
                        status_source = "future_billing_date"
                    else:
                        status = "unknown"

                items = self._extract_items(sources)
                estimated_revenue = sum(
                    float(item["estimated_revenue"])
                    for item in items
                    if item.get("estimated_revenue") is not None
                )
                if not any(item.get("estimated_revenue") is not None for item in items):
                    estimated_revenue = None

                records.append({
                    "customer_email": email,
                    "customer_relation_id": (
                        cust_rel.get("id") or entry.get("customerRelationId")
                    ),
                    "subscription_id": (
                        sub.get("id")
                        or sub.get("subscriptionId")
                        or sub.get("contractId")
                    ),
                    "status": status,
                    "status_confidence": confidence,
                    "status_source": status_source,
                    "raw_status": raw_status,
                    "created_at": created_at,
                    "cancelled_at": cancelled_at,
                    "next_order_date": next_order_date,
                    "plan_id": self._first_across(
                        sources,
                        "sellingPlanId",
                        "selling_plan_id",
                        "planId",
                        "plan_id",
                    ),
                    "estimated_next_revenue": estimated_revenue,
                    "subscription_items": json.dumps(
                        items, ensure_ascii=False, separators=(",", ":")
                    ),
                    "is_most_recent": index == 0,
                })
        return records
