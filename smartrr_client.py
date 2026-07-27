"""
Smartrr API client.

Requires:
  SMARTRR_ACCESS_TOKEN   generated in Smartrr Admin > Integrations   (Secret)

Confirmed endpoints (per Smartrr's public Gorgias / headless-store integration docs):
  GET /vendor/selling-plan-group                               -> all subscription programs
  GET /vendor/order/formatted?filterLike[emailOrName]={query}  -> subscriptions for ONE customer

There is no publicly confirmed bulk "list all subscriptions" endpoint. This client
looks subscriptions up per customer email (fed in from Shopify order data), which is
reliable and documented. If Smartrr support grants a bulk endpoint or webhook access
later, add a `get_all_subscriptions()` method here and nothing else in the pipeline
needs to change.
"""

import os
import time
import requests


class SmartrrClient:
    BASE_URL = "https://api.smartrr.com/vendor"

    def __init__(self, access_token: str):
        self.headers = {
            "x-smartrr-access-token": access_token,
            "Content-Type": "application/json",
        }

    def _get(self, path, params=None):
        resp = requests.get(f"{self.BASE_URL}{path}", headers=self.headers, params=params, timeout=30)
        if resp.status_code == 429:
            time.sleep(2)
            resp = requests.get(f"{self.BASE_URL}{path}", headers=self.headers, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def get_selling_plans(self):
        return self._get("/selling-plan-group")

    def get_customer_subscriptions(self, email_or_name: str):
        """Raw response for one customer. Shape confirmed fields: custRel.id, sts[] (list of subs, sts[].id)."""
        params = {"filterLike[emailOrName]": email_or_name}
        return self._get("/order/formatted", params=params)

    def parse_subscriptions(self, email: str, raw: dict):
        """
        Best-effort parse. custRel.id and sts[].id are confirmed field names.
        status / next_order_date / plan_id are inferred — verify against a raw
        dump for your account and adjust here if the field names differ.
        """
        if not raw or "data" not in raw:
            return []

        records = []
        for entry in raw["data"]:
            cust_rel_id = (entry.get("custRel") or {}).get("id")
            subs = entry.get("sts", [])
            for idx, sub in enumerate(subs):
                records.append({
                    "customer_email": email,
                    "customer_relation_id": cust_rel_id,
                    "subscription_id": sub.get("id"),
                    "status": sub.get("status") or sub.get("purchaseState"),
                    "next_order_date": sub.get("nextOrderDate") or sub.get("nextBillingDate"),
                    "plan_id": sub.get("sellingPlanId"),
                    "is_most_recent": idx == 0,
                })
        return records


if __name__ == "__main__":
    client = SmartrrClient(access_token=os.environ["SMARTRR_ACCESS_TOKEN"])
    plans = client.get_selling_plans()
    print(plans)
