"""
Shopify Admin API client.

Requires:
  SHOPIFY_STORE_DOMAIN   e.g. "corro.myshopify.com"   (Variable)
  SHOPIFY_ACCESS_TOKEN   Admin API access token         (Secret)
  SHOPIFY_API_VERSION    e.g. "2025-01"                 (Variable, optional)
"""

import os
import time
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

    def _get(self, url, params=None):
        resp = requests.get(url, headers=self.headers, params=params, timeout=30)
        if resp.status_code == 429:
            # Rate limited, back off and retry once
            time.sleep(2)
            resp = requests.get(url, headers=self.headers, params=params, timeout=30)
        resp.raise_for_status()
        return resp

    def get_orders(self, status="any", since_id=None, created_at_min=None, limit=250):
        """
        Paginated fetch of all orders (handles Shopify's Link-header cursor pagination).
        Returns a list of raw order dicts.
        """
        orders = []
        url = f"{self.base_url}/orders.json"
        params = {
            "status": status,
            "limit": limit,
        }
        if since_id:
            params["since_id"] = since_id
        if created_at_min:
            params["created_at_min"] = created_at_min

        while url:
            resp = self._get(url, params=params)
            payload = resp.json()
            orders.extend(payload.get("orders", []))

            # Shopify cursor-based pagination via Link header
            link_header = resp.headers.get("Link", "")
            next_url = None
            if link_header:
                for part in link_header.split(","):
                    if 'rel="next"' in part:
                        next_url = part.split(";")[0].strip().strip("<>")
            url = next_url
            params = None  # next_url already contains query params

        return orders

    @staticmethod
    def is_subscription_order(order: dict) -> bool:
        """
        Heuristic: Smartrr-created orders carry a selling_plan on the line item,
        and/or a tag mentioning the subscription app. Adjust once you confirm
        the exact tag your store uses (check a known subscription order in Shopify admin).
        """
        tags = (order.get("tags") or "").lower()
        if "subscription" in tags or "smartrr" in tags:
            return True
        for item in order.get("line_items", []):
            if item.get("selling_plan_allocation"):
                return True
        return False

    def get_subscription_orders(self, created_at_min=None):
        all_orders = self.get_orders(created_at_min=created_at_min)
        return [o for o in all_orders if self.is_subscription_order(o)]


if __name__ == "__main__":
    client = ShopifyClient(
        store_domain=os.environ["SHOPIFY_STORE_DOMAIN"],
        access_token=os.environ["SHOPIFY_ACCESS_TOKEN"],
        api_version=os.environ.get("SHOPIFY_API_VERSION", "2025-01"),
    )
    subs = client.get_subscription_orders()
    print(f"Found {len(subs)} subscription-tagged orders")
