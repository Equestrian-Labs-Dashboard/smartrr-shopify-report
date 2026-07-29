"""Smartrr API client for SmartPay subscription KPIs."""

from __future__ import annotations

import time

import requests


class SmartrrClient:
    BASE_URL = "https://api.smartrr.com/vendor"

    def __init__(self, access_token: str):
        self.headers = {
            "x-smartrr-access-token": access_token,
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: dict | None = None) -> dict:
        for attempt in range(5):
            response = requests.get(
                f"{self.BASE_URL}{path}", headers=self.headers, params=params, timeout=45
            )
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(min(2 ** attempt, 16))
                continue
            response.raise_for_status()
            return response.json()
        response.raise_for_status()
        return {}

    def get_customer_subscriptions(self, email_or_name: str) -> dict:
        return self._get("/order/formatted", {"filterLike[emailOrName]": email_or_name})

    @staticmethod
    def _first(source: dict, *keys):
        for key in keys:
            value = source.get(key)
            if value not in (None, ""):
                return value
        return None

    @staticmethod
    def _normalize_status(value) -> str | None:
        if value in (None, ""):
            return None
        text = str(value).strip().lower()
        if any(token in text for token in ("cancel", "terminated", "ended", "inactive")):
            return "cancelled"
        if any(token in text for token in ("pause", "hold", "skipped")):
            return "paused"
        if any(token in text for token in ("active", "enabled", "live", "subscribed")):
            return "active"
        return text

    def parse_subscriptions(self, email: str, raw: dict) -> list[dict]:
        """Normalize common Smartrr response aliases without inventing missing statuses."""
        records: list[dict] = []
        data = raw.get("data") if isinstance(raw, dict) else None
        if not isinstance(data, list):
            return records

        for entry in data:
            cust_rel = entry.get("custRel") or entry.get("customerRelation") or {}
            subscriptions = entry.get("sts") or entry.get("subscriptions") or []
            if isinstance(subscriptions, dict):
                subscriptions = list(subscriptions.values())
            for index, sub in enumerate(subscriptions):
                if not isinstance(sub, dict):
                    continue
                raw_status = self._first(
                    sub, "status", "purchaseState", "state", "subscriptionStatus", "subscription_status"
                )
                cancelled_at = self._first(
                    sub, "cancelledAt", "canceledAt", "cancelled_at", "canceled_at", "endedAt", "ended_at"
                )
                status = self._normalize_status(raw_status)
                if cancelled_at and status is None:
                    status = "cancelled"
                records.append({
                    "customer_email": email,
                    "customer_relation_id": cust_rel.get("id") or entry.get("customerRelationId"),
                    "subscription_id": sub.get("id") or sub.get("subscriptionId"),
                    "status": status,
                    "raw_status": raw_status,
                    "created_at": self._first(sub, "createdAt", "created_at", "startedAt", "started_at"),
                    "cancelled_at": cancelled_at,
                    "next_order_date": self._first(
                        sub, "nextOrderDate", "nextBillingDate", "next_order_date", "next_billing_date"
                    ),
                    "plan_id": self._first(sub, "sellingPlanId", "selling_plan_id", "planId", "plan_id"),
                    "is_most_recent": index == 0,
                })
        return records
