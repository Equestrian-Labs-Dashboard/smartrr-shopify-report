"""Shopify Admin API client for subscription order analytics."""

import os
import time
from typing import Iterable

import requests


class ShopifyClient:
    def __init__(self, store_domain: str, access_token: str, api_version: str = "2025-01"):
        self.store_domain = store_domain
        self.api_version = api_version
        self.base_url = f"https://{store_domain}/admin/api/{api_version}"
        self.headers = {
            "X-Shopify-Access-Token": access_token,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, url: str, **kwargs):
        response = requests.request(method, url, headers=self.headers, timeout=45, **kwargs)
        if response.status_code == 429:
            time.sleep(2)
            response = requests.request(method, url, headers=self.headers, timeout=45, **kwargs)
        response.raise_for_status()
        return response

    def _get(self, url: str, params=None):
        return self._request("GET", url, params=params)

    def get_orders(self, status="any", created_at_min=None, created_at_max=None, limit=250):
        """Fetch all orders using Shopify cursor pagination."""
        orders = []
        url = f"{self.base_url}/orders.json"
        params = {
            "status": status,
            "limit": limit,
            "fields": ",".join([
                "id", "name", "email", "customer", "currency", "created_at", "cancelled_at",
                "financial_status", "fulfillment_status", "tags", "total_price", "current_total_price",
                "subtotal_price", "current_subtotal_price", "total_line_items_price", "total_discounts",
                "total_tax", "total_shipping_price_set", "refunds", "line_items"
            ]),
        }
        if created_at_min:
            params["created_at_min"] = created_at_min
        if created_at_max:
            params["created_at_max"] = created_at_max

        while url:
            response = self._get(url, params=params)
            orders.extend(response.json().get("orders", []))
            next_url = None
            for part in response.headers.get("Link", "").split(","):
                if 'rel="next"' in part:
                    next_url = part.split(";")[0].strip().strip("<>")
                    break
            url = next_url
            params = None
        return orders

    @staticmethod
    def is_subscription_order(order: dict) -> bool:
        tags = (order.get("tags") or "").lower()
        if "subscription" in tags or "smartrr" in tags:
            return True
        return any(item.get("selling_plan_allocation") for item in order.get("line_items", []))

    def get_subscription_orders(self, created_at_min=None, created_at_max=None):
        return [
            order for order in self.get_orders(created_at_min=created_at_min, created_at_max=created_at_max)
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
    def _chunks(values: list, size: int) -> Iterable[list]:
        for start in range(0, len(values), size):
            yield values[start:start + size]

    def get_variant_unit_costs(self, variant_ids: list[str]) -> dict[str, float | None]:
        """Return {numeric_variant_id: unit_cost}; missing Shopify costs remain None."""
        clean_ids = sorted({str(value) for value in variant_ids if value})
        result: dict[str, float | None] = {}
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
                numeric_id = str(node.get("id", "")).rsplit("/", 1)[-1]
                amount = (((node.get("inventoryItem") or {}).get("unitCost") or {}).get("amount"))
                try:
                    result[numeric_id] = float(amount) if amount is not None else None
                except (TypeError, ValueError):
                    result[numeric_id] = None
        return result


if __name__ == "__main__":
    client = ShopifyClient(
        store_domain=os.environ["SHOPIFY_STORE_DOMAIN"],
        access_token=os.environ["SHOPIFY_ACCESS_TOKEN"],
        api_version=os.environ.get("SHOPIFY_API_VERSION") or "2025-01",
    )
    print(f"Found {len(client.get_subscription_orders())} subscription-tagged orders")
