"""Shopify Admin API client for SmartPay subscription analytics."""

from __future__ import annotations

import time
from collections.abc import Iterable

import requests


class ShopifyClient:
    def __init__(self, store_domain: str, access_token: str, api_version: str = "2025-01"):
        self.base_url = f"https://{store_domain}/admin/api/{api_version}"
        self.headers = {
            "X-Shopify-Access-Token": access_token,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                response = requests.request(method, url, headers=self.headers, timeout=45, **kwargs)
                if response.status_code == 429 or response.status_code >= 500:
                    wait = min(2 ** attempt, 16)
                    time.sleep(wait)
                    continue
                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                last_error = exc
                if attempt == 4:
                    raise
                time.sleep(min(2 ** attempt, 16))
        raise RuntimeError(f"Shopify request failed: {last_error}")

    def get_orders(self, created_at_min: str | None = None, created_at_max: str | None = None) -> list[dict]:
        """Fetch all orders in the requested window using cursor pagination."""
        orders: list[dict] = []
        url: str | None = f"{self.base_url}/orders.json"
        params: dict | None = {
            "status": "any",
            "limit": 250,
            "created_at_min": created_at_min,
            "created_at_max": created_at_max,
            "fields": ",".join([
                "id", "name", "email", "customer", "currency", "created_at", "cancelled_at",
                "financial_status", "fulfillment_status", "tags", "total_price", "current_total_price",
                "subtotal_price", "current_subtotal_price", "total_line_items_price", "total_discounts",
                "current_total_discounts", "total_tax", "total_shipping_price_set", "refunds", "line_items",
                "discount_codes",
            ]),
        }
        params = {k: v for k, v in params.items() if v not in (None, "")}

        while url:
            response = self._request("GET", url, params=params)
            orders.extend(response.json().get("orders", []))
            next_url = None
            for part in response.headers.get("Link", "").split(","):
                if 'rel="next"' in part:
                    next_url = part.split(";", 1)[0].strip().strip("<>")
                    break
            url = next_url
            params = None
        return orders

    @staticmethod
    def is_subscription_order(order: dict) -> bool:
        tags = str(order.get("tags") or "").lower()
        if "subscription" in tags or "smartrr" in tags:
            return True
        return any(item.get("selling_plan_allocation") for item in order.get("line_items") or [])

    def get_subscription_orders(self, created_at_min: str | None = None, created_at_max: str | None = None) -> list[dict]:
        return [
            order for order in self.get_orders(created_at_min, created_at_max)
            if self.is_subscription_order(order)
        ]

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        response = self._request(
            "POST",
            f"{self.base_url}/graphql.json",
            json={"query": query, "variables": variables or {}},
        )
        payload = response.json()
        if payload.get("errors"):
            raise RuntimeError(f"Shopify GraphQL errors: {payload['errors']}")
        return payload.get("data") or {}

    @staticmethod
    def _chunks(values: list[str], size: int) -> Iterable[list[str]]:
        for start in range(0, len(values), size):
            yield values[start:start + size]

    def get_variant_unit_costs(self, variant_ids: list[str]) -> dict[str, float | None]:
        """Return Shopify variant unit costs. Missing costs stay None; zero is a valid cost."""
        clean_ids = sorted({str(value) for value in variant_ids if value})
        result: dict[str, float | None] = {variant_id: None for variant_id in clean_ids}
        query = """
        query VariantCosts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              inventoryItem { unitCost { amount currencyCode } }
            }
          }
        }
        """
        for batch in self._chunks(clean_ids, 100):
            gids = [f"gid://shopify/ProductVariant/{variant_id}" for variant_id in batch]
            data = self.graphql(query, {"ids": gids})
            for node in data.get("nodes") or []:
                if not node:
                    continue
                numeric_id = str(node.get("id") or "").rsplit("/", 1)[-1]
                amount = (((node.get("inventoryItem") or {}).get("unitCost") or {}).get("amount"))
                try:
                    result[numeric_id] = float(amount) if amount is not None else None
                except (TypeError, ValueError):
                    result[numeric_id] = None
        return result
