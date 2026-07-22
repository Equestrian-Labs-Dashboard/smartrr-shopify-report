"""Google Sheets writer for separate order and subscription datasets."""

import json

import gspread
import pandas as pd
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def clean_cell(value):
    if pd.isna(value):
        return ""
    return str(value)


def dataframe_values(df: pd.DataFrame):
    return [df.columns.tolist()] + [
        [clean_cell(value) for value in row]
        for row in df.itertuples(index=False, name=None)
    ]


class SheetsClient:
    def __init__(self, service_account_json: str, spreadsheet_id: str):
        credentials = Credentials.from_service_account_info(
            json.loads(service_account_json), scopes=SCOPES
        )
        self.spreadsheet = gspread.authorize(credentials).open_by_key(spreadsheet_id)

    def worksheet(self, title: str, rows: int = 1000, cols: int = 24):
        try:
            return self.spreadsheet.worksheet(title)
        except gspread.WorksheetNotFound:
            return self.spreadsheet.add_worksheet(title=title, rows=rows, cols=cols)

    def overwrite(self, title: str, df: pd.DataFrame):
        ws = self.worksheet(title, rows=max(len(df) + 10, 1000), cols=max(len(df.columns) + 2, 20))
        ws.clear()
        if df.empty:
            ws.update([["No data"]])
        else:
            ws.update(dataframe_values(df))
        print(f"  Sheet tab '{title}': {len(df)} rows", flush=True)

    def write_orders(self, orders_df: pd.DataFrame):
        """One row per Shopify order. This tab never contains subscription-expanded rows."""
        self.overwrite("Orders", orders_df)

    def write_subscriptions(self, subscriptions_df: pd.DataFrame):
        """One row per Smartrr subscription, independent from Shopify orders."""
        self.overwrite("Subscriptions", subscriptions_df)

    def write_order_year_tabs(self, orders_df: pd.DataFrame):
        """Create one order-only tab per calendar year, such as 'Orders 2025'."""
        if orders_df.empty or "created_at" not in orders_df.columns:
            return

        data = orders_df.copy()
        data["_year"] = pd.to_datetime(data["created_at"], errors="coerce", utc=True).dt.year
        data = data.dropna(subset=["_year"])
        data["_year"] = data["_year"].astype(int)

        for year, year_df in data.groupby("_year"):
            year_df = year_df.drop(columns=["_year"])
            year_df = year_df.drop_duplicates(subset=["order_id"], keep="last")
            self.overwrite(f"Orders {year}", year_df)
